/**
 * トレンドリサーチAPI。
 *
 * - すべて accountProcedure。検索条件・収集データ・分析・学習結果はアカウント単位
 * - Threads APIやAIの生レスポンス、トークン、APIキーは返さない
 * - 手動取得・AI分析には回数制限を掛ける（費用と外部APIの保護）
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  getLatestTrendAnalysis, getOwnedTrendPost, getTrendSettings, listPostOutcomes, listTrendPosts,
  setTrendPostStatus, upsertTrendPost, upsertTrendSettings,
} from "../db";
import {
  analyzeTrends, fetchTrendsForAccount, markDeletedSavedPosts, periodSince, type TrendAnalysisResult,
} from "../trends";
import { buildRecommendations, parseReferenceUrl } from "@shared/trendLearning";
import { computeTrendScore } from "@shared/trendScore";
import { primaryTimezone } from "@shared/postingSlots";
import { getLocalParts } from "../scheduler";
import { aiError, MAX_POST_LENGTH } from "../aiSupport";
import { ENV } from "../_core/env";
import { accountProcedure } from "../accountScope";
import { router } from "../_core/trpc";

const PERIOD = z.enum(["24h", "7d", "30d"]);

/** 手動取得の連打防止（アカウントごと） */
const FETCH_COOLDOWN_MS = 5 * 60_000;
const lastManualFetch = new Map<number, number>();

const TIME = z.object({ hour: z.number().int().min(0).max(23), minute: z.number().int().min(0).max(59) });
const STR_LIST = z.array(z.string().trim().min(1).max(60)).max(50);

function parseJsonArray(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function parseBreakdown(raw: string | null) {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/** 画面向けの行。DBの行から内部専用の値を落とし、JSON列を展開する */
function toClientPost(p: Awaited<ReturnType<typeof listTrendPosts>>[number]) {
  return {
    id: p.id,
    platform: p.platform,
    source: p.source,
    keyword: p.keyword,
    permalink: p.permalink,
    username: p.username,
    postedAt: p.postedAt,
    mediaType: p.mediaType,
    summary: p.summary,
    hasReplies: p.hasReplies,
    // 取れない指標は null のまま返す（0 と区別する）
    likes: p.likes, replies: p.replies, reposts: p.reposts, views: p.views, saves: p.saves,
    score: p.score,
    scoreBreakdown: parseBreakdown(p.scoreBreakdown),
    isRising: p.isRising,
    status: p.status,
    aiReason: p.aiReason,
    aiIdeas: parseJsonArray(p.aiIdeas),
    fetchedAt: p.fetchedAt,
    firstSeenAt: p.firstSeenAt,
  };
}

export const trendsRouter = router({
  /** 収集した投稿。期間は投稿日時基準、並びはスコア順 */
  list: accountProcedure
    .input(z.object({
      period: PERIOD.default("7d"),
      status: z.enum(["all", "active", "saved", "excluded"]).default("all"),
      platform: z.enum(["threads", "instagram"]).optional(),
    }))
    .query(async ({ input, ctx }) => {
      const statuses = input.status === "all"
        ? (["active", "saved", "deleted"] as const)
        : input.status === "active" ? (["active"] as const)
        : input.status === "saved" ? (["saved", "deleted"] as const)
        : (["excluded"] as const);
      const [rows, cfg] = await Promise.all([
        listTrendPosts(ctx.account.id, {
          since: periodSince(input.period), status: [...statuses], platform: input.platform, limit: 100,
        }),
        getTrendSettings(ctx.account.id),
      ]);
      return {
        posts: rows.map(toClientPost),
        lastFetchAt: cfg.lastFetchAt,
        /** 直近の取得で対処が必要な失敗（null なら正常）。画面で再接続などを案内する */
        lastFetchError: cfg.lastFetchError,
        keywordCount: cfg.keywords.length,
        autoFetch: cfg.autoFetch,
        aiAvailable: !!ENV.openaiApiKey,
      };
    }),

  /** 保存・除外・戻す。対象は選択中アカウントの行に限る */
  setStatus: accountProcedure
    .input(z.object({ id: z.number().int(), status: z.enum(["active", "saved", "excluded"]) }))
    .mutation(async ({ input, ctx }) => {
      const row = await getOwnedTrendPost(input.id, ctx.account.id);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "対象の投稿が見つかりません。" });
      await setTrendPostStatus(input.id, ctx.account.id, input.status);
      return { ok: true };
    }),

  /**
   * 今すぐ取得。件数と失敗種別だけ返す。
   * 失敗しても既存データは消えない（保存処理は上書き型）。
   */
  fetchNow: accountProcedure.mutation(async ({ ctx }) => {
    if (ctx.user.role !== "admin") {
      throw new TRPCError({ code: "FORBIDDEN", message: "この操作は管理者のみ実行できます。" });
    }
    const last = lastManualFetch.get(ctx.account.id) ?? 0;
    const waitMs = FETCH_COOLDOWN_MS - (Date.now() - last);
    if (waitMs > 0) {
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: `取得はしばらく待ってからお試しください（あと${Math.ceil(waitMs / 60_000)}分）。`,
      });
    }
    const cfg = await getTrendSettings(ctx.account.id);
    if (cfg.keywords.length === 0) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "設定でキーワードを登録してください。" });
    }
    lastManualFetch.set(ctx.account.id, Date.now());
    const result = await fetchTrendsForAccount(ctx.account, ctx.scope, new Date(), cfg);
    // 保存済みの投稿が消えていないかもこのタイミングで確認する
    await markDeletedSavedPosts(ctx.account).catch(() => undefined);
    return {
      keywords: result.keywords,
      fetched: result.fetched,
      stored: result.stored,
      errors: result.errors.map((e) => ({ keyword: e.keyword, kind: e.kind })),
    };
  }),

  /** AIによる傾向分析。1日の回数制限は設定値に従う */
  analyze: accountProcedure
    .input(z.object({ period: PERIOD.default("7d") }))
    .mutation(async ({ input, ctx }) => {
      if (!ENV.openaiApiKey) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "AI設定が必要です。OPENAI_API_KEY を設定してください。" });
      }
      try {
        const r = await analyzeTrends(ctx.account, input.period);
        return { analysisId: r.analysisId, result: r.result, postCount: r.postCount, createdAt: new Date() };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.startsWith("AI daily limit")) {
          throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "本日のAI分析回数の上限に達しました。設定で上限を変更できます。" });
        }
        if (msg.startsWith("empty: no trend posts")) {
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: "この期間に分析できる投稿がありません。先に取得してください。" });
        }
        throw aiError(e);
      }
    }),

  /** 直近の分析結果（無ければ null） */
  latestAnalysis: accountProcedure
    .input(z.object({ period: PERIOD.default("7d") }))
    .query(async ({ input, ctx }) => {
      const row = await getLatestTrendAnalysis(ctx.account.id, input.period);
      if (!row) return null;
      let result: TrendAnalysisResult | null = null;
      try {
        result = JSON.parse(row.result) as TrendAnalysisResult;
      } catch {
        result = null;
      }
      return result ? { analysisId: row.id, result, postCount: row.postCount, createdAt: row.createdAt } : null;
    }),

  /** 設定の取得。内部ロック用のキーは返さない */
  getSettings: accountProcedure.query(async ({ ctx }) => {
    const cfg = await getTrendSettings(ctx.account.id);
    return {
      keywords: cfg.keywords,
      excludeKeywords: cfg.excludeKeywords,
      refAccounts: cfg.refAccounts,
      language: cfg.language,
      region: cfg.region,
      industry: cfg.industry,
      fetchTimes: cfg.fetchTimes,
      autoFetch: cfg.autoFetch,
      retentionDays: cfg.retentionDays,
      aiDailyLimit: cfg.aiDailyLimit,
      lastFetchAt: cfg.lastFetchAt,
      lastFetchError: cfg.lastFetchError,
      timezone: primaryTimezone(ctx.account),
    };
  }),

  saveSettings: accountProcedure
    .input(z.object({
      keywords: STR_LIST.optional(),
      excludeKeywords: STR_LIST.optional(),
      refAccounts: z.array(z.string().trim().min(1).max(60).regex(/^@?[A-Za-z0-9._]+$/)).max(30).optional(),
      language: z.enum(["ja", "en"]).optional(),
      region: z.enum(["JP", "US", "OTHER"]).optional(),
      industry: z.string().trim().max(60).nullable().optional(),
      fetchTimes: z.array(TIME).min(1).max(4).optional(),
      autoFetch: z.boolean().optional(),
      retentionDays: z.number().int().min(7).max(180).optional(),
      aiDailyLimit: z.number().int().min(0).max(100).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const dedupe = (xs?: string[]) => (xs ? Array.from(new Set(xs.map((s) => s.trim()).filter(Boolean))) : undefined);
      await upsertTrendSettings(ctx.account.id, {
        keywords: dedupe(input.keywords),
        excludeKeywords: dedupe(input.excludeKeywords),
        refAccounts: dedupe(input.refAccounts?.map((s) => s.replace(/^@/, ""))),
        language: input.language,
        region: input.region,
        industry: input.industry === undefined ? undefined : (input.industry || null),
        fetchTimes: input.fetchTimes,
        autoFetch: input.autoFetch,
        retentionDays: input.retentionDays,
        aiDailyLimit: input.aiDailyLimit,
      });
      return { ok: true };
    }),

  /**
   * 参考URLの手動登録（Threads / Instagram）。
   * Instagram は公式API連携が無いため本文や反応数は取得しない（画面では「取得不可」）。
   * 利用者が添えたメモを要約欄に入れる。
   */
  addReference: accountProcedure
    .input(z.object({
      url: z.string().trim().min(8).max(500),
      note: z.string().trim().max(140).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const ref = parseReferenceUrl(input.url);
      if (!ref) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Threads または Instagram の公開投稿URLを入力してください。",
        });
      }
      const scored = computeTrendScore({
        postedAt: null, now: new Date(),
        likes: null, replies: null, reposts: null, views: null, saves: null,
        hasReplies: null, keywordGrowth: null, themeFit: null,
      });
      await upsertTrendPost({
        accountId: ctx.account.id, platform: ref.platform, source: "manual", keyword: null,
        externalId: ref.externalId, permalink: ref.permalink, username: ref.username,
        postedAt: null, mediaType: null,
        summary: input.note ?? "", hasReplies: null,
        likes: null, replies: null, reposts: null, views: null, saves: null,
        score: scored.score, scoreBreakdown: JSON.stringify(scored.breakdown), isRising: false,
      });
      return { ok: true, platform: ref.platform };
    }),

  /**
   * 学習サイクル（直近7日）。トレンド反映の原稿と未反映の原稿を数値で比べる。
   * 分析値の無い投稿は平均に含めない。
   */
  recommendations: accountProcedure
    .input(z.object({ days: z.number().int().min(7).max(30).default(7) }).optional())
    .query(async ({ input, ctx }) => {
      const days = input?.days ?? 7;
      const now = new Date();
      const since = new Date(now.getTime() - days * 86_400_000);
      const tz = primaryTimezone(ctx.account);
      const outcomes = await listPostOutcomes(ctx.scope, since);
      const rec = buildRecommendations(outcomes.map((o) => ({
        usedTrend: o.usedTrend,
        trendMeta: o.trendMeta,
        localHour: getLocalParts(o.postedAt ?? now, tz).hour,
        likes: o.likes, replies: o.replies, reposts: o.reposts, views: o.views,
        hasAnalytics: o.hasAnalytics,
      })));
      return {
        ...rec,
        days,
        since,
        timezone: tz,
        maxPostLength: MAX_POST_LENGTH,
      };
    }),
});
