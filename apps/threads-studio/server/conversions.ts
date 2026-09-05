import crypto from "node:crypto";
import { z } from "zod";
import { calculateConversionMetrics, conversionEventInputSchema, conversionMetadataSchema, neutralizeSpreadsheetFormula } from "@shared/conversion";

const seenSignatures = new Map<string, number>();
export function verifyWebhookSignature(body: Buffer, timestampHeader: string | undefined, signatureHeader: string | undefined, secret: string, accountId: number, now = Date.now()): void {
  if (!secret || !timestampHeader || !signatureHeader) throw new Error("webhook authentication failed");
  const timestamp = Number(timestampHeader);
  if (!Number.isFinite(timestamp) || Math.abs(now - timestamp * 1000) > 5 * 60_000) throw new Error("webhook timestamp expired");
  const expected = crypto.createHmac("sha256", secret).update(`${timestamp}.${accountId}.`).update(body).digest("hex");
  const supplied = signatureHeader.replace(/^sha256=/, "");
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) throw new Error("webhook authentication failed");
  const replayKey = `${timestamp}:${supplied}`;
  if (seenSignatures.has(replayKey)) throw new Error("webhook replay detected");
  seenSignatures.set(replayKey, now);
  seenSignatures.forEach((time, key) => {
    if (now - time > 10 * 60_000) seenSignatures.delete(key);
  });
}

function parseCsvLine(line: string): string[] {
  const out: string[] = []; let cell = ""; let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"' && quoted && line[i + 1] === '"') { cell += '"'; i++; }
    else if (c === '"') quoted = !quoted;
    else if (c === ',' && !quoted) { out.push(cell); cell = ""; }
    else cell += c;
  }
  if (quoted) throw new Error("CSVの引用符が閉じていません");
  out.push(cell); return out;
}

export function parseConversionCsv(csv: string) {
  if (Buffer.byteLength(csv, "utf8") > 256_000) throw new Error("CSVが大きすぎます");
  const lines = csv.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2 || lines.length > 1001) throw new Error("CSVはヘッダーと1〜1000件のデータが必要です");
  const headers = parseCsvLine(lines[0]);
  const required = ["eventType", "eventTime", "quantity"];
  if (required.some((key) => !headers.includes(key))) throw new Error(`CSV必須列: ${required.join(", ")}`);
  return lines.slice(1).map((line, index) => {
    const cells = parseCsvLine(line);
    const raw = Object.fromEntries(headers.map((key, i) => [key, cells[i] ?? ""]));
    for (const [key, value] of Object.entries(raw)) if (key !== "note" && /^[=+\-@]/.test(value.trimStart())) throw new Error(`CSV ${index + 2}行目に数式形式があります`);
    return conversionEventInputSchema.parse({
      eventType: raw.eventType, eventTime: raw.eventTime, quantity: Number(raw.quantity),
      postId: raw.postId ? Number(raw.postId) : null, conversionGoalId: raw.conversionGoalId ? Number(raw.conversionGoalId) : null,
      valueCents: raw.valueCents ? Number(raw.valueCents) : null, currency: raw.currency || "JPY",
      externalEventId: raw.externalEventId || null, campaign: raw.campaign || null, note: raw.note ? neutralizeSpreadsheetFormula(raw.note) : null,
      source: "csv",
    });
  });
}

export function summarizeConversions(events: Array<{ eventType: string; quantity: number; valueCents: number | null }>, views: number | null) {
  const clicks = events.filter((e) => e.eventType === "link_click").reduce((n, e) => n + e.quantity, 0);
  const conversions = events.filter((e) => e.eventType !== "link_click").reduce((n, e) => n + e.quantity, 0);
  const valueCents = events.reduce((n, e) => n + (e.valueCents ?? 0), 0);
  return calculateConversionMetrics({ views, clicks, conversions, valueCents });
}

export const webhookPayloadSchema = z.object({
  externalEventId: z.string().min(1).max(160), eventType: z.enum(["link_click", "profile_visit", "follow", "inquiry", "booking", "lead", "purchase", "custom"]),
  eventTime: z.string().datetime(), quantity: z.number().int().min(1).max(10_000).default(1), postId: z.number().int().positive().nullable().optional(),
  conversionGoalId: z.number().int().positive().nullable().optional(), valueCents: z.number().int().min(0).max(2_000_000_000).nullable().optional(), currency: z.string().regex(/^[A-Z]{3}$/).default("JPY"),
  campaign: z.string().max(100).nullable().optional(), metadata: conversionMetadataSchema.optional(),
}).strict();
