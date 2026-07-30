import { z } from "zod";
import { getAnalyticsSummary, getMonthlyReport, getTopPosts, getTopPostsByPeriod } from "../db";
import { fetchAnalyticsForRecentPosts } from "../scheduler";
import { protectedProcedure, router } from "../_core/trpc";

export const analyticsRouter = router({
  /** 月次レポート（クライアント報告用） */
  monthlyReport: protectedProcedure
    .input(z.object({ year: z.number().int().min(2020).max(2100), month: z.number().int().min(1).max(12) }))
    .query(async ({ input }) => getMonthlyReport(input.year, input.month)),

  /** Threads Insights を今すぐ取得（通常は日次で自動実行） */
  refreshNow: protectedProcedure.mutation(async () => {
    await fetchAnalyticsForRecentPosts();
    return { ok: true };
  }),

  summary: protectedProcedure
    .input(z.object({ period: z.enum(["day", "week", "month"]).default("week") }))
    .query(async ({ input }) => getAnalyticsSummary(input.period)),

  topPosts: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(50).default(10) }))
    .query(async ({ input }) => getTopPosts(input.limit)),

  topPostsByPeriod: protectedProcedure
    .input(z.object({
      period: z.enum(["day", "week", "month"]).default("week"),
      limit: z.number().int().min(1).max(20).default(5),
    }))
    .query(async ({ input }) => getTopPostsByPeriod(input.period, input.limit)),
});
