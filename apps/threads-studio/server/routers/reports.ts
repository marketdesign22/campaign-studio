import { z } from "zod";
import { router } from "../_core/trpc";
import { accountProcedure } from "../accountScope";
import {
  narrativeSchema,
  reportConfigSchema,
  reportMonthSchema,
} from "@shared/monthlyReport";
import {
  getReport,
  listReports,
  reportConfigWithDefaults,
  saveReportConfig,
  updateReport,
  createReport,
} from "../reportStore";
import { generateMonthlyReport } from "../reportService";
const monthInput = z.object({ month: reportMonthSchema });
const idInput = z.object({ id: z.string().uuid() });
export const reportsRouter = router({
  config: accountProcedure
    .input(monthInput)
    .query(({ ctx, input }) =>
      reportConfigWithDefaults(ctx.account.id, input.month)
    ),
  saveConfig: accountProcedure
    .input(monthInput.extend({ config: reportConfigSchema }))
    .mutation(async ({ ctx, input }) => {
      await saveReportConfig(ctx.account.id, input.month, input.config);
      return { ok: true };
    }),
  list: accountProcedure
    .input(monthInput)
    .query(({ ctx, input }) => listReports(ctx.account.id, input.month)),
  get: accountProcedure
    .input(idInput)
    .query(({ ctx, input }) => getReport(ctx.account.id, input.id)),
  generate: accountProcedure
    .input(monthInput)
    .mutation(({ ctx, input }) =>
      generateMonthlyReport(ctx.account, ctx.scope, input.month, ctx.user.id)
    ),
  saveNarrative: accountProcedure
    .input(
      idInput.extend({
        revision: z.number().int().positive(),
        narrative: narrativeSchema,
      })
    )
    .mutation(({ ctx, input }) =>
      updateReport(ctx.account.id, input.id, input.revision, {
        narrative: input.narrative,
        source: "edited",
      })
    ),
  setStatus: accountProcedure
    .input(
      idInput.extend({
        revision: z.number().int().positive(),
        status: z.enum(["reviewed", "sent"]),
      })
    )
    .mutation(({ ctx, input }) =>
      updateReport(ctx.account.id, input.id, input.revision, {
        status: input.status,
      })
    ),
  copy: accountProcedure.input(idInput).mutation(async ({ ctx, input }) => {
    const source = await getReport(ctx.account.id, input.id);
    return createReport(source.data, source.narrative, ctx.user.id);
  }),
});
