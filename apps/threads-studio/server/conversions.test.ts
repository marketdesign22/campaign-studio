import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseConversionCsv, summarizeConversions, verifyWebhookSignature, webhookPayloadSchema } from "./conversions";

describe("成果イベント入力", () => {
  it("署名・時刻・アカウントIDを検証し、リプレイを拒否する", () => {
    const body = Buffer.from('{"event":"ok"}'); const secret = "test-secret"; const now = Date.UTC(2026, 8, 4); const timestamp = String(now / 1000);
    const signature = crypto.createHmac("sha256", secret).update(`${timestamp}.7.`).update(body).digest("hex");
    verifyWebhookSignature(body, timestamp, `sha256=${signature}`, secret, 7, now);
    expect(() => verifyWebhookSignature(body, timestamp, signature, secret, 7, now)).toThrow("replay");
    expect(() => verifyWebhookSignature(body, timestamp, signature, secret, 8, now)).toThrow("authentication");
  });

  it("期限切れ署名を拒否する", () => {
    const body = Buffer.from("{}"); const secret = "s"; const now = Date.UTC(2026, 8, 4); const timestamp = String((now - 6 * 60_000) / 1000);
    const signature = crypto.createHmac("sha256", secret).update(`${timestamp}.1.`).update(body).digest("hex");
    expect(() => verifyWebhookSignature(body, timestamp, signature, secret, 1, now)).toThrow("expired");
  });

  it("CSVを検証し、メモの数式を無害化する", () => {
    const rows = parseConversionCsv("eventType,eventTime,quantity,valueCents,note,externalEventId\ninquiry,2026-09-04T00:00:00.000Z,2,1200,=1+1,evt-1");
    expect(rows).toHaveLength(1); expect(rows[0].note).toBe("'=1+1"); expect(rows[0].valueCents).toBe(1200);
    expect(() => parseConversionCsv("eventType,eventTime,quantity\n=cmd,2026-09-04T00:00:00.000Z,1")).toThrow("数式形式");
  });

  it("不正JSON相当の余分なWebhook項目を拒否する", () => {
    expect(webhookPayloadSchema.safeParse({ externalEventId: "x", eventType: "inquiry", eventTime: "2026-09-04T00:00:00.000Z", quantity: 1, email: "dont-store@example.com" }).success).toBe(false);
    expect(webhookPayloadSchema.safeParse({ externalEventId: "x", eventType: "inquiry", eventTime: "2026-09-04T00:00:00.000Z", quantity: 1, metadata: { ip_address: "127.0.0.1" } }).success).toBe(false);
  });

  it("金額と率を正しく集計する", () => {
    const summary = summarizeConversions([{ eventType: "link_click", quantity: 10, valueCents: null }, { eventType: "purchase", quantity: 2, valueCents: 50_000 }], 100);
    expect(summary).toMatchObject({ clicks: 10, conversions: 2, valueCents: 50_000, clickRate: 10, conversionRate: 20, postResultRate: 2 });
  });
});
