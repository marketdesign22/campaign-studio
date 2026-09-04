import { z } from "zod";

export const purposeRatiosSchema = z.object({
  awarenessEmpathy: z.number().int().min(0).max(100),
  educationExpertise: z.number().int().min(0).max(100),
  trustResults: z.number().int().min(0).max(100),
  community: z.number().int().min(0).max(100),
  salesInquiry: z.number().int().min(0).max(100),
}).strict().refine((value) => Object.values(value).reduce((sum, ratio) => sum + ratio, 0) === 100, {
  message: "投稿目的の比率合計は100%にしてください",
});

export const DEFAULT_PURPOSE_RATIOS = {
  awarenessEmpathy: 25,
  educationExpertise: 30,
  trustResults: 20,
  community: 15,
  salesInquiry: 10,
} as const;

export function parsePurposeRatios(value: string | null | undefined) {
  if (!value) return DEFAULT_PURPOSE_RATIOS;
  try { return purposeRatiosSchema.parse(JSON.parse(value)); }
  catch { return DEFAULT_PURPOSE_RATIOS; }
}

export const strategyItemSchema = z.object({
  day: z.number().int().min(1).max(7), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  purpose: z.enum(["awareness", "empathy", "education", "expertise", "case_study", "trust", "faq", "comparison", "behind_scenes", "inquiry", "sales"]),
  theme: z.string().min(1).max(160), hook: z.string().min(1).max(200), cta: z.string().max(200),
  format: z.enum(["text", "image", "question", "story", "list"]), recommendedTime: z.string().regex(/^\d{2}:\d{2}$/),
  trend: z.string().max(160).nullable(), rationale: z.string().min(1).max(500), expectedOutcome: z.string().max(300),
  confidence: z.number().min(0).max(1), hypothesis: z.boolean(), factCheckWarning: z.string().max(300).nullable(),
});
export const weeklyStrategySchema = z.object({
  goal: z.string().min(1).max(300), audience: z.string().min(1).max(300), coreMessage: z.string().min(1).max(500),
  items: z.array(strategyItemSchema).length(7), warnings: z.array(z.string().max(300)).max(20),
}).strict().superRefine((value, ctx) => {
  if (new Set(value.items.map((x) => x.date)).size !== 7) ctx.addIssue({ code: "custom", path: ["items"], message: "7日分の日付が必要です" });
  if (new Set(value.items.map((x) => x.theme.trim().toLowerCase())).size < 5) ctx.addIssue({ code: "custom", path: ["items"], message: "テーマが偏っています" });
  if (value.items.filter((x) => x.purpose === "sales" || x.purpose === "inquiry").length > 3) ctx.addIssue({ code: "custom", path: ["items"], message: "販売投稿が多すぎます" });
});
export type WeeklyStrategy = z.infer<typeof weeklyStrategySchema>;

export const weeklyReviewSchema = z.object({
  summary: z.string().min(1).max(1000), topPost: z.string().max(500).nullable(), lowPost: z.string().max(500).nullable(),
  continueThemes: z.array(z.string().max(160)).max(10), stopThemes: z.array(z.string().max(160)).max(10),
  nextHypotheses: z.array(z.string().max(300)).max(10), confidence: z.number().min(0).max(1), sampleWarning: z.string().max(300).nullable(),
}).strict();

export function dateSequence(start: string): string[] {
  const base = new Date(`${start}T12:00:00Z`);
  if (Number.isNaN(base.getTime()) || base.toISOString().slice(0, 10) !== start) throw new Error("invalid date");
  return Array.from({ length: 7 }, (_, i) => new Date(base.getTime() + i * 86_400_000).toISOString().slice(0, 10));
}
