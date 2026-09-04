/**
 * トレンドAPIとトレンド反映の原稿生成。
 *
 * - 分析は選択中アカウントのものしか使えない
 * - 3案が返り、参考にした過去投稿は8件以内
 * - 生成結果は原稿を作らない（利用者が選んで保存する）
 * - トークン・APIキーがレスポンスやエラーに出ない
 * - AI未設定でも収集・保存・除外・設定は動く
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./_core/llm", () => ({ invokeLLM: vi.fn() }));
vi.mock("./db", () => ({
  listAccounts: vi.fn(),
  listPostLogs: vi.fn(),
  getAccountSettings: vi.fn(),
  getOwnedTrendAnalysis: vi.fn(),
  getTrendSettings: vi.fn(),
  getClientProfile: vi.fn(),
  upsertTrendSettings: vi.fn(),
  getLatestTrendAnalysis: vi.fn(),
  getOwnedTrendPost: vi.fn(),
  listTrendPosts: vi.fn(),
  setTrendPostStatus: vi.fn(),
  upsertTrendPost: vi.fn(),
  listPostOutcomes: vi.fn(),
  listConversionEvents: vi.fn(),
  createPost: vi.fn(),
}));
vi.mock("./trends", () => ({
  analyzeTrends: vi.fn(),
  fetchTrendsForAccount: vi.fn(),
  markDeletedSavedPosts: vi.fn(),
  periodSince: (p: string) => new Date(Date.now() - (p === "24h" ? 1 : p === "7d" ? 7 : 30) * 86_400_000),
}));

import * as db from "./db";
import * as llm from "./_core/llm";
import * as trends from "./trends";

const SECRET = "sk-proj-THIS-MUST-NEVER-LEAK";
const TOKEN = "THREADS-TOKEN-NEVER-LEAK";

const SCSU = {
  id: 1, name: "SCSU.Japan", threadsUserId: "28207384535618732", threadsAccessToken: TOKEN,
  tokenRefreshedAt: null, tokenExpiresAt: null,
  morningHour: 8, morningMinute: 0, eveningHour: 18, eveningMinute: 0,
  timezone: "JP" as const, slots: null, active: true, createdAt: new Date(), updatedAt: new Date(),
};
const CREAW = { ...SCSU, id: 2, name: "creaw.usa", threadsUserId: "39203306012602276" };

function ctx(accountId = 1, role: "admin" | "user" = "admin") {
  return { req: { headers: { "x-account-id": String(accountId) } }, res: {}, user: { id: 1, role } } as never;
}
function llmReply(content: string) {
  return { id: "m", model: "gpt", choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }] };
}
function trendDrafts(first = "案1") {
  return JSON.stringify({ drafts: [
    { content: first, angle: "体験談" },
    { content: "案2", angle: "事実" },
    { content: "案3", angle: "問いかけ" },
  ] });
}
const SETTINGS = {
  keywords: ["留学"], excludeKeywords: ["詐欺"], refAccounts: [], language: "ja", region: "JP", industry: "教育",
  fetchTimes: [{ hour: 9, minute: 0 }, { hour: 18, minute: 0 }], autoFetch: true, retentionDays: 30, aiDailyLimit: 20,
  lastFetchKey: "2026-09-04/0", lastFetchAt: new Date("2026-09-04T00:00:00Z"), lastFetchError: null as string | null,
};
const ANALYSIS = {
  themes: ["準備の不安"], hooks: ["結論から"], structures: ["体験→学び"], tone: "率直", questions: ["あなたは？"],
  keywords: ["留学"], regionalDifference: "", durability: "ongoing", durabilityReason: "", angles: ["費用"], risks: ["誇張"], perPost: [],
};

beforeEach(async () => {
  vi.clearAllMocks();
  vi.resetModules();
  const d = await import("./db");
  vi.mocked(d.listAccounts).mockResolvedValue([SCSU, CREAW] as never);
  vi.mocked(d.listPostLogs).mockResolvedValue([] as never);
  vi.mocked(d.getAccountSettings).mockResolvedValue({ brandName: "SCSU" } as never);
  vi.mocked(d.getTrendSettings).mockResolvedValue(SETTINGS as never);
  vi.mocked(d.getClientProfile).mockResolvedValue(undefined);
  vi.mocked(d.upsertTrendSettings).mockResolvedValue(undefined);
  vi.mocked(d.listTrendPosts).mockResolvedValue([] as never);
  vi.mocked(d.listPostOutcomes).mockResolvedValue([] as never);
  vi.mocked(d.listConversionEvents).mockResolvedValue([] as never);
  vi.mocked(d.getLatestTrendAnalysis).mockResolvedValue(undefined);
  delete process.env.OPENAI_API_KEY;
});

describe("トレンド反映の原稿生成 (ai.generateDrafts)", () => {
  beforeEach(async () => {
    process.env.OPENAI_API_KEY = SECRET;
    vi.resetModules();
    const d = await import("./db");
    vi.mocked(d.listAccounts).mockResolvedValue([SCSU, CREAW] as never);
    vi.mocked(d.getAccountSettings).mockResolvedValue({ brandName: "SCSU" } as never);
    vi.mocked(d.getTrendSettings).mockResolvedValue(SETTINGS as never);
    vi.mocked(d.getClientProfile).mockResolvedValue(undefined);
    // 過去投稿は12件あるが、参照は8件まで
    vi.mocked(d.listPostLogs).mockResolvedValue(
      Array.from({ length: 12 }, (_, i) => ({ id: i, status: "posted", content: `過去投稿${i}` })) as never
    );
    vi.mocked(d.getOwnedTrendAnalysis).mockImplementation(async (id: number, accountId: number) =>
      id === 5 && accountId === 1 ? { id: 5, accountId: 1, period: "7d", result: JSON.stringify(ANALYSIS), postCount: 10, createdAt: new Date() } as never : undefined
    );
  });

  it("角度の異なる3案と参考にした傾向を返し、原稿は作らない", async () => {
    const l = await import("./_core/llm");
    vi.mocked(l.invokeLLM).mockResolvedValue(llmReply(JSON.stringify({
      drafts: [
        { content: "案1", angle: "体験談", referencedTrends: ["結論から"] },
        { content: "案2", angle: "数字", referencedTrends: ["費用"] },
        { content: "案3", angle: "問いかけ", referencedTrends: ["あなたは？"] },
      ],
    })) as never);
    const { aiRouter } = await import("./routers/ai");
    const r = await aiRouter.createCaller(ctx(1)).generateDrafts({
      topic: "留学準備", trend: { analysisId: 5, platform: "threads", region: "JP", purpose: "follow", strength: "medium" },
    });
    expect(r.variants).toHaveLength(3);
    expect(new Set(r.variants.map((v) => v.angle)).size).toBe(3);
    expect(r.variants[0].referencedTrends).toEqual(["結論から"]);
    expect(r.trendAnalysisId).toBe(5);
    const d = await import("./db");
    expect(d.createPost).not.toHaveBeenCalled();
  });

  it("プロンプトに過去投稿は8件まで、禁止表現・傾向・複製禁止を含み、Secretは含まない", async () => {
    const l = await import("./_core/llm");
    vi.mocked(l.invokeLLM).mockResolvedValue(llmReply(trendDrafts("案")) as never);
    const { aiRouter } = await import("./routers/ai");
    await aiRouter.createCaller(ctx(1)).generateDrafts({ topic: "留学準備", trend: { analysisId: 5 } });
    const sent = JSON.stringify(vi.mocked(l.invokeLLM).mock.calls[0][0]);
    expect((sent.match(/過去投稿\d+/g) ?? []).length).toBe(8);
    expect(sent).toContain("禁止表現");
    expect(sent).toContain("詐欺");
    expect(sent).toContain("準備の不安");
    expect(sent).toContain("複製は禁止");
    expect(sent).not.toContain(SECRET);
    expect(sent).not.toContain(TOKEN);
  });

  it("他アカウントの分析IDは使えない", async () => {
    const { aiRouter } = await import("./routers/ai");
    await expect(aiRouter.createCaller(ctx(2)).generateDrafts({ topic: "x", trend: { analysisId: 5 } }))
      .rejects.toThrow(/見つかりません/);
    const l = await import("./_core/llm");
    expect(l.invokeLLM).not.toHaveBeenCalled();
  });

  it("500文字を超える案は切り詰める", async () => {
    const l = await import("./_core/llm");
    vi.mocked(l.invokeLLM).mockResolvedValue(llmReply(trendDrafts("あ".repeat(700))) as never);
    const { aiRouter } = await import("./routers/ai");
    const r = await aiRouter.createCaller(ctx(1)).generateDrafts({ topic: "x", trend: { analysisId: 5 } });
    expect(Array.from(r.variants[0].content).length).toBe(500);
  });

  it("トレンド生成は3案未満や重複案を成功扱いしない", async () => {
    const l = await import("./_core/llm");
    vi.mocked(l.invokeLLM).mockResolvedValue(llmReply(JSON.stringify({
      drafts: [{ content: "同じ", angle: "同じ" }, { content: "同じ", angle: "同じ" }],
    })) as never);
    const { aiRouter } = await import("./routers/ai");
    await expect(aiRouter.createCaller(ctx(1)).generateDrafts({ topic: "x", trend: { analysisId: 5 } }))
      .rejects.toThrow(/AI処理に失敗/);
  });
});

describe("trends ルーター", () => {
  it("AI未設定でも一覧・設定・保存・除外は動く", async () => {
    const d = await import("./db");
    vi.mocked(d.listTrendPosts).mockResolvedValue([{
      id: 9, accountId: 1, platform: "threads", source: "keyword", keyword: "留学", externalId: "x", permalink: "https://www.threads.net/@u/post/x",
      username: "u", postedAt: new Date(), mediaType: "TEXT", summary: "要約", hasReplies: true,
      likes: null, replies: null, reposts: null, views: null, saves: null, score: 62,
      scoreBreakdown: JSON.stringify([{ key: "recency", points: 20, max: 25, available: true, reason: "" }]),
      isRising: true, status: "active", aiReason: null, aiIdeas: null, firstSeenAt: new Date(), fetchedAt: new Date(), updatedAt: new Date(),
    }] as never);
    vi.mocked(d.getOwnedTrendPost).mockResolvedValue({ id: 9, accountId: 1 } as never);
    const { trendsRouter } = await import("./routers/trends");
    const caller = trendsRouter.createCaller(ctx(1));

    const list = await caller.list({ period: "7d" });
    expect(list.aiAvailable).toBe(false);
    expect(list.posts[0].likes).toBeNull(); // 0 ではなく null
    expect(list.posts[0].scoreBreakdown[0].key).toBe("recency");
    expect(d.listTrendPosts).toHaveBeenCalledWith(1, expect.objectContaining({ limit: 100 }));

    await caller.setStatus({ id: 9, status: "saved" });
    expect(d.setTrendPostStatus).toHaveBeenCalledWith(9, 1, "saved");

    const s = await caller.getSettings();
    expect(s.keywords).toEqual(["留学"]);
    expect(s.lastFetchError).toBeNull();
    expect(JSON.stringify(s)).not.toContain("lastFetchKey");
    expect(JSON.stringify(list)).not.toContain(TOKEN);
  });

  it("前回の取得失敗（権限不足など）を一覧と設定で返し、画面が再接続を案内できる", async () => {
    const d = await import("./db");
    vi.mocked(d.getTrendSettings).mockResolvedValue({ ...SETTINGS, lastFetchError: "permission" } as never);
    const { trendsRouter } = await import("./routers/trends");
    const caller = trendsRouter.createCaller(ctx(1));
    expect((await caller.list({ period: "7d" })).lastFetchError).toBe("permission");
    expect((await caller.getSettings()).lastFetchError).toBe("permission");
  });

  it("分析は AI 未設定なら安全なエラーを返す", async () => {
    const { trendsRouter } = await import("./routers/trends");
    await expect(trendsRouter.createCaller(ctx(1)).analyze({ period: "7d" })).rejects.toThrow(/OPENAI_API_KEY/);
    expect(trends.analyzeTrends).not.toHaveBeenCalled();
  });

  it("他アカウントの投稿の状態は変えられない", async () => {
    const d = await import("./db");
    vi.mocked(d.getOwnedTrendPost).mockResolvedValue(undefined);
    const { trendsRouter } = await import("./routers/trends");
    await expect(trendsRouter.createCaller(ctx(2)).setStatus({ id: 9, status: "excluded" })).rejects.toThrow(/見つかりません/);
    expect(d.setTrendPostStatus).not.toHaveBeenCalled();
  });

  it("手動取得は管理者のみ・選択中アカウントのスコープで走り、失敗種別だけ返す", async () => {
    const t = await import("./trends");
    vi.mocked(t.fetchTrendsForAccount).mockResolvedValue({
      accountId: 2, keywords: 1, fetched: 3, stored: 2,
      errors: [{ keyword: "留学", kind: "permission" }],
    });
    vi.mocked(t.markDeletedSavedPosts).mockResolvedValue(undefined);
    const { trendsRouter } = await import("./routers/trends");
    await expect(trendsRouter.createCaller(ctx(2, "user")).fetchNow()).rejects.toThrow(/管理者/);
    const r = await trendsRouter.createCaller(ctx(2)).fetchNow();
    expect(r).toEqual({ keywords: 1, fetched: 3, stored: 2, errors: [{ keyword: "留学", kind: "permission" }] });
    const call = vi.mocked(t.fetchTrendsForAccount).mock.calls[0];
    expect(call[0].id).toBe(2);
    expect(call[1]).toEqual({ accountId: 2, includeLegacy: false });
    // 連打防止
    await expect(trendsRouter.createCaller(ctx(2)).fetchNow()).rejects.toThrow(/待って/);
  });

  it("参考URLは Threads / Instagram だけ受け付け、取得はせず null 指標で登録する", async () => {
    const d = await import("./db");
    const { trendsRouter } = await import("./routers/trends");
    const caller = trendsRouter.createCaller(ctx(1));
    await expect(caller.addReference({ url: "https://example.com/p/abc" })).rejects.toThrow(/URL/);
    const r = await caller.addReference({ url: "https://www.instagram.com/p/C9abcDEfg12/", note: "参考" });
    expect(r.platform).toBe("instagram");
    const row = vi.mocked(d.upsertTrendPost).mock.calls[0][0];
    expect(row.accountId).toBe(1);
    expect(row.source).toBe("manual");
    expect(row.likes).toBeNull();
    expect(row.summary).toBe("参考");
  });

  it("設定保存は重複を除き、@ を落として保存する", async () => {
    const d = await import("./db");
    const { trendsRouter } = await import("./routers/trends");
    await trendsRouter.createCaller(ctx(1)).saveSettings({
      keywords: ["留学", "留学", " 奨学金 "], refAccounts: ["@abc", "abc"], aiDailyLimit: 3, industry: "",
    });
    expect(d.upsertTrendSettings).toHaveBeenCalledWith(1, expect.objectContaining({
      keywords: ["留学", "奨学金"], refAccounts: ["abc"], aiDailyLimit: 3, industry: null,
    }));
  });

  it("おすすめはスコープ付きで成果を集計し、数値を返す", async () => {
    const d = await import("./db");
    vi.mocked(d.listPostOutcomes).mockResolvedValue([
      { logId: 1, postId: 1, content: "a", postedAt: new Date("2026-09-03T00:00:00Z"), usedTrend: true, trendMeta: JSON.stringify({ referencedTrends: ["結論から"] }), likes: 30, replies: 0, reposts: 0, views: 300, hasAnalytics: true },
      { logId: 2, postId: 2, content: "b", postedAt: new Date("2026-09-03T01:00:00Z"), usedTrend: false, trendMeta: null, likes: 10, replies: 0, reposts: 0, views: 100, hasAnalytics: true },
      { logId: 3, postId: 3, content: "c", postedAt: new Date("2026-09-03T02:00:00Z"), usedTrend: false, trendMeta: null, likes: null, replies: null, reposts: null, views: null, hasAnalytics: false },
    ] as never);
    const { trendsRouter } = await import("./routers/trends");
    const r = await trendsRouter.createCaller(ctx(1)).recommendations({ days: 7 });
    expect(d.listPostOutcomes).toHaveBeenCalledWith({ accountId: 1, includeLegacy: true }, expect.any(Date));
    expect(r.trend).toEqual({ posts: 1, measured: 1, avgViews: 300, avgEngagement: 30 });
    expect(r.other).toEqual({ posts: 2, measured: 1, avgViews: 100, avgEngagement: 10 });
    expect(r.timezone).toBe("JP");
  });
});
