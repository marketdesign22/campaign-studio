import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  getAnalyticsSummary, getMonthlyReport, getSnapshotBefore, getTopPosts, getTopPostsByPeriod,
  listFollowerSnapshots, periodStart,
} from "../db";
import { fetchAnalyticsForRecentPosts, fetchFollowerCounts } from "../scheduler";
import { getLocalParts } from "../scheduler";
import { buildSeries, netChange } from "@shared/followerStats";
import { primaryTimezone } from "@shared/postingSlots";
import { accountProcedure } from "../accountScope";
import { router } from "../_core/trpc";
import type { Account } from "../../drizzle/schema";

const RANK_BY = z.enum(["views", "engagement", "rate"]);
const PERIOD = z.enum(["day", "week", "month"]);

/** 期間の開始日・終了日を、そのアカウントのタイムゾーンの日付で返す */
function periodRange(account: Account, period: "day" | "week" | "month") {
  const tz = primaryTimezone(account);
  const now = new Date();
  return {
    from: getLocalParts(periodStart(period, now), tz).dateStr,
    to: getLocalParts(now, tz).dateStr,
  };
}

/**
 * 手動更新の連打防止。
 * Threads APIを何度も叩かないよう、アカウントごとに間隔を空ける。
 */
const REFRESH_COOLDOWN_MS = 60_000;
const lastRefresh = new Map<number, number>();

export const analyticsRouter = router({
  /** 月次レポート（クライアント報告用）。選択中アカウント分のみ */
  monthlyReport: accountProcedure
    .input(z.object({ year: z.number().int().min(2020).max(2100), month: z.number().int().min(1).max(12) }))
    .query(async ({ input, ctx }) => getMonthlyReport(input.year, input.month, ctx.scope)),

  /**
   * Threads から最新の分析データを取得する（投稿インサイト＋フォロワー数）。
   *
   * 投稿インサイトの取得はログの accountId ごとに正しいトークンを選ぶため、
   * ここでアカウントを絞らない（絞ると他アカウントの数値が古いままになる）。
   * 返すのは件数と失敗理由の分類のみで、トークンやAPIの生レスポンスは含めない。
   */
  refreshNow: accountProcedure.mutation(async ({ ctx }) => {
    const last = lastRefresh.get(ctx.account.id) ?? 0;
    const waitMs = REFRESH_COOLDOWN_MS - (Date.now() - last);
    if (waitMs > 0) {
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: `更新はしばらく待ってからお試しください（あと${Math.ceil(waitMs / 1000)}秒）。`,
      });
    }
    lastRefresh.set(ctx.account.id, Date.now());

    await fetchAnalyticsForRecentPosts();
    const followers = await fetchFollowerCounts();
    const mine = followers.find((f) => f.accountId === ctx.account.id);

    return {
      ok: true,
      refreshedAt: new Date(),
      // 失敗の理由だけを分類して返す。APIレスポンス本文は返さない
      followerStatus: !mine
        ? ("skipped" as const)
        : mine.followers !== undefined
          ? ("ok" as const)
          : classifyFollowerError(mine.error ?? ""),
    };
  }),

  summary: accountProcedure
    .input(z.object({ period: PERIOD.default("week") }))
    .query(async ({ input, ctx }) => {
      const totals = await getAnalyticsSummary(input.period, ctx.scope);
      const range = periodRange(ctx.account, input.period);
      const baseline = await getSnapshotBefore(ctx.account.id, range.from);
      const inPeriod = await listFollowerSnapshots(ctx.account.id, range.from);
      const all = await listFollowerSnapshots(ctx.account.id);

      const today = range.to;
      const todayRow = all.find((r) => r.capturedDate === today);
      const beforeToday = [...all].reverse().find((r) => r.capturedDate < today);

      return {
        ...totals,
        range,
        /** 未取得（履歴なし）は null。0フォロワーとは区別する */
        currentFollowers: all.length ? all[all.length - 1].followerCount : null,
        todayChange:
          todayRow && beforeToday ? todayRow.followerCount - beforeToday.followerCount : null,
        periodChange: netChange(inPeriod, baseline),
        hasFollowerHistory: all.length > 0,
      };
    }),

  /**
   * フォロワーの現在値と、今日／7日／30日の増減。
   * 期間切り替えとは独立した固定の要約（画面上部に常時出す用）。
   */
  followerSummary: accountProcedure.query(async ({ ctx }) => {
    const tz = primaryTimezone(ctx.account);
    const today = getLocalParts(new Date(), tz).dateStr;
    const all = await listFollowerSnapshots(ctx.account.id);
    if (all.length === 0) {
      return { current: null, today: null, last7: null, last30: null, hasHistory: false };
    }
    const current = all[all.length - 1].followerCount;
    const dayBefore = (days: number) => {
      const d = new Date(`${today}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() - days);
      return d.toISOString().slice(0, 10);
    };
    /** 指定日以前で最も近いスナップショットとの差。基準が無ければ null */
    const changeSince = (from: string) => {
      const base = [...all].reverse().find((r) => r.capturedDate < from);
      return base ? current - base.followerCount : null;
    };
    return {
      current,
      today: changeSince(today),
      last7: changeSince(dayBefore(7)),
      last30: changeSince(dayBefore(30)),
      hasHistory: true,
    };
  }),

  /** フォロワー推移。総数・前日比・期間開始比を持つ系列を返す */
  followerHistory: accountProcedure
    .input(z.object({ period: PERIOD.default("week") }))
    .query(async ({ input, ctx }) => {
      const range = periodRange(ctx.account, input.period);
      const baseline = await getSnapshotBefore(ctx.account.id, range.from);
      const inPeriod = await listFollowerSnapshots(ctx.account.id, range.from);
      return {
        range,
        points: buildSeries(inPeriod, baseline),
        hasBaseline: !!baseline,
      };
    }),

  topPosts: accountProcedure
    .input(z.object({ limit: z.number().int().min(1).max(50).default(10), rankBy: RANK_BY.default("engagement") }))
    .query(async ({ input, ctx }) => getTopPosts(input.limit, ctx.scope, input.rankBy)),

  topPostsByPeriod: accountProcedure
    .input(z.object({
      period: PERIOD.default("week"),
      limit: z.number().int().min(1).max(20).default(5),
      rankBy: RANK_BY.default("engagement"),
    }))
    .query(async ({ input, ctx }) =>
      getTopPostsByPeriod(input.period, input.limit, ctx.scope, input.rankBy)),
});

/**
 * フォロワー取得の失敗を、画面に出せる粒度へ丸める。
 * APIのエラー本文やトークンは決して返さない。
 */
export function classifyFollowerError(message: string):
  | "unavailable" | "token_expired" | "permission" | "rate_limited" | "network" | "unknown" {
  const m = message.toLowerCase();
  if (m.includes("followers_count unavailable")) return "unavailable";
  if (m.includes("(401)") || m.includes("(403)") || m.includes("oauthexception")) return "token_expired";
  if (m.includes("permission") || m.includes("subcode\":33") || m.includes("insights")) return "permission";
  if (m.includes("(429)") || m.includes("rate limit")) return "rate_limited";
  if (m.includes("fetch failed") || m.includes("network") || m.includes("etimedout")) return "network";
  return "unknown";
}
