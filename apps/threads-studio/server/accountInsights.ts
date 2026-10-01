/**
 * アカウント全体の日次インサイト（閲覧・クリック）の取得。日次メンテナンスから呼ぶ。
 *
 * - 直近30日ぶんを毎回上書き取得する（Threads 側で後から確定する値に追従するため）
 * - 指標ごとに別リクエスト。clicks が権限不足でも views は保存する
 * - 1アカウントの失敗が他を止めない。権限・認証エラーは警告のみ
 * - ログにはトークン・レスポンス本文を出さず、失敗の種別だけ残す
 */
import type { Account } from "../drizzle/schema";
import { listActiveAccounts, upsertAccountInsightsDaily } from "./db";
import { fetchAccountInsightDaily } from "./threadsApi";
import { classifyError, type ThreadsErrorKind } from "./threadsErrors";
import { TZ_NAMES, type Tz } from "./localTime";
import { primaryTimezone } from "@shared/postingSlots";

export const ACCOUNT_INSIGHTS_DAYS = 30;
const METRICS = ["views", "clicks"] as const;

export type AccountInsightsResult = {
  accountId: number;
  stored: number;
  errors: { metric: (typeof METRICS)[number]; kind: ThreadsErrorKind }[];
};

export async function fetchAccountInsightsForAccount(account: Account, now: Date = new Date()): Promise<AccountInsightsResult> {
  const timeZone = TZ_NAMES[primaryTimezone(account) as Tz];
  const since = new Date(now.getTime() - ACCOUNT_INSIGHTS_DAYS * 86_400_000);
  const result: AccountInsightsResult = { accountId: account.id, stored: 0, errors: [] };
  for (const metric of METRICS) {
    try {
      const points = await fetchAccountInsightDaily(account.threadsAccessToken, account.threadsUserId, metric, since, now, timeZone);
      for (const p of points) {
        await upsertAccountInsightsDaily(account.id, p.date, { [metric]: p.value });
        result.stored++;
      }
    } catch (e) {
      const kind = classifyError(e);
      // 権限不足などは警告だけ残し、他の指標・他のアカウントの取得は続ける
      console.warn(`[insights] account ${metric} fetch failed (account ${account.id}): ${kind}`);
      result.errors.push({ metric, kind });
    }
  }
  return result;
}

export async function fetchAccountInsights(now: Date = new Date()): Promise<AccountInsightsResult[]> {
  const out: AccountInsightsResult[] = [];
  for (const account of await listActiveAccounts()) {
    try {
      out.push(await fetchAccountInsightsForAccount(account, now));
    } catch (e) {
      console.warn(`[insights] unexpected failure for account ${account.id}: ${e instanceof Error ? e.name : "error"}`);
    }
  }
  return out;
}
