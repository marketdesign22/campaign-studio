/**
 * 月次レポートの自動生成。日次メンテナンスから呼ぶ。
 *
 * アカウントのタイムゾーンで月が替わったあと最初の日次メンテナンスで、前月分の
 * レポートを draft として作る（サーバーが1日に止まっていても取りこぼさない）。
 * 既にその月のレポートがあれば（draft/reviewed/sent いずれも）触らない。
 * 人が編集した文章や「レビュー済」「送付済」を上書きしないため。
 */
import type { Account } from "../drizzle/schema";
import { getReport, listAccounts, upsertReport } from "./db";
import { primaryAccountId, scopeOf } from "./accountScope";
import { getLocalParts, type Tz } from "./localTime";
import { primaryTimezone } from "@shared/postingSlots";
import { buildReportData } from "./reportBuilder";
import { generateReportNarrative } from "./reportNarrative";
import { ENV } from "./_core/env";
import { notifyOwner } from "./_core/notification";
import { parseYearMonth, shiftYearMonth, type ReportNarrative } from "@shared/report";

export type ReportMaintenanceResult = { accountId: number; yearMonth: string; action: "created" | "exists" | "failed" };

/** 前月（アカウントのローカル日付基準） */
export function previousMonthFor(account: Parameters<typeof primaryTimezone>[0], now: Date): string {
  const local = getLocalParts(now, primaryTimezone(account) as Tz);
  return shiftYearMonth(local.dateStr.slice(0, 7), -1);
}

export async function runMonthlyReportMaintenance(now: Date = new Date()): Promise<ReportMaintenanceResult[]> {
  const all = await listAccounts();
  const primaryId = primaryAccountId(all);
  const results: ReportMaintenanceResult[] = [];
  for (const account of all.filter((a) => a.active)) {
    const yearMonth = previousMonthFor(account, now);
    try {
      if (await getReport(account.id, yearMonth)) {
        results.push({ accountId: account.id, yearMonth, action: "exists" });
        continue;
      }
      const { year, month } = parseYearMonth(yearMonth);
      const data = await buildReportData(account, scopeOf(account, primaryId), year, month, now);
      let narrative: ReportNarrative | null = null;
      if (ENV.openaiApiKey) {
        try {
          narrative = await generateReportNarrative(data);
        } catch (e) {
          // 文章が作れなくても集計は保存する。画面から「文章を作り直す」で再試行できる
          console.warn(`[report] narrative failed for account ${account.id} ${yearMonth}: ${e instanceof Error ? e.name : "error"}`);
        }
      }
      await upsertReport(account.id, yearMonth, JSON.stringify(data), narrative ? JSON.stringify(narrative) : null, now);
      results.push({ accountId: account.id, yearMonth, action: "created" });
      await notifyOwner({
        title: `【${account.name}】${year}年${month}月の月次レポートの下書きができました`,
        content: [
          `${account.name} の ${year}年${month}月分の月次レポートを下書きとして作成しました。`,
          narrative ? "総評などの文章はAIの下書きです。内容を確認・編集してから「レビュー済」「送付済」にしてください。" : "文章の下書きは作成できませんでした。レポート画面の「文章を作り直す」からお試しください。",
          data.notes.length ? `データ注記: ${data.notes.join(" / ")}` : "",
        ].filter(Boolean).join("\n"),
      }).catch(() => undefined);
    } catch (e) {
      console.warn(`[report] monthly generation failed for account ${account.id} ${yearMonth}: ${e instanceof Error ? e.name : "error"}`);
      results.push({ accountId: account.id, yearMonth, action: "failed" });
    }
  }
  return results;
}
