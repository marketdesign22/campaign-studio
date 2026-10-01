/**
 * 月次レポートの文章生成。LLM はモックする。
 *
 * - AI に渡すのは数値要約だけ（投稿本文は冒頭60文字まで）
 * - 出力は zod で検証し、形式が合わなければ「解釈できない」種別のエラー
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./_core/llm", () => ({ invokeLLM: vi.fn() }));

import * as llm from "./_core/llm";
import { classifyAiError } from "./aiSupport";
import { generateReportNarrative, narrativeInput } from "./reportNarrative";
import type { ReportData } from "@shared/report";

const longExcerpt = "あ".repeat(60) + "…";
const DATA: ReportData = {
  accountName: "SCSU.Japan", yearMonth: "2026-09", period: { from: "2026-09-01", to: "2026-09-30" }, timezone: "Asia/Tokyo",
  generatedAt: "2026-10-01T00:00:00.000Z",
  kpis: [
    { key: "posts", current: 12, previous: 10, target: null, pctChange: 20, achievement: null },
    { key: "views", current: 3456.78, previous: null, target: 4000, pctChange: null, achievement: 86.42 },
    { key: "engagements", current: 200, previous: 150, target: null, pctChange: 33.333, achievement: null },
    { key: "engagementRate", current: 5.78, previous: null, target: null, pctChange: null, achievement: null },
    { key: "followerNet", current: null, previous: null, target: null, pctChange: null, achievement: null },
    { key: "linkClicks", current: 3, previous: 0, target: null, pctChange: null, achievement: null },
    { key: "conversions", current: 1, previous: 1, target: null, pctChange: 0, achievement: null },
  ],
  monthly: Array.from({ length: 12 }, (_, i) => ({ yearMonth: `2026-${String(i + 1).padStart(2, "0")}`, posts: i, views: i * 100, engagements: i, engagementRate: null, followerNet: null, linkClicks: null, conversions: null, viewsTarget: null })),
  daily: [],
  topPosts: [{ logId: 1, excerpt: longExcerpt, postedAt: "2026-09-02T03:00:00.000Z", views: 500, engagements: 40, engagementRate: 8, likes: 30, replies: 5, reposts: 3, quotes: 1, shares: 1 }],
  bottomPosts: [],
  byCategory: [{ name: "体験談", posts: 5, views: 1000, engagements: 60, engagementRate: 6, avgViews: 200 }],
  byCampaign: [],
  heatmap: [{ weekday: 2, hour: 12, posts: 3, avgViews: 250, engagementRate: 7 }],
  conversions: { trackingEnabled: true, linkClicks: 3, conversions: 1, valueCents: 500000, byGoal: [], byCampaign: [] },
  notes: ["フォロワー数の履歴がまだありません。"],
};
const llmReply = (content: string) => ({ id: "x", model: "test", choices: [{ index: 0, finish_reason: null, message: { role: "assistant" as const, content } }] });

beforeEach(() => { vi.clearAllMocks(); vi.spyOn(console, "warn").mockImplementation(() => {}); });

describe("narrativeInput", () => {
  it("数値要約だけを渡す。本文は冒頭60文字（+…）まで、null はそのまま null", () => {
    const input = narrativeInput(DATA);
    expect(input.topPosts[0].excerpt.length).toBeLessThanOrEqual(61);
    expect(input.kpis.find((k) => k.metric === "フォロワー純増")!.current).toBeNull();
    expect(input.kpis.find((k) => k.metric === "閲覧数")!.current).toBe(3456.8);
    expect(input.recentMonths).toHaveLength(3);
    expect(input.bestTimeSlots[0]).toEqual({ weekday: "火", hour: 12, posts: 3, avgViews: 250 });
    expect(input.notes).toEqual(["フォロワー数の履歴がまだありません。"]);
    expect(JSON.stringify(input)).not.toContain("daily");
  });

  it("CV計測が無効なら「計測無効」とだけ伝える", () => {
    const input = narrativeInput({ ...DATA, conversions: { ...DATA.conversions, trackingEnabled: false, linkClicks: null, conversions: null, valueCents: null } });
    expect(input.conversions).toBe("計測無効");
  });
});

describe("generateReportNarrative", () => {
  it("システムプロンプトで制約と出力形式を伝え、JSON を検証して返す", async () => {
    const reply = { summary: "9月は閲覧数が3,456.8でした。", highlights: ["体験談カテゴリーの反応率が6%でした"], issues: [], actions: [{ title: "体験談を週2本", detail: "反応率が高いため" }], extra: "捨てる" };
    vi.mocked(llm.invokeLLM).mockResolvedValue(llmReply(JSON.stringify(reply)) as never);
    const r = await generateReportNarrative(DATA);
    expect(r).toEqual({ summary: reply.summary, highlights: reply.highlights, issues: [], actions: reply.actions });
    const call = vi.mocked(llm.invokeLLM).mock.calls[0][0];
    const system = String(call.messages[0].content);
    for (const must of ["数値・名前以外を使わない", "5件未満", "因果", "敬体", '"summary"', '"actions"']) expect(system).toContain(must);
    expect(call.responseFormat).toEqual({ type: "json_object" });
    expect(String(call.messages[1].content)).toContain("UNTRUSTED_REPORT_DATA");
  });

  it("形式が合わない出力は「解釈できない」種別のエラーにし、本文はログに出さない", async () => {
    vi.mocked(llm.invokeLLM).mockResolvedValue(llmReply(JSON.stringify({ summary: "", highlights: "SECRET-BODY" })) as never);
    const err = await generateReportNarrative(DATA).catch((e) => e as Error);
    expect(classifyAiError(err)).toBe("invalid_output");
    expect(vi.mocked(console.warn).mock.calls.flat().join(" ")).not.toContain("SECRET-BODY");
  });
});
