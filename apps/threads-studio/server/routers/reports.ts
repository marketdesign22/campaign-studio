/**
 * 月次レポートAPI（クライアント提出用）。
 *
 * - すべて accountProcedure。保存済みレポート・目標値はアカウント単位
 * - get は保存済みがあればそれを、無ければその場で集計した結果を saved=false で返す
 * - 送付済（sent）のレポートは再生成・文章の変更ができない（提出した内容を固定する）
 * - 目標値の保存は管理者のみ
 * - AI の生レスポンス・APIキーは返さない
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { getReport, listKpiTargets, saveKpiTargets, updateReport, upsertReport } from "../db";
import { buildReportData } from "../reportBuilder";
import { generateReportNarrative } from "../reportNarrative";
import { aiError } from "../aiSupport";
import { ENV } from "../_core/env";
import { accountProcedure } from "../accountScope";
import { router } from "../_core/trpc";
import {
  KPI_KEYS, narrativeSchema, REPORT_STATUSES, yearMonthOf, type KpiKey, type ReportData, type ReportNarrative,
} from "@shared/report";

const MONTH_INPUT = z.object({ year: z.number().int().min(2020).max(2100), month: z.number().int().min(1).max(12) });

function parseNarrative(raw: string | null): ReportNarrative | null {
  if (!raw) return null;
  const parsed = narrativeSchema.safeParse(JSON.parse(raw));
  return parsed.success ? parsed.data : null;
}

function requireAi() {
  if (!ENV.openaiApiKey) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "AI設定が必要です。OPENAI_API_KEY を設定してください。" });
}

function requireEditable(status: string) {
  if (status === "sent") throw new TRPCError({ code: "PRECONDITION_FAILED", message: "送付済のレポートは変更できません。変更する場合は先に「レビュー済」へ戻してください。" });
}

export const reportsRouter = router({
  get: accountProcedure.input(MONTH_INPUT).query(async ({ input, ctx }) => {
    const yearMonth = yearMonthOf(input.year, input.month);
    const saved = await getReport(ctx.account.id, yearMonth);
    if (saved) {
      return {
        saved: true as const,
        status: saved.status,
        data: JSON.parse(saved.dataJson) as ReportData,
        narrative: parseNarrative(saved.narrativeJson),
        generatedAt: saved.generatedAt,
        reviewedAt: saved.reviewedAt,
        sentAt: saved.sentAt,
        aiAvailable: !!ENV.openaiApiKey,
      };
    }
    const data = await buildReportData(ctx.account, ctx.scope, input.year, input.month);
    return {
      saved: false as const, status: null, data, narrative: null,
      generatedAt: null, reviewedAt: null, sentAt: null, aiAvailable: !!ENV.openaiApiKey,
    };
  }),

  /** 集計して保存し、文章も生成する。送付済は再生成不可 */
  generate: accountProcedure
    .input(MONTH_INPUT.extend({ withNarrative: z.boolean().default(true) }))
    .mutation(async ({ input, ctx }) => {
      const yearMonth = yearMonthOf(input.year, input.month);
      const existing = await getReport(ctx.account.id, yearMonth);
      if (existing) requireEditable(existing.status);
      const now = new Date();
      const data = await buildReportData(ctx.account, ctx.scope, input.year, input.month, now);
      let narrative: ReportNarrative | null = null;
      let narrativeError: string | null = null;
      if (input.withNarrative && ENV.openaiApiKey) {
        try {
          narrative = await generateReportNarrative(data);
        } catch (e) {
          // 文章が作れなくても集計は保存する。理由は日本語の定型文で返す
          narrativeError = aiError(e).message;
        }
      }
      await upsertReport(ctx.account.id, yearMonth, JSON.stringify(data), narrative ? JSON.stringify(narrative) : null, now);
      return { ok: true, narrativeError };
    }),

  /** 保存済みの集計から文章だけ作り直す */
  regenerateNarrative: accountProcedure.input(MONTH_INPUT).mutation(async ({ input, ctx }) => {
    requireAi();
    const yearMonth = yearMonthOf(input.year, input.month);
    const saved = await getReport(ctx.account.id, yearMonth);
    if (!saved) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "先にレポートを生成してください。" });
    requireEditable(saved.status);
    try {
      const narrative = await generateReportNarrative(JSON.parse(saved.dataJson) as ReportData);
      await updateReport(ctx.account.id, yearMonth, { narrativeJson: JSON.stringify(narrative) });
      return { narrative };
    } catch (e) {
      throw aiError(e);
    }
  }),

  /** 人が編集した文章を保存する */
  saveNarrative: accountProcedure
    .input(MONTH_INPUT.extend({ narrative: narrativeSchema }))
    .mutation(async ({ input, ctx }) => {
      const yearMonth = yearMonthOf(input.year, input.month);
      const saved = await getReport(ctx.account.id, yearMonth);
      if (!saved) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "先にレポートを生成してください。" });
      requireEditable(saved.status);
      await updateReport(ctx.account.id, yearMonth, { narrativeJson: JSON.stringify(input.narrative) });
      return { ok: true };
    }),

  setStatus: accountProcedure
    .input(MONTH_INPUT.extend({ status: z.enum(REPORT_STATUSES) }))
    .mutation(async ({ input, ctx }) => {
      const yearMonth = yearMonthOf(input.year, input.month);
      const saved = await getReport(ctx.account.id, yearMonth);
      if (!saved) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "先にレポートを生成してください。" });
      const now = new Date();
      await updateReport(ctx.account.id, yearMonth, {
        status: input.status,
        reviewedAt: input.status === "draft" ? null : (saved.reviewedAt ?? now),
        sentAt: input.status === "sent" ? now : null,
      });
      return { ok: true };
    }),

  targets: accountProcedure.input(MONTH_INPUT).query(async ({ input, ctx }) => {
    const yearMonth = yearMonthOf(input.year, input.month);
    const rows = await listKpiTargets(ctx.account.id, yearMonth, yearMonth);
    const out = Object.fromEntries(KPI_KEYS.map((k) => [k, null])) as Record<KpiKey, number | null>;
    for (const r of rows) if ((KPI_KEYS as readonly string[]).includes(r.metric)) out[r.metric as KpiKey] = r.target;
    return out;
  }),

  /** 目標値の保存（管理者のみ）。null は未設定に戻す */
  saveTargets: accountProcedure
    .input(MONTH_INPUT.extend({
      // 一部の指標だけ送ってもよい（送った指標だけ更新する）
      targets: z.partialRecord(z.enum(KPI_KEYS), z.number().min(0).max(1_000_000_000_000).nullable()),
    }))
    .mutation(async ({ input, ctx }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN", message: "目標値の変更は管理者のみ行えます。" });
      await saveKpiTargets(ctx.account.id, yearMonthOf(input.year, input.month), input.targets);
      return { ok: true };
    }),
});
