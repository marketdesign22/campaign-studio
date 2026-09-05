import type { Request, Response } from "express";
import { ENV } from "./_core/env";
import { createConversionEvent, getAccountSettings, getOwnedConversionGoal, getOwnedPost, listAccounts } from "./db";
import { primaryAccountId, scopeOf } from "./accountScope";
import { verifyWebhookSignature, webhookPayloadSchema } from "./conversions";

const buckets = new Map<string, { start: number; count: number }>();
export async function conversionWebhookHandler(req: Request, res: Response) {
  try {
    const accountId = Number(req.params.accountId);
    if (!Number.isInteger(accountId) || accountId <= 0 || !Buffer.isBuffer(req.body)) return res.status(400).json({ error: "invalid request" });
    const key = String(accountId), now = Date.now(), bucket = buckets.get(key);
    if (bucket && now - bucket.start < 60_000 && bucket.count >= 120) return res.status(429).json({ error: "rate limited" });
    buckets.set(key, !bucket || now - bucket.start >= 60_000 ? { start: now, count: 1 } : { ...bucket, count: bucket.count + 1 });
    verifyWebhookSignature(req.body, req.header("x-webhook-timestamp"), req.header("x-webhook-signature"), ENV.conversionWebhookSecret, accountId, now);
    const payload = webhookPayloadSchema.parse(JSON.parse(req.body.toString("utf8")));
    const accounts = await listAccounts(); const account = accounts.find((x) => x.id === accountId);
    if (!account) return res.status(404).json({ error: "account not found" });
    if (!(await getAccountSettings(accountId)).conversionTrackingEnabled) return res.status(403).json({ error: "tracking disabled" });
    const scope = scopeOf(account, primaryAccountId(accounts));
    if (payload.postId && !await getOwnedPost(payload.postId, scope)) return res.status(404).json({ error: "post not found" });
    if (payload.conversionGoalId && !await getOwnedConversionGoal(payload.conversionGoalId, accountId)) return res.status(404).json({ error: "goal not found" });
    const result = await createConversionEvent(accountId, { ...payload, eventTime: new Date(payload.eventTime), metadata: payload.metadata ? JSON.stringify(payload.metadata) : null, source: "webhook", registeredBy: null });
    return res.status(result.duplicate ? 200 : 201).json({ ok: true, duplicate: result.duplicate, id: result.id });
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid webhook";
    const status = /authentication|timestamp|replay/.test(message) ? 401 : 400;
    return res.status(status).json({ error: status === 401 ? "webhook rejected" : "invalid payload" });
  }
}
