import { describe, expect, it } from "vitest";
import { dateSequence, purposeRatiosSchema, weeklyStrategySchema } from "./contentStrategy";

const item = (day: number) => ({
  day, date: `2026-09-${String(day + 3).padStart(2, "0")}`, purpose: "education" as const,
  theme: `テーマ${day}`, hook: `フック${day}`, cta: "詳しくはこちら", format: "text" as const,
  recommendedTime: "09:00", trend: null, rationale: "実データまたは検証可能な仮説に基づく",
  expectedOutcome: "会話の増加", confidence: 0.5, hypothesis: true, factCheckWarning: null,
});

describe("7日間コンテンツ戦略の検証", () => {
  it("連続する7日と多様なテーマを受理する", () => {
    expect(dateSequence("2026-09-04")).toEqual(["2026-09-04", "2026-09-05", "2026-09-06", "2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10"]);
    expect(weeklyStrategySchema.safeParse({ goal: "問い合わせ", audience: "地域の顧客", coreMessage: "安心して相談できる", items: Array.from({ length: 7 }, (_, i) => item(i + 1)), warnings: [] }).success).toBe(true);
  });

  it("存在しない日付を拒否する", () => {
    expect(() => dateSequence("2026-02-31")).toThrow("invalid date");
  });

  it("テーマ偏りと販売偏重を拒否する", () => {
    const items = Array.from({ length: 7 }, (_, i) => ({ ...item(i + 1), theme: "同じテーマ", purpose: i < 4 ? "sales" as const : "education" as const }));
    const result = weeklyStrategySchema.safeParse({ goal: "販売", audience: "顧客", coreMessage: "案内", items, warnings: [] });
    expect(result.success).toBe(false);
  });

  it("目的比率は合計100だけを受理する", () => {
    expect(purposeRatiosSchema.safeParse({ awarenessEmpathy: 25, educationExpertise: 30, trustResults: 20, community: 15, salesInquiry: 10 }).success).toBe(true);
    expect(purposeRatiosSchema.safeParse({ awarenessEmpathy: 25, educationExpertise: 30, trustResults: 20, community: 15, salesInquiry: 20 }).success).toBe(false);
  });
});
