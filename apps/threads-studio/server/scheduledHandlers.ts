import { Request, Response } from "express";
import { sdk } from "./_core/sdk";
import { getLocalParts, runSlotForAccount, runTick } from "./scheduler";
import { listActiveAccounts } from "./db";

async function requireCron(req: Request, res: Response): Promise<boolean> {
  try {
    const user = await sdk.authenticateRequest(req);
    if (!user.isCron) { res.status(403).json({ error: "cron-only" }); return false; }
    return true;
  } catch {
    res.status(403).json({ error: "unauthorized" });
    return false;
  }
}

/**
 * Main scheduler entry — register this as a 15-minute cron:
 *   manus-heartbeat create --name threads-tick --cron "0 *\/15 * * * *" --path /api/scheduled/tick
 * Fires each account's morning/evening slot at its configured local time,
 * refreshes tokens, and pulls analytics once a day.
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
    const accounts = await listActiveAccounts();
    if (accounts.length === 0) {
      return res.status(200).json({ ok: false, reason: "Threads credentials not configured" });
    }
    const now = new Date();
    const fired: Record<string, unknown>[] = [];
    for (const account of accounts) {
      // 旧cronは時刻固定で叩かれるため、スロット時刻の到来チェックはスキップし
      // 日次ロックと予約日フィルタのみ適用する
      const local = getLocalParts(now, account.timezone);
      const r = await runSlotForAccount(
        { ...account, morningHour: 0, morningMinute: 0, eveningHour: 0, eveningMinute: 0 },
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
