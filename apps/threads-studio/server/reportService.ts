import { listAccounts } from "./db";
import { primaryAccountId, scopeOf, type AccountScope } from "./accountScope";
import type { Account } from "../drizzle/schema";
import {
  autoReportExists,
  collectReportData,
  createReport,
  reportConfigWithDefaults,
  updateReport,
} from "./reportStore";
import { generateReportNarrative, templateNarrative } from "./reportNarrative";
import {
  localReportParts,
  REPORT_TIMEZONES,
  shiftMonth,
} from "./reportBuilder";
import { primaryTimezone } from "@shared/postingSlots";
import { ENV } from "./_core/env";
import { TRPCError } from "@trpc/server";

const generating = new Set<number>();
export async function generateMonthlyReport(
  account: Account,
  scope: AccountScope,
  month: string,
  userId: number | null,
  auto = false
) {
  if (generating.has(account.id))
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: "レポートを生成中です。少し待ってください。",
    });
  generating.add(account.id);
  try {
    const data = await collectReportData(account, scope, month);
    let saved = await createReport(
      data,
      templateNarrative(data),
      userId,
      auto ? `${account.id}:${month}` : null
    );
    let aiWarning: string | null = null;
    if (ENV.openaiApiKey) {
      try {
        const narrative = await generateReportNarrative(data);
        saved = await updateReport(account.id, saved.id, saved.revision, {
          narrative,
          source: "ai",
        });
      } catch {
        aiWarning =
          "AI文章を生成できなかったため、数値に基づく標準文で下書きを保存しました。";
      }
    } else
      aiWarning =
        "AIが未設定のため、数値に基づく標準文で下書きを保存しました。";
    return { report: saved, aiWarning };
  } finally {
    generating.delete(account.id);
  }
}
// Run after daily collection. The unique autoKey makes retry / multiple instances safe.
// Previous month is generated even if the first day tick was missed. No client delivery.
export async function runMonthlyReportMaintenance(now = new Date()) {
  const all = await listAccounts();
  const primary = primaryAccountId(all);
  if (primary === null) return;
  for (const account of all.filter(a => a.active)) {
    try {
      const month = shiftMonth(
        localReportParts(
          now,
          REPORT_TIMEZONES[primaryTimezone(account)]
        ).date.slice(0, 7),
        -1
      );
      const cfg = await reportConfigWithDefaults(account.id, month);
      if (!cfg.autoGenerate || (await autoReportExists(account.id, month)))
        continue;
      await generateMonthlyReport(
        account,
        scopeOf(account, primary),
        month,
        null,
        true
      );
      console.info(`[reports] monthly draft ready for account ${account.id}`);
    } catch {
      console.warn(
        `[reports] monthly draft could not be created for account ${account.id}; retry on next maintenance`
      );
    }
  }
}
