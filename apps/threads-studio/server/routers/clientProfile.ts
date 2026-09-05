import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  PROFILE_FIELD_KEYS, clientProfileSchema, keywordCandidateSchema, type ClientProfile,
} from "@shared/clientProfile";
import { accountProcedure } from "../accountScope";
import { aiError, createRateLimiter } from "../aiSupport";
import { ENV } from "../_core/env";
import { router } from "../_core/trpc";
import {
  approveClientProfileDraft, createClientProfileDraft, getClientProfile, getLatestClientProfileDraft,
  getOwnedClientProfileDraft, getTrendSettings, upsertTrendSettings,
  listTrendPosts,
} from "../db";
import {
  collectProfileSources, extractClientProfile, mergeApprovedProfile, parseStoredProfile, profileInputSchema,
  suggestKeywordImprovements,
} from "../clientProfile";

const takeScan = createRateLimiter(3, 60 * 60_000);
const fieldKeySchema = z.enum(PROFILE_FIELD_KEYS);

function requireAdmin(role: string) {
  if (role !== "admin") throw new TRPCError({ code: "FORBIDDEN", message: "この操作は管理者のみ実行できます。" });
}

function parseDraft(row: NonNullable<Awaited<ReturnType<typeof getLatestClientProfileDraft>>>) {
  try {
    const profile = clientProfileSchema.parse(JSON.parse(row.profile));
    const keywords = z.array(keywordCandidateSchema).parse(JSON.parse(row.keywords));
    const inputs = profileInputSchema.parse(JSON.parse(row.inputs));
    const warnings = z.array(z.string()).parse(JSON.parse(row.warnings));
    return { id: row.id, status: row.status, profile, keywords, inputs, warnings, createdAt: row.createdAt };
  } catch { return null; }
}

export const clientProfileRouter = router({
  get: accountProcedure.query(async ({ ctx }) => {
    const [currentRow, draftRow] = await Promise.all([
      getClientProfile(ctx.account.id), getLatestClientProfileDraft(ctx.account.id),
    ]);
    return {
      current: parseStoredProfile(currentRow?.profile),
      draft: draftRow ? parseDraft(draftRow) : null,
      aiAvailable: !!ENV.openaiApiKey,
    };
  }),

  scan: accountProcedure.input(profileInputSchema).mutation(async ({ input, ctx }) => {
    requireAdmin(ctx.user.role);
    if (!ENV.openaiApiKey) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "AI設定が必要です。OPENAI_API_KEY を設定してください。" });
    if (!takeScan(String(ctx.account.id))) throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "読み取りは1時間に3回までです。" });
    try {
      const currentRow = await getClientProfile(ctx.account.id);
      const current = parseStoredProfile(currentRow?.profile);
      const sources = await collectProfileSources(ctx.account, input);
      const { extraction, diff } = await extractClientProfile(sources, current);
      const id = await createClientProfileDraft(ctx.account.id, input, extraction.profile, extraction.keywords, extraction.warnings);
      return { id, ...extraction, diff, pagesRead: sources.website.length, threadsPostsRead: sources.threads?.posts.length ?? 0 };
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (/URL|ローカル|公開サイト|HTML|リダイレクト|ページサイズ|タイムアウト|同一ドメイン/.test(message)) {
        throw new TRPCError({ code: "BAD_REQUEST", message });
      }
      throw aiError(error);
    }
  }),

  improveKeywords: accountProcedure.mutation(async ({ ctx }) => {
    requireAdmin(ctx.user.role);
    if (!ENV.openaiApiKey) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "AI設定が必要です。OPENAI_API_KEY を設定してください。" });
    if (!takeScan(`${ctx.account.id}:keywords`)) throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "改善案の作成は1時間に3回までです。" });
    const [currentRow, settings, rows] = await Promise.all([
      getClientProfile(ctx.account.id), getTrendSettings(ctx.account.id),
      listTrendPosts(ctx.account.id, { since: new Date(Date.now() - 30 * 86_400_000), status: ["active", "saved", "excluded"], limit: 100 }),
    ]);
    const current = parseStoredProfile(currentRow?.profile);
    if (!current || !currentRow) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "先にクライアント情報を読み取り、承認してください。" });
    let inputs: z.infer<typeof profileInputSchema>;
    try { inputs = profileInputSchema.parse(JSON.parse(currentRow.sourceInputs)); }
    catch { throw new TRPCError({ code: "BAD_REQUEST", message: "元の読み取り条件が見つかりません。再読み取りしてください。" }); }
    const observations = settings.keywords.map((keyword) => ({
      keyword,
      results: rows.filter((row) => row.keyword === keyword).length,
      excluded: rows.filter((row) => row.keyword === keyword && row.status === "excluded").length,
    }));
    try {
      const improved = await suggestKeywordImprovements(current, settings.keywords, observations);
      const warning = `検索成果をもとに改善案を作成: ${improved.reason}`;
      const id = await createClientProfileDraft(ctx.account.id, inputs, current, improved.keywords, [warning]);
      return { id, keywordCount: improved.keywords.length, reason: improved.reason };
    } catch (error) { throw aiError(error); }
  }),

  approve: accountProcedure.input(z.object({
    draftId: z.number().int().positive(),
    selectedFields: z.array(fieldKeySchema).max(PROFILE_FIELD_KEYS.length),
    edits: z.partialRecord(fieldKeySchema, z.union([z.string().max(2_000), z.array(z.string().max(160)).max(30), z.null()])),
    keywords: z.array(keywordCandidateSchema).max(40),
  })).mutation(async ({ input, ctx }) => {
    requireAdmin(ctx.user.role);
    const [draftRow, currentRow, settings] = await Promise.all([
      getOwnedClientProfileDraft(input.draftId, ctx.account.id), getClientProfile(ctx.account.id), getTrendSettings(ctx.account.id),
    ]);
    if (!draftRow || draftRow.status !== "pending") throw new TRPCError({ code: "NOT_FOUND", message: "確認待ちの読み取り結果が見つかりません。" });
    const parsed = parseDraft(draftRow);
    if (!parsed) throw new TRPCError({ code: "BAD_REQUEST", message: "読み取り結果が破損しています。再読み取りしてください。" });
    const current = parseStoredProfile(currentRow?.profile);
    const merged = mergeApprovedProfile(current, parsed.profile, input.selectedFields, input.edits as Partial<Record<keyof ClientProfile, string | string[] | null>>);
    const approvedKeywords = input.keywords.filter((item) => item.enabled);
    await approveClientProfileDraft(input.draftId, ctx.account.id, merged, parsed.inputs, input.keywords);

    const text = (key: keyof ClientProfile) => typeof merged[key].value === "string" ? merged[key].value as string : null;
    const list = (key: keyof ClientProfile) => Array.isArray(merged[key].value) ? merged[key].value as string[] : [];
    const regionText = list("regions").join(" ").toLowerCase();
    const languageText = list("languages").join(" ").toLowerCase();
    await upsertTrendSettings(ctx.account.id, {
      keywords: Array.from(new Set([...settings.keywords, ...approvedKeywords.map((item) => item.keyword)])).slice(0, 50),
      excludeKeywords: Array.from(new Set([...settings.excludeKeywords, ...list("avoidExpressions")])).slice(0, 50),
      refAccounts: Array.from(new Set([...settings.refAccounts, ...list("referenceAccounts")])).slice(0, 50),
      industry: text("industry") ?? settings.industry,
      region: /\b(us|usa|united states|米国)\b/.test(regionText) ? "US" : /japan|日本/.test(regionText) ? "JP" : settings.region,
      language: /english|英語/.test(languageText) && !/japanese|日本語/.test(languageText) ? "en" : settings.language,
    });
    return { ok: true, keywordCount: approvedKeywords.length };
  }),
});
