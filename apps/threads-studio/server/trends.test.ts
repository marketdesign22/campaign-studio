/**
 * トレンド収集・分析の検証。Threads API と DB はモックする。
 *
 * - アカウントごとに分離され、1件の失敗が他を止めない
 * - TOP / RECENT の重複は1件に畳む
 * - 失敗しても既存データを消さない
 * - 認証・権限・レート制限を区別する
 * - AIには要約しか渡さない／1日の上限を守る
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Account } from "../drizzle/schema";

vi.mock("./db", () => ({
  getTrendSettings: vi.fn(),
  upsertTrendSettings: vi.fn(),
  upsertTrendPost: vi.fn(),
  listTrendPosts: vi.fn(),
  countTrendPostsForKeyword: vi.fn(),
  pruneTrendPosts: vi.fn(),
  setTrendPostStatus: vi.fn(),
  setTrendPostAi: vi.fn(),
  createTrendAnalysis: vi.fn(),
  countTrendAnalysesToday: vi.fn(),
  listPostLogs: vi.fn(),
  getLatestTrendAnalysis: vi.fn(),
  getOwnedTrendPost: vi.fn(),
  listPostOutcomes: vi.fn(),
  listAccounts: vi.fn(),
}));
vi.mock("./threadsApi", () => ({
  searchThreadsKeyword: vi.fn(),
  checkThreadsPostExists: vi.fn(),
  normalizeSearchItem: vi.fn(),
}));
vi.mock("./_core/llm", () => ({ invokeLLM: vi.fn() }));

import * as db from "./db";
import * as api from "./threadsApi";
import * as llm from "./_core/llm";
import {
  _test, analyzeTrends, classifyThreadsError, COLLECTORS, dueFetchKey, fetchTrendsForAccount,
  parseTrendAnalysis, periodSince, runTrendFetchIfDue, shouldSkip, worstError,
} from "./trends";
import { DEFAULT_TREND_SETTINGS } from "./dbDefaults.test-helper";

const TOKEN_A = "TOKEN-FOR-SCSU-NEVER-LEAK";
const TOKEN_B = "TOKEN-FOR-CREAW-NEVER-LEAK";

function account(id: number, name: string, token: string): Account {
  return {
    id, name, threadsUserId: `user-${id}`, threadsAccessToken: token,
    tokenRefreshedAt: null, tokenExpiresAt: null,
    morningHour: 8, morningMinute: 0, eveningHour: 18, eveningMinute: 0,
    timezone: "JP", slots: null, active: true,
    createdAt: new Date("2026-01-01T00:00:00Z"), updatedAt: new Date("2026-01-01T00:00:00Z"),
  } as Account;
}
const SCSU = account(1, "SCSU.Japan", TOKEN_A);
const CREAW = account(2, "creaw.usa", TOKEN_B);
const scopeOf = (a: Account) => ({ accountId: a.id, includeLegacy: a.id === 1 });

const NOW = new Date("2026-09-04T03:00:00Z"); // JST 12:00

function item(id: string, text = `post ${id}`, extra: Partial<api.ThreadsSearchResult> = {}): api.ThreadsSearchResult {
  return {
    id, text, mediaType: "TEXT", permalink: `https://www.threads.net/@u/post/${id}`,
    timestamp: new Date(NOW.getTime() - 3_600_000), username: "u",
    hasReplies: true, isQuotePost: false, isReply: false, ...extra,
  };
}

function settings(overrides: Partial<typeof DEFAULT_TREND_SETTINGS> = {}) {
  return { ...DEFAULT_TREND_SETTINGS, keywords: ["留学"], ...overrides };
}

const sleeps: number[] = [];
beforeEach(() => {
  vi.clearAllMocks();
  sleeps.length = 0;
  // 再試行の待ち時間は記録するだけで実際には待たない
  _test.sleep = async (ms) => { sleeps.push(ms); };
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.mocked(db.listPostLogs).mockResolvedValue([]);
  vi.mocked(db.countTrendPostsForKeyword).mockResolvedValue(0);
  vi.mocked(db.upsertTrendPost).mockResolvedValue(undefined);
  vi.mocked(db.upsertTrendSettings).mockResolvedValue(undefined);
  vi.mocked(db.pruneTrendPosts).mockResolvedValue(undefined);
});

describe("classifyThreadsError", () => {
  it("認証・権限・レート制限・通信を区別する", () => {
    expect(classifyThreadsError("Threads API error (401): OAuthException")).toBe("auth");
    expect(classifyThreadsError("(403) requires threads_keyword_search")).toBe("permission");
    expect(classifyThreadsError("Threads API error (429): rate limit")).toBe("rate_limited");
    expect(classifyThreadsError("fetch failed")).toBe("network");
    expect(classifyThreadsError("Threads API error (503)")).toBe("network");
    expect(classifyThreadsError("weird")).toBe("unknown");
  });
  it("Meta のエラーコードでも判定できる", () => {
    expect(classifyThreadsError('(400): {"error":{"message":"x","type":"OAuthException","code":190}}')).toBe("auth");
    expect(classifyThreadsError('(400): {"error":{"message":"Application request limit reached","code":4,"type":"OAuthException"}}')).toBe("rate_limited");
  });
  it("worstError は対処が必要な順に選ぶ", () => {
    expect(worstError(["network", "permission", "unknown"])).toBe("permission");
    expect(worstError([])).toBeNull();
  });
});

describe("収集口", () => {
  it("Threads は公式検索、Instagram は未接続（自動収集を実装したように見せない）", () => {
    expect(COLLECTORS.threads?.platform).toBe("threads");
    expect(COLLECTORS.instagram).toBeNull();
  });
});

describe("dueFetchKey", () => {
  const times = [{ hour: 9, minute: 0 }, { hour: 18, minute: 0 }];
  it("取得時刻を過ぎた最新の枠をローカル日付付きで返す", () => {
    expect(dueFetchKey(new Date("2026-09-04T03:00:00Z"), "JP", times)).toBe("2026-09-04/0"); // JST 12:00
    expect(dueFetchKey(new Date("2026-09-04T10:00:00Z"), "JP", times)).toBe("2026-09-04/1"); // JST 19:00
  });
  it("まだどの枠も来ていなければ null", () => {
    expect(dueFetchKey(new Date("2026-09-03T22:00:00Z"), "JP", times)).toBeNull(); // JST 07:00
  });
  it("タイムゾーンは枠の設定に従う", () => {
    // 同じ瞬間でも LA では前日 20:00 なので 2枠目
    expect(dueFetchKey(new Date("2026-09-04T03:00:00Z"), "LA", times)).toBe("2026-09-03/1");
  });
});

describe("shouldSkip", () => {
  it("返信・空本文・除外語を含む投稿を外す", () => {
    expect(shouldSkip(item("1", "hello", { isReply: true }), [])).toBe(true);
    expect(shouldSkip(item("2", null as unknown as string), [])).toBe(true);
    expect(shouldSkip(item("3", "詐欺まがいの勧誘"), ["詐欺"])).toBe(true);
    expect(shouldSkip(item("4", "留学の準備"), ["詐欺"])).toBe(false);
  });
});

describe("fetchTrendsForAccount", () => {
  it("TOP と RECENT の重複を1件に畳み、反応数は null のまま保存する", async () => {
    vi.mocked(api.searchThreadsKeyword)
      .mockResolvedValueOnce([item("a"), item("b")])
      .mockResolvedValueOnce([item("b"), item("c")]);
    const r = await fetchTrendsForAccount(SCSU, scopeOf(SCSU), NOW, settings());
    expect(r.fetched).toBe(3);
    expect(r.stored).toBe(3);
    expect(db.upsertTrendPost).toHaveBeenCalledTimes(3);
    const row = vi.mocked(db.upsertTrendPost).mock.calls[0][0];
    expect(row.accountId).toBe(1);
    expect(row.likes).toBeNull();
    expect(row.views).toBeNull();
    expect(row.score).toBeGreaterThanOrEqual(0);
    expect(row.score).toBeLessThanOrEqual(100);
    expect(row.summary.length).toBeLessThanOrEqual(141);
  });

  it("自アカウントのトークンで検索し、他アカウントのトークンは使わない", async () => {
    vi.mocked(api.searchThreadsKeyword).mockResolvedValue([]);
    await fetchTrendsForAccount(CREAW, scopeOf(CREAW), NOW, settings());
    for (const call of vi.mocked(api.searchThreadsKeyword).mock.calls) {
      expect(call[0]).toBe(TOKEN_B);
    }
    // 自社投稿の参照もそのアカウントのスコープ
    expect(db.listPostLogs).toHaveBeenCalledWith(30, { accountId: 2, includeLegacy: false });
  });

  it("失敗しても既存データを消さず、失敗種別だけ返す", async () => {
    vi.mocked(api.searchThreadsKeyword).mockRejectedValue(new Error("Threads API error (401): OAuthException token=SECRET"));
    const r = await fetchTrendsForAccount(SCSU, scopeOf(SCSU), NOW, settings({ keywords: ["留学", "奨学金"] }));
    expect(r.errors).toEqual([{ keyword: "留学", kind: "auth" }]); // 認証失敗以降のキーワードは打ち切る
    expect(r.stored).toBe(0);
    expect(db.upsertTrendPost).not.toHaveBeenCalled();
    expect(db.pruneTrendPosts).toHaveBeenCalledWith(1, 30); // 通常の保存期間整理だけ。失敗理由での削除はしない
    expect(JSON.stringify(r)).not.toContain("SECRET");
    // 画面で再接続を案内できるよう、失敗種別を設定行に残す
    expect(db.upsertTrendSettings).toHaveBeenCalledWith(1, expect.objectContaining({ lastFetchError: "auth" }));
    // ログにもトークンや本文は出ない
    const logged = vi.mocked(console.warn).mock.calls.flat().join(" ");
    expect(logged).not.toContain("SECRET");
    expect(logged).toContain("auth");
  });

  it("成功したら失敗種別を消す", async () => {
    vi.mocked(api.searchThreadsKeyword).mockResolvedValue([item("a")]);
    await fetchTrendsForAccount(SCSU, scopeOf(SCSU), NOW, settings());
    expect(db.upsertTrendSettings).toHaveBeenCalledWith(1, expect.objectContaining({ lastFetchError: null }));
  });

  it("レート制限は間を空けて1回だけ再試行し、駄目なら以降のキーワードを打ち切る", async () => {
    vi.mocked(api.searchThreadsKeyword).mockRejectedValue(new Error("Threads keyword search failed (429): rate limit"));
    const r = await fetchTrendsForAccount(SCSU, scopeOf(SCSU), NOW, settings({ keywords: ["a", "b", "c"] }));
    expect(api.searchThreadsKeyword).toHaveBeenCalledTimes(2); // 初回 + 再試行
    expect(sleeps).toEqual([5000]);
    expect(r.errors).toEqual([{ keyword: "a", kind: "rate_limited" }]);
    expect(db.upsertTrendSettings).toHaveBeenCalledWith(1, expect.objectContaining({ lastFetchError: "rate_limited" }));
  });

  it("権限不足は再試行せずに打ち切る", async () => {
    vi.mocked(api.searchThreadsKeyword).mockRejectedValue(new Error("Threads keyword search failed (403): requires threads_keyword_search"));
    const r = await fetchTrendsForAccount(SCSU, scopeOf(SCSU), NOW, settings({ keywords: ["a", "b"] }));
    expect(api.searchThreadsKeyword).toHaveBeenCalledTimes(1);
    expect(sleeps).toEqual([]);
    expect(r.errors[0].kind).toBe("permission");
  });

  it("通信エラーは1回だけ再試行し、成功すれば保存する", async () => {
    vi.mocked(api.searchThreadsKeyword)
      .mockRejectedValueOnce(new Error("fetch failed"))
      .mockResolvedValueOnce([item("a")])
      .mockResolvedValueOnce([]);
    const r = await fetchTrendsForAccount(SCSU, scopeOf(SCSU), NOW, settings());
    expect(r.errors).toEqual([]);
    expect(r.stored).toBe(1);
    expect(sleeps).toEqual([1000]);
  });

  it("キーワードは20個までに制限する", async () => {
    vi.mocked(api.searchThreadsKeyword).mockResolvedValue([]);
    const many = Array.from({ length: 30 }, (_, i) => `kw${i}`);
    const r = await fetchTrendsForAccount(SCSU, scopeOf(SCSU), NOW, settings({ keywords: many }));
    expect(r.keywords).toBe(20);
    expect(api.searchThreadsKeyword).toHaveBeenCalledTimes(40); // 20 × (TOP + RECENT)
  });

  it("保存期間の整理は「保存済み」を残す関数に委ねる", async () => {
    vi.mocked(api.searchThreadsKeyword).mockResolvedValue([]);
    await fetchTrendsForAccount(SCSU, scopeOf(SCSU), NOW, settings({ retentionDays: 14 }));
    expect(db.pruneTrendPosts).toHaveBeenCalledWith(1, 14);
  });
});

describe("runTrendFetchIfDue", () => {
  it("枠が来ているアカウントだけ収集し、ロックキーを先に保存する", async () => {
    vi.mocked(db.getTrendSettings).mockResolvedValue(settings());
    vi.mocked(api.searchThreadsKeyword).mockResolvedValue([item("a")]);
    const out = await runTrendFetchIfDue([SCSU], scopeOf, NOW);
    expect(out).toHaveLength(1);
    expect(db.upsertTrendSettings).toHaveBeenCalledWith(1, { lastFetchKey: "2026-09-04/0" });
  });

  it("同じ枠を二度取らない", async () => {
    vi.mocked(db.getTrendSettings).mockResolvedValue(settings({ lastFetchKey: "2026-09-04/0" }));
    const out = await runTrendFetchIfDue([SCSU], scopeOf, NOW);
    expect(out).toHaveLength(0);
    expect(api.searchThreadsKeyword).not.toHaveBeenCalled();
  });

  it("自動取得オフ・キーワード無しは飛ばす", async () => {
    vi.mocked(db.getTrendSettings)
      .mockResolvedValueOnce(settings({ autoFetch: false }))
      .mockResolvedValueOnce(settings({ keywords: [] }));
    const out = await runTrendFetchIfDue([SCSU, CREAW], scopeOf, NOW);
    expect(out).toHaveLength(0);
  });

  it("レート制限で何も取れなかった枠はロックを戻し、次回 tick で再試行する", async () => {
    vi.mocked(db.getTrendSettings).mockResolvedValue(settings({ lastFetchKey: "2026-09-03/1" }));
    vi.mocked(api.searchThreadsKeyword).mockRejectedValue(new Error("Threads keyword search failed (429): rate limit"));
    await runTrendFetchIfDue([SCSU], scopeOf, NOW);
    const calls = vi.mocked(db.upsertTrendSettings).mock.calls.map((c) => c[1]);
    expect(calls[0]).toEqual({ lastFetchKey: "2026-09-04/0" });
    expect(calls[calls.length - 1]).toEqual({ lastFetchKey: "2026-09-03/1" });
  });

  it("認証失敗ではロックを保つ（枠ごとに1回しか試さない）", async () => {
    vi.mocked(db.getTrendSettings).mockResolvedValue(settings({ lastFetchKey: null }));
    vi.mocked(api.searchThreadsKeyword).mockRejectedValue(new Error("Threads keyword search failed (401): OAuthException"));
    await runTrendFetchIfDue([SCSU], scopeOf, NOW);
    const keys = vi.mocked(db.upsertTrendSettings).mock.calls.map((c) => c[1]).filter((v) => "lastFetchKey" in v);
    expect(keys).toEqual([{ lastFetchKey: "2026-09-04/0" }]);
  });

  it("1アカウントの失敗が他アカウントを止めない", async () => {
    vi.mocked(db.getTrendSettings)
      .mockRejectedValueOnce(new Error("db down for account 1"))
      .mockResolvedValueOnce(settings());
    vi.mocked(api.searchThreadsKeyword).mockResolvedValue([item("z")]);
    const out = await runTrendFetchIfDue([SCSU, CREAW], scopeOf, NOW);
    expect(out.map((r) => r.accountId)).toEqual([2]);
    expect(vi.mocked(db.upsertTrendPost).mock.calls.every((c) => c[0].accountId === 2)).toBe(true);
  });
});

describe("parseTrendAnalysis", () => {
  it("欠けた項目は空で埋め、継続性は3値に丸める", () => {
    const r = parseTrendAnalysis(JSON.stringify({ themes: ["a"], durability: "weird", perPost: [{ id: 1, reason: "x", ideas: ["y"] }, { id: "no" }] }));
    expect(r.themes).toEqual(["a"]);
    expect(r.hooks).toEqual([]);
    expect(r.durability).toBe("unknown");
    expect(r.perPost).toEqual([{ id: 1, reason: "x", ideas: ["y"] }]);
  });
  it("コードブロック付きでも読める", () => {
    expect(parseTrendAnalysis('```json\n{"tone":"丁寧"}\n```').tone).toBe("丁寧");
  });
});

describe("periodSince", () => {
  it("24h / 7d / 30d を時間に換算する", () => {
    expect(NOW.getTime() - periodSince("24h", NOW).getTime()).toBe(24 * 3_600_000);
    expect(NOW.getTime() - periodSince("7d", NOW).getTime()).toBe(7 * 24 * 3_600_000);
    expect(NOW.getTime() - periodSince("30d", NOW).getTime()).toBe(30 * 24 * 3_600_000);
  });
});

describe("analyzeTrends", () => {
  const posts = [
    { id: 11, score: 80, isRising: true, keyword: "留学", hasReplies: true, summary: "要約1", accountId: 1 },
    { id: 12, score: 40, isRising: false, keyword: "留学", hasReplies: false, summary: "要約2", accountId: 1 },
  ];
  beforeEach(() => {
    vi.mocked(db.getTrendSettings).mockResolvedValue(settings({ aiDailyLimit: 2 }));
    vi.mocked(db.listTrendPosts).mockResolvedValue(posts as never);
    vi.mocked(db.createTrendAnalysis).mockResolvedValue(77);
    vi.mocked(db.setTrendPostAi).mockResolvedValue(undefined);
  });

  it("1日の上限に達していたら AI を呼ばない", async () => {
    vi.mocked(db.countTrendAnalysesToday).mockResolvedValue(2);
    await expect(analyzeTrends(SCSU, "7d", NOW)).rejects.toThrow(/AI daily limit/);
    expect(llm.invokeLLM).not.toHaveBeenCalled();
  });

  it("投稿が無ければ AI を呼ばない", async () => {
    vi.mocked(db.countTrendAnalysesToday).mockResolvedValue(0);
    vi.mocked(db.listTrendPosts).mockResolvedValue([]);
    await expect(analyzeTrends(SCSU, "7d", NOW)).rejects.toThrow(/empty/);
    expect(llm.invokeLLM).not.toHaveBeenCalled();
  });

  it("AIには自アカウントの要約だけを渡し、結果を自アカウントの行にだけ書く", async () => {
    vi.mocked(db.countTrendAnalysesToday).mockResolvedValue(0);
    vi.mocked(llm.invokeLLM).mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ themes: ["準備"], perPost: [{ id: 11, reason: "r", ideas: ["i"] }, { id: 999, reason: "other", ideas: [] }] }) } }],
    } as never);
    const r = await analyzeTrends(SCSU, "7d", NOW);
    expect(r.analysisId).toBe(77);
    expect(db.listTrendPosts).toHaveBeenCalledWith(1, expect.objectContaining({ status: ["active", "saved"] }));
    const sent = JSON.stringify(vi.mocked(llm.invokeLLM).mock.calls[0][0]);
    expect(sent).toContain("要約1");
    expect(sent).not.toContain(TOKEN_A);
    // 分析対象に無い id=999 には書かない
    expect(db.setTrendPostAi).toHaveBeenCalledTimes(1);
    expect(db.setTrendPostAi).toHaveBeenCalledWith(11, 1, "r", ["i"]);
    expect(db.createTrendAnalysis).toHaveBeenCalledWith(1, "7d", expect.objectContaining({ themes: ["準備"] }), 2);
  });
});
