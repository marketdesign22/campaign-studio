import { z } from "zod";
import { getAnalyticsSummary, getMonthlyReport, getTopPosts, getTopPostsByPeriod } from "../db";
import { fetchAnalyticsForRecentPosts } from "../scheduler";
import { accountProcedure } from "../accountScope";
import { router } from "../_core/trpc";

export const analyticsRouter = router({
  /** 月次レポート（クライアント報告用）。選択中アカウント分のみ */
  monthlyReport: accountProcedure
    .input(z.object({ year: z.number().int().min(2020).max(2100), month: z.number().int().min(1).max(12) }))
    .query(async ({ input, ctx }) => getMonthlyReport(input.year, input.month, ctx.scope)),

  /**
   * Threads Insights を今すぐ取得（通常は日次で自動実行）。
   * 取得処理自体はログの accountId ごとに正しいトークンを選ぶため、
   * ここでアカウントを絞る必要はない（絞ると他アカウントの数値が古いままになる）。
   */
  refreshNow: accountProcedure.mutation(async () => {
    await fetchAnalyticsForRecentPosts();
    return { ok: true };
  }),

  summary: accountProcedure
    .input(z.object({ period: z.enum(["day", "week", "month"]).default("week") }))
    .query(async ({ input, ctx }) => getAnalyticsSummary(input.period, ctx.scope)),

  topPosts: accountProcedure
    .input(z.object({ limit: z.number().int().min(1).max(50).default(10) }))
    .query(async ({ input, ctx }) => getTopPosts(input.limit, ctx.scope)),

  topPostsByPeriod: accountProcedure
    .input(z.object({
      period: z.enum(["day", "week", "month"]).default("week"),
      limit: z.number().int().min(1).max(20).default(5),
    }))
    .query(async ({ input, ctx }) => getTopPostsByPeriod(input.period, input.limit, ctx.scope)),
});
