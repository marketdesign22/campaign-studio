import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { buildUtmUrl, conversionEventInputSchema, conversionGoalInputSchema } from "@shared/conversion";
import { accountProcedure } from "../accountScope";
import { router } from "../_core/trpc";
import {
  createConversionEvent, createConversionGoal, getOwnedConversionEvent, getOwnedConversionGoal, getOwnedPost,
  getAccountSettings, listConversionEvents, listConversionGoals, listPostOutcomes, reviseConversionEvent, updateOwnedConversionGoal,
} from "../db";
import { parseConversionCsv, summarizeConversions } from "../conversions";

const admin = (role: string) => { if (role !== "admin") throw new TRPCError({ code: "FORBIDDEN", message: "管理者のみ操作できます。" }); };
const rangeSchema = z.object({ from: z.coerce.date(), to: z.coerce.date() }).refine((x) => x.from < x.to && x.to.getTime() - x.from.getTime() <= 366 * 86_400_000, "期間が正しくありません");

async function validateReferences(input: Partial<z.infer<typeof conversionEventInputSchema>>, accountId: number, scope: Parameters<typeof getOwnedPost>[1]) {
  if (input.postId && !await getOwnedPost(input.postId, scope)) throw new TRPCError({ code: "NOT_FOUND", message: "このアカウントの投稿が見つかりません。" });
  if (input.conversionGoalId && !await getOwnedConversionGoal(input.conversionGoalId, accountId)) throw new TRPCError({ code: "NOT_FOUND", message: "このアカウントの成果目標が見つかりません。" });
}

export const conversionsRouter = router({
  goals: accountProcedure.query(({ ctx }) => listConversionGoals(ctx.account.id)),
  createGoal: accountProcedure.input(conversionGoalInputSchema).mutation(async ({ input, ctx }) => { admin(ctx.user.role); return { id: await createConversionGoal(ctx.account.id, input) }; }),
  updateGoal: accountProcedure.input(z.object({ id: z.number().int().positive(), value: conversionGoalInputSchema.partial() })).mutation(async ({ input, ctx }) => {
    admin(ctx.user.role); if (!await getOwnedConversionGoal(input.id, ctx.account.id)) throw new TRPCError({ code: "NOT_FOUND" });
    await updateOwnedConversionGoal(input.id, ctx.account.id, input.value); return { ok: true };
  }),
  utmPreview: accountProcedure.input(z.object({ url: z.string().max(2048), campaign: z.string().min(1).max(100), content: z.string().max(100).optional(), term: z.string().max(100).optional() })).query(({ input, ctx }) => {
    try { return { url: buildUtmUrl(input.url, { source: `threads_account_${ctx.account.id}`, medium: "organic_social", campaign: input.campaign, content: input.content, term: input.term }) }; }
    catch { throw new TRPCError({ code: "BAD_REQUEST", message: "安全なhttp/https URLを入力してください。" }); }
  }),
  addManual: accountProcedure.input(conversionEventInputSchema).mutation(async ({ input, ctx }) => {
    if (!(await getAccountSettings(ctx.account.id)).conversionTrackingEnabled) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "コンバージョン計測が無効です。" });
    await validateReferences(input, ctx.account.id, ctx.scope);
    return createConversionEvent(ctx.account.id, { ...input, metadata: input.metadata ? JSON.stringify(input.metadata) : null, source: input.source ?? "manual", registeredBy: ctx.user.id });
  }),
  revise: accountProcedure.input(z.object({ id: z.number().int().positive(), value: conversionEventInputSchema.partial(), reason: z.string().trim().min(1).max(300) })).mutation(async ({ input, ctx }) => {
    if (!await getOwnedConversionEvent(input.id, ctx.account.id)) throw new TRPCError({ code: "NOT_FOUND" });
    await validateReferences(input.value, ctx.account.id, ctx.scope);
    await reviseConversionEvent(input.id, ctx.account.id, { ...input.value, metadata: input.value.metadata ? JSON.stringify(input.value.metadata) : undefined }, ctx.user.id, input.reason); return { ok: true };
  }),
  importCsv: accountProcedure.input(z.object({ csv: z.string().min(1).max(256_000) })).mutation(async ({ input, ctx }) => {
    admin(ctx.user.role); let rows; try { rows = parseConversionCsv(input.csv); } catch (error) { throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "CSVが不正です" }); }
    if (!(await getAccountSettings(ctx.account.id)).conversionTrackingEnabled) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "コンバージョン計測が無効です。" });
    let created = 0, duplicates = 0;
    for (const row of rows) { await validateReferences(row, ctx.account.id, ctx.scope); const r = await createConversionEvent(ctx.account.id, { ...row, metadata: row.metadata ? JSON.stringify(row.metadata) : null, registeredBy: ctx.user.id }); r.duplicate ? duplicates++ : created++; }
    return { created, duplicates };
  }),
  summary: accountProcedure.input(rangeSchema).query(async ({ input, ctx }) => {
    const [events, outcomes, goals] = await Promise.all([listConversionEvents(ctx.account.id, input.from, input.to), listPostOutcomes(ctx.scope, input.from), listConversionGoals(ctx.account.id)]);
    const relevantOutcomes = outcomes.filter((x) => x.postedAt < input.to);
    const views = relevantOutcomes.some((x) => x.views !== null) ? relevantOutcomes.reduce((n, x) => n + (x.views ?? 0), 0) : null;
    const overall = summarizeConversions(events, views);
    const byPost = Array.from(new Set(events.map((e) => e.postId).filter((x): x is number => x !== null))).map((postId) => ({ postId, ...summarizeConversions(events.filter((e) => e.postId === postId), relevantOutcomes.find((x) => x.postId === postId)?.views ?? null) }));
    const byGoal = goals.map((goal) => ({ id: goal.id, name: goal.name, ...summarizeConversions(events.filter((e) => e.conversionGoalId === goal.id), null) })).filter((x) => x.clicks || x.conversions);
    const byCampaign = Array.from(new Set(events.map((e) => e.campaign).filter((x): x is string => !!x))).map((campaign) => ({ campaign, ...summarizeConversions(events.filter((e) => e.campaign === campaign), null) }));
    const summarizePosts = (selected: typeof relevantOutcomes) => {
      const postIds = new Set(selected.map((outcome) => outcome.postId).filter((id): id is number => id !== null));
      const selectedEvents = events.filter((event) => event.postId !== null && postIds.has(event.postId));
      const selectedViews = selected.some((outcome) => outcome.views !== null) ? selected.reduce((sum, outcome) => sum + (outcome.views ?? 0), 0) : null;
      return summarizeConversions(selectedEvents, selectedViews);
    };
    const comparisons = {
      trend: {
        used: summarizePosts(relevantOutcomes.filter((outcome) => outcome.usedTrend)),
        unused: summarizePosts(relevantOutcomes.filter((outcome) => !outcome.usedTrend)),
      },
      creation: {
        ai: summarizePosts(relevantOutcomes.filter((outcome) => outcome.creationSource === "ai" || outcome.creationSource === "strategy")),
        manual: summarizePosts(relevantOutcomes.filter((outcome) => outcome.creationSource === "manual" || outcome.creationSource === "import")),
      },
    };
    return { overall, byPost, byGoal, byCampaign, comparisons, events, reference: events.length < 5, range: { from: input.from, to: input.to } };
  }),
});
