import { z } from "zod";

export const conversionGoalTypeSchema = z.enum([
  "follow", "profile_visit", "website_visit", "inquiry", "document_request",
  "consultation", "booking", "purchase", "email_signup", "phone", "custom",
]);
export const conversionEventTypeSchema = z.enum(["link_click", "profile_visit", "follow", "inquiry", "booking", "lead", "purchase", "custom"]);
export const conversionMetadataSchema = z.record(z.string(), z.union([z.string().max(500), z.number(), z.boolean(), z.null()])).superRefine((value, ctx) => {
  const keys = Object.keys(value);
  if (keys.length > 30) ctx.addIssue({ code: "custom", message: "metadataは30項目以内です" });
  const sensitive = keys.find((key) => /(^|_)(email|e_mail|ip|ip_address|cookie|phone|telephone|full_name|first_name|last_name|address|user_agent)($|_)/i.test(key));
  if (sensitive) ctx.addIssue({ code: "custom", path: [sensitive], message: "個人を追跡する項目は保存できません" });
});
export const conversionGoalInputSchema = z.object({
  name: z.string().trim().min(1).max(80), type: conversionGoalTypeSchema,
  destinationUrl: z.string().trim().max(2048).nullable(), enabled: z.boolean(),
  priority: z.number().int().min(1).max(5), valueCents: z.number().int().min(0).max(2_000_000_000).nullable(),
  currency: z.string().regex(/^[A-Z]{3}$/).default("JPY"), region: z.string().trim().max(80).nullable(),
  campaign: z.string().trim().max(100).nullable(), attributionDays: z.number().int().min(1).max(365), primary: z.boolean(),
}).superRefine((v, ctx) => { if (v.destinationUrl) try { assertHttpUrl(v.destinationUrl); } catch { ctx.addIssue({ code: "custom", path: ["destinationUrl"], message: "http/httpsの安全なURLを入力してください" }); } });

export const conversionEventInputSchema = z.object({
  postId: z.number().int().positive().nullable().optional(), postLogId: z.number().int().positive().nullable().optional(),
  campaignId: z.number().int().positive().nullable().optional(), conversionGoalId: z.number().int().positive().nullable().optional(),
  eventType: conversionEventTypeSchema, eventTime: z.coerce.date(), quantity: z.number().int().min(1).max(10_000).default(1),
  valueCents: z.number().int().min(0).max(2_000_000_000).nullable().optional(), currency: z.string().regex(/^[A-Z]{3}$/).default("JPY"),
  source: z.string().trim().max(100).nullable().optional(), medium: z.string().trim().max(100).nullable().optional(),
  campaign: z.string().trim().max(100).nullable().optional(), content: z.string().trim().max(100).nullable().optional(),
  externalEventId: z.string().trim().max(160).nullable().optional(), metadata: conversionMetadataSchema.optional(),
  note: z.string().trim().max(500).nullable().optional(),
});

export function assertHttpUrl(input: string): URL {
  const url = new URL(input);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error("invalid URL");
  return url;
}

export function buildUtmUrl(base: string, values: { source: string; medium: string; campaign: string; content?: string; term?: string }): string {
  const url = assertHttpUrl(base.trim());
  const set = (name: string, value?: string) => value?.trim() ? url.searchParams.set(name, value.trim()) : url.searchParams.delete(name);
  set("utm_source", values.source); set("utm_medium", values.medium); set("utm_campaign", values.campaign);
  set("utm_content", values.content); set("utm_term", values.term);
  const output = url.toString();
  if (output.length > 4096) throw new Error("URL is too long");
  return output;
}

export function safePercent(numerator: number | null, denominator: number | null): number | null {
  if (numerator === null || denominator === null || denominator <= 0) return null;
  return numerator / denominator * 100;
}

export type ConversionMetrics = { views: number | null; clicks: number; conversions: number; valueCents: number; clickRate: number | null; conversionRate: number | null; postResultRate: number | null };
export function calculateConversionMetrics(input: { views: number | null; clicks: number; conversions: number; valueCents: number }): ConversionMetrics {
  return { ...input, clickRate: safePercent(input.clicks, input.views), conversionRate: safePercent(input.conversions, input.clicks), postResultRate: safePercent(input.conversions, input.views) };
}

export function neutralizeSpreadsheetFormula(value: string): string {
  return /^[=+\-@]/.test(value.trimStart()) ? `'${value}` : value;
}
