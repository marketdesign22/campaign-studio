import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { deterministicQualityCheck, qualityFindingSchema, shouldBlockPosting } from "@shared/qualityCheck";
import { accountProcedure } from "../accountScope";
import { router } from "../_core/trpc";
import { ENV } from "../_core/env";
import { aiError, createRateLimiter } from "../aiSupport";
import { createSafeRewrite, parseForbiddenTopics, performAccountQualityCheck } from "../quality";
import { getAccountSettings, getOwnedPost } from "../db";

const take = createRateLimiter(20, 60 * 60_000);
const inputSchema = z.object({ content: z.string().max(10_000), postId: z.number().int().positive().optional() });
export const qualityRouter = router({
  preflight: accountProcedure.input(inputSchema).query(async ({ input, ctx }) => {
    const cfg = await getAccountSettings(ctx.account.id); const forbidden = parseForbiddenTopics(cfg.forbiddenTopics);
    const findings = deterministicQualityCheck(input.content, forbidden); return { findings, blocked: shouldBlockPosting(findings) };
  }),
  check: accountProcedure.input(inputSchema).mutation(async ({ input, ctx }) => {
    if (!ENV.openaiApiKey) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "AI設定が必要です。" });
    if (!take(String(ctx.account.id))) throw new TRPCError({ code: "TOO_MANY_REQUESTS" });
    if (input.postId && !await getOwnedPost(input.postId, ctx.scope)) throw new TRPCError({ code: "NOT_FOUND" });
    try {
      return await performAccountQualityCheck(ctx.account.id, ctx.scope, input.content, Number(ctx.user.id), input.postId);
    } catch (error) { throw aiError(error); }
  }),
  safeRewrite: accountProcedure.input(z.object({ content: z.string().min(1).max(500), findings: z.array(qualityFindingSchema).max(40) })).mutation(async ({ input, ctx }) => {
    if (!ENV.openaiApiKey) throw new TRPCError({ code: "PRECONDITION_FAILED" });
    if (!take(String(ctx.account.id))) throw new TRPCError({ code: "TOO_MANY_REQUESTS" });
    try { return await createSafeRewrite(input.content, input.findings); } catch (error) { throw aiError(error); }
  }),
});
