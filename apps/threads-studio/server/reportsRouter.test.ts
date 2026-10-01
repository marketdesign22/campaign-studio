/**
 * 月次レポートAPI。
 *
 * - 保存済みが無ければ即席集計を saved=false で返す
 * - 送付済は再生成・文章変更ができない
 * - 文章の生成に失敗しても集計は保存し、理由を日本語で返す
 * - 目標値の保存は管理者のみ
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({
  listAccounts: vi.fn(),
  getReport: vi.fn(),
  listKpiTargets: vi.fn(),
  saveKpiTargets: vi.fn(),
  updateReport: vi.fn(),
  upsertReport: vi.fn(),
}));
vi.mock("./reportBuilder", () => ({ buildReportData: vi.fn() }));
vi.mock("./reportNarrative", () => ({ generateReportNarrative: vi.fn() }));

import * as db from "./db";
import * as builder from "./reportBuilder";
import * as narrativeLib from "./reportNarrative";

const TOKEN = "THREADS-TOKEN-NEVER-LEAK";
function account(id: number, name: string) {
  return {
    id, name, threadsUserId: `user-${id}`, threadsAccessToken: TOKEN, tokenRefreshedAt: null, tokenExpiresAt: null,
    morningHour: 8, morningMinute: 0, eveningHour: 18, eveningMinute: 0, timezone: "JP" as const, slots: null, active: true,
    lastReplyFetchAt: null, lastReplyFetchError: null, threadsUsername: null, createdAt: new Date(), updatedAt: new Date(),
  };
}
function ctx(accountId = 1, role: "admin" | "user" = "admin") {
  return { req: { headers: { "x-account-id": String(accountId) } }, res: {}, user: { id: 1, role } } as never;
}
const DATA = { yearMonth: "2026-09", kpis: [], monthly: [], daily: [], topPosts: [], bottomPosts: [], byCategory: [], byCampaign: [], heatmap: [], notes: [], conversions: { trackingEnabled: true, linkClicks: 0, conversions: 0, valueCents: 0, byGoal: [], byCampaign: [] }, accountName: "A", period: { from: "2026-09-01", to: "2026-09-30" }, timezone: "Asia/Tokyo", generatedAt: "2026-10-01T00:00:00.000Z" };
const NARRATIVE = { summary: "総評", highlights: ["良い"], issues: [], actions: [{ title: "増やす", detail: "週2本" }] };
const savedRow = (status: "draft" | "reviewed" | "sent") => ({
  id: 1, accountId: 1, yearMonth: "2026-09", status, dataJson: JSON.stringify(DATA), narrativeJson: JSON.stringify(NARRATIVE),
  generatedAt: new Date("2026-10-01T00:00:00Z"), reviewedAt: status === "draft" ? null : new Date("2026-10-02T00:00:00Z"), sentAt: status === "sent" ? new Date("2026-10-03T00:00:00Z") : null,
  createdAt: new Date(), updatedAt: new Date(),
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  delete process.env.OPENAI_API_KEY;
  vi.mocked(db.listAccounts).mockResolvedValue([account(1, "SCSU.Japan"), account(2, "creaw.usa")] as never);
  vi.mocked(db.getReport).mockResolvedValue(undefined);
  vi.mocked(db.listKpiTargets).mockResolvedValue([]);
  vi.mocked(builder.buildReportData).mockResolvedValue(DATA as never);
});

describe("reports.get", () => {
  it("保存済みが無ければ即席集計を saved=false で返す（トークンは出さない）", async () => {
    const { reportsRouter } = await import("./routers/reports");
    const r = await reportsRouter.createCaller(ctx(1)).get({ year: 2026, month: 9 });
    expect(r.saved).toBe(false);
    expect(r.status).toBeNull();
    expect(r.narrative).toBeNull();
    expect(r.data.yearMonth).toBe("2026-09");
    expect(builder.buildReportData).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }), { accountId: 1, includeLegacy: true }, 2026, 9);
    expect(JSON.stringify(r)).not.toContain(TOKEN);
  });

  it("保存済みがあればそれを返し、集計はし直さない", async () => {
    vi.mocked(db.getReport).mockResolvedValue(savedRow("reviewed") as never);
    const { reportsRouter } = await import("./routers/reports");
    const r = await reportsRouter.createCaller(ctx(1)).get({ year: 2026, month: 9 });
    expect(r.saved).toBe(true);
    expect(r.status).toBe("reviewed");
    expect(r.narrative).toEqual(NARRATIVE);
    expect(db.getReport).toHaveBeenCalledWith(1, "2026-09");
    expect(builder.buildReportData).not.toHaveBeenCalled();
  });
});

describe("reports.generate", () => {
  it("集計して保存する。AI未設定なら文章は null", async () => {
    const { reportsRouter } = await import("./routers/reports");
    const r = await reportsRouter.createCaller(ctx(2)).generate({ year: 2026, month: 9, withNarrative: true });
    expect(r).toEqual({ ok: true, narrativeError: null });
    expect(db.upsertReport).toHaveBeenCalledWith(2, "2026-09", JSON.stringify(DATA), null, expect.any(Date));
    expect(narrativeLib.generateReportNarrative).not.toHaveBeenCalled();
  });

  it("AI設定があれば文章も生成して保存する", async () => {
    process.env.OPENAI_API_KEY = "sk-NEVER-LEAK";
    vi.mocked(narrativeLib.generateReportNarrative).mockResolvedValue(NARRATIVE);
    const { reportsRouter } = await import("./routers/reports");
    await reportsRouter.createCaller(ctx(1)).generate({ year: 2026, month: 9, withNarrative: true });
    expect(db.upsertReport).toHaveBeenCalledWith(1, "2026-09", JSON.stringify(DATA), JSON.stringify(NARRATIVE), expect.any(Date));
  });

  it("文章の生成に失敗しても集計は保存し、理由を日本語で返す（生のエラーは出さない）", async () => {
    process.env.OPENAI_API_KEY = "sk-NEVER-LEAK";
    vi.mocked(narrativeLib.generateReportNarrative).mockRejectedValue(Object.assign(new Error("OpenAI API request failed (429)"), { status: 429 }));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { reportsRouter } = await import("./routers/reports");
    const r = await reportsRouter.createCaller(ctx(1)).generate({ year: 2026, month: 9, withNarrative: true });
    expect(r.ok).toBe(true);
    expect(r.narrativeError).toContain("上限");
    expect(r.narrativeError).not.toContain("OpenAI API request failed");
    expect(db.upsertReport).toHaveBeenCalledWith(1, "2026-09", JSON.stringify(DATA), null, expect.any(Date));
  });

  it("送付済のレポートは再生成できない", async () => {
    vi.mocked(db.getReport).mockResolvedValue(savedRow("sent") as never);
    const { reportsRouter } = await import("./routers/reports");
    await expect(reportsRouter.createCaller(ctx(1)).generate({ year: 2026, month: 9, withNarrative: false })).rejects.toThrow(/送付済/);
    expect(builder.buildReportData).not.toHaveBeenCalled();
    expect(db.upsertReport).not.toHaveBeenCalled();
  });
});

describe("reports.regenerateNarrative / saveNarrative", () => {
  it("AI未設定なら作り直せない", async () => {
    vi.mocked(db.getReport).mockResolvedValue(savedRow("draft") as never);
    const { reportsRouter } = await import("./routers/reports");
    await expect(reportsRouter.createCaller(ctx(1)).regenerateNarrative({ year: 2026, month: 9 })).rejects.toThrow(/OPENAI_API_KEY/);
  });

  it("保存済みの集計から文章を作り直して保存する", async () => {
    process.env.OPENAI_API_KEY = "sk-NEVER-LEAK";
    vi.mocked(db.getReport).mockResolvedValue(savedRow("draft") as never);
    vi.mocked(narrativeLib.generateReportNarrative).mockResolvedValue(NARRATIVE);
    const { reportsRouter } = await import("./routers/reports");
    const r = await reportsRouter.createCaller(ctx(1)).regenerateNarrative({ year: 2026, month: 9 });
    expect(r.narrative).toEqual(NARRATIVE);
    expect(narrativeLib.generateReportNarrative).toHaveBeenCalledWith(DATA);
    expect(db.updateReport).toHaveBeenCalledWith(1, "2026-09", { narrativeJson: JSON.stringify(NARRATIVE) });
  });

  it("人が編集した文章を保存する。未生成・送付済は拒否", async () => {
    const { reportsRouter } = await import("./routers/reports");
    await expect(reportsRouter.createCaller(ctx(1)).saveNarrative({ year: 2026, month: 9, narrative: NARRATIVE })).rejects.toThrow(/生成/);
    vi.mocked(db.getReport).mockResolvedValue(savedRow("sent") as never);
    await expect(reportsRouter.createCaller(ctx(1)).saveNarrative({ year: 2026, month: 9, narrative: NARRATIVE })).rejects.toThrow(/送付済/);
    vi.mocked(db.getReport).mockResolvedValue(savedRow("reviewed") as never);
    await reportsRouter.createCaller(ctx(1)).saveNarrative({ year: 2026, month: 9, narrative: { ...NARRATIVE, summary: "編集後" } });
    expect(db.updateReport).toHaveBeenCalledWith(1, "2026-09", { narrativeJson: JSON.stringify({ ...NARRATIVE, summary: "編集後" }) });
  });
});

describe("reports.setStatus", () => {
  it("送付済にすると sentAt が入り、下書きに戻すと両方消える", async () => {
    vi.mocked(db.getReport).mockResolvedValue(savedRow("reviewed") as never);
    const { reportsRouter } = await import("./routers/reports");
    await reportsRouter.createCaller(ctx(1)).setStatus({ year: 2026, month: 9, status: "sent" });
    expect(db.updateReport).toHaveBeenCalledWith(1, "2026-09", { status: "sent", reviewedAt: new Date("2026-10-02T00:00:00Z"), sentAt: expect.any(Date) });
    await reportsRouter.createCaller(ctx(1)).setStatus({ year: 2026, month: 9, status: "draft" });
    expect(db.updateReport).toHaveBeenLastCalledWith(1, "2026-09", { status: "draft", reviewedAt: null, sentAt: null });
  });

  it("未生成のレポートの状態は変えられない", async () => {
    const { reportsRouter } = await import("./routers/reports");
    await expect(reportsRouter.createCaller(ctx(1)).setStatus({ year: 2026, month: 9, status: "reviewed" })).rejects.toThrow(/生成/);
  });
});

describe("reports.targets / saveTargets", () => {
  it("未設定の指標は null で返す", async () => {
    vi.mocked(db.listKpiTargets).mockResolvedValue([{ metric: "views", target: 4000 }, { metric: "unknown_metric", target: 1 }] as never);
    const { reportsRouter } = await import("./routers/reports");
    const r = await reportsRouter.createCaller(ctx(2)).targets({ year: 2026, month: 9 });
    expect(r.views).toBe(4000);
    expect(r.posts).toBeNull();
    expect(r).not.toHaveProperty("unknown_metric");
    expect(db.listKpiTargets).toHaveBeenCalledWith(2, "2026-09", "2026-09");
  });

  it("目標値の保存は管理者のみ。null は未設定に戻す", async () => {
    const { reportsRouter } = await import("./routers/reports");
    await expect(reportsRouter.createCaller(ctx(1, "user")).saveTargets({ year: 2026, month: 9, targets: { views: 4000 } })).rejects.toThrow(/管理者/);
    expect(db.saveKpiTargets).not.toHaveBeenCalled();
    await reportsRouter.createCaller(ctx(1)).saveTargets({ year: 2026, month: 9, targets: { views: 4000, posts: null } });
    expect(db.saveKpiTargets).toHaveBeenCalledWith(1, "2026-09", { views: 4000, posts: null });
  });
});
