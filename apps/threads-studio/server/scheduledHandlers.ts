import { Request, Response } from "express";
import { ENV } from "./_core/env";
import { getLocalParts, runSlotForAccount, runTick } from "./scheduler";
import { listAccounts } from "./db";
import { primaryAccountId, scopeOf } from "./accountScope";

/**
 * 外部cron（Railway cron・GitHub Actions等）から叩く場合の認可。
 * `Authorization: Bearer $CRON_SECRET` または `x-cron-secret` ヘッダーで照合する。
 * CRON_SECRET 未設定時は外部からの起動を拒否する（内蔵スケジューラが
 * server/cron.ts で15分ごとに runTick を直接呼ぶため、通常は設定不要）。
 */
async function requireCron(req: Request, res: Response): Promise<boolean> {
  if (!ENV.cronSecret) {
    res.status(403).json({
      error: "External cron is disabled. Set CRON_SECRET to enable, or rely on the built-in scheduler.",
    });
    return false;
  }
  const auth = req.headers.authorization;
  const bearer = typeof auth === "string" && auth.startsWith("Bearer ") ? auth.slice(7) : undefined;
  const headerSecret = req.headers["x-cron-secret"];
  const provided = bearer ?? (typeof headerSecret === "string" ? headerSecret : undefined);
  if (provided !== ENV.cronSecret) {
    res.status(403).json({ error: "unauthorized" });
    return false;
  }
  return true;
}

/**
 * Main scheduler entry — the built-in scheduler (server/cron.ts) runs this
 * every 15 minutes in-process. The HTTP endpoint remains for external cron
 * services (guarded by CRON_SECRET). Fires each account's morning/evening
 * slot at its configured local time, refreshes tokens, and pulls analytics
 * once a day.
 */
export async function tickHandler(req: Request, res: Response) {
  if (!(await requireCron(req, res))) return;
  try {
    const result = await runTick(new Date());
    return res.json({ ok: true, ...result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: msg, timestamp: new Date().toISOString() });
  }
}

/** Legacy fixed-time endpoints — kept so existing cron registrations still work. */
async function runLegacySlot(slotIndex: number, res: Response) {
  try {
    const all = await listAccounts();
    const accounts = all.filter((a) => a.active);
    if (accounts.length === 0) {
      return res.status(200).json({ ok: false, reason: "Threads credentials not configured" });
    }
    const primaryId = primaryAccountId(all);
    const now = new Date();
    const fired: Record<string, unknown>[] = [];
    for (const account of accounts) {
      // 旧cronは時刻固定で叩かれるため、スロット時刻の到来チェックはスキップし
      // 日次ロックと予約日フィルタのみ適用する
      const local = getLocalParts(now, account.timezone);
      const r = await runSlotForAccount(
        // 時刻0の2枠として扱い、到来チェックを実質無効化する
        { ...account, slots: null, morningHour: 0, morningMinute: 0, eveningHour: 0, eveningMinute: 0 },
        scopeOf(account, primaryId),
        slotIndex,
        now
      );
      if (r) fired.push({ account: account.id, localDate: local.dateStr, ...r });
    }
    const hasError = fired.some((f) => f.error);
    return res.status(hasError ? 500 : 200).json({ ok: !hasError, fired });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: msg, timestamp: new Date().toISOString() });
  }
}

export async function morningPostHandler(req: Request, res: Response) {
  if (!(await requireCron(req, res))) return;
  return runLegacySlot(0, res);
}

export async function eveningPostHandler(req: Request, res: Response) {
  if (!(await requireCron(req, res))) return;
  return runLegacySlot(1, res);
}
