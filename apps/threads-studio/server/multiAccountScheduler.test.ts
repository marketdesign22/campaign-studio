/**
 * バックグラウンド投稿のアカウント分離。
 *
 * 予約実行は画面の選択状態と無関係に、対象アカウントのスコープとトークンで
 * 動かなければならない。ここではその点だけを確かめる。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Account } from "../drizzle/schema";

vi.mock("./db", () => ({
  listAccounts: vi.fn(),
  listActiveAccounts: vi.fn(),
  getAccountSettings: vi.fn(),
  getNextPendingPost: vi.fn(),
  getEvergreenCandidate: vi.fn(),
  hasSlotLogInRange: vi.fn(),
  createPostLog: vi.fn(),
  updatePost: vi.fn(),
  markPostRecycled: vi.fn(),
  listLogsForAnalytics: vi.fn(),
  upsertAnalytics: vi.fn(),
  updateAccount: vi.fn(),
  getSettings: vi.fn(),
  upsertSettings: vi.fn(),
}));
vi.mock("./threadsApi", () => ({
  publishTextPost: vi.fn(),
  fetchPostInsights: vi.fn(),
  refreshLongLivedToken: vi.fn(),
}));
vi.mock("./_core/notification", () => ({ notifyOwner: vi.fn() }));
vi.mock("./trends", () => ({
  runTrendFetchIfDue: vi.fn(),
  markDeletedSavedPosts: vi.fn(),
}));
vi.mock("./replies", () => ({
  fetchRepliesForAccounts: vi.fn(),
}));

import * as db from "./db";
import * as threadsApi from "./threadsApi";
import * as trends from "./trends";
import * as replies from "./replies";
import { fetchAnalyticsForRecentPosts, runSlotForAccount, runTick } from "./scheduler";
import { scopeOf } from "./accountScope";

function account(
  id: number, name: string, threadsUserId: string, active = true, slots: string | null = null
): Account {
  return {
    id, name, threadsUserId,
    threadsAccessToken: `token-for-${name}`,
    tokenRefreshedAt: new Date(), tokenExpiresAt: null,
    // 常に発火するよう 0:00 に設定
    morningHour: 0, morningMinute: 0, eveningHour: 0, eveningMinute: 0,
    timezone: "LA", slots, active,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
  };
}

const SCSU = account(1, "SCSU.Japan", "28207384535618732");
const CREAW = account(2, "creaw.usa", "39203306012602270");
const NOW = new Date("2026-09-01T20:00:00Z"); // LA 13:00

const DEFAULT_SETTINGS = {
  requireApproval: false, notifyOnError: true, autoFillEvergreen: false,
  recycleRewrite: true, recycleCooldownDays: 30, postsPerDay: 2,
  brandName: null, brandAccent: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(db.listAccounts).mockResolvedValue([SCSU, CREAW]);
  // 日次メンテナンス（トークン更新・分析取得）はここでは対象外なので空にしておく
  vi.mocked(db.listActiveAccounts).mockResolvedValue([]);
  vi.mocked(db.listLogsForAnalytics).mockResolvedValue([]);
  vi.mocked(db.getAccountSettings).mockResolvedValue({ ...DEFAULT_SETTINGS });
  vi.mocked(db.hasSlotLogInRange).mockResolvedValue(false);
  vi.mocked(db.getNextPendingPost).mockResolvedValue(undefined);
  vi.mocked(db.getSettings).mockResolvedValue({ lastMaintenanceDate: "2026-09-01" } as never);
});

describe("runSlotForAccount", () => {
  it("原稿の抽出は渡されたアカウントのスコープで行われる", async () => {
    await runSlotForAccount(CREAW, scopeOf(CREAW, 1), 0, NOW);
    expect(db.getNextPendingPost).toHaveBeenCalledWith(
      0, "2026-09-01", { accountId: 2, includeLegacy: false }
    );
  });

  it("最古アカウントだけが accountId 未設定の旧原稿を拾う", async () => {
    await runSlotForAccount(SCSU, scopeOf(SCSU, 1), 0, NOW);
    expect(db.getNextPendingPost).toHaveBeenCalledWith(
      0, "2026-09-01", { accountId: 1, includeLegacy: true }
    );
  });

  it("投稿はそのアカウント自身のトークンで実行され、履歴も同じアカウントに残る", async () => {
    vi.mocked(db.getNextPendingPost).mockResolvedValue({
      id: 42, content: "creaw の投稿", imageUrl: null, categoryId: null,
    } as never);
    vi.mocked(threadsApi.publishTextPost).mockResolvedValue({ containerId: "c", postId: "p-1" });

    await runSlotForAccount(CREAW, scopeOf(CREAW, 1), 0, NOW);

    expect(threadsApi.publishTextPost).toHaveBeenCalledWith(
      "token-for-creaw.usa", "39203306012602270", "creaw の投稿", null
    );
    expect(db.createPostLog).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: 2, postId: 42, status: "posted" })
    );
  });

  it("二重投稿ロックの判定もアカウントスコープで行う", async () => {
    await runSlotForAccount(CREAW, scopeOf(CREAW, 1), 1, NOW);
    expect(db.hasSlotLogInRange).toHaveBeenCalledWith(
      { accountId: 2, includeLegacy: false }, 1, expect.any(Date), expect.any(Date)
    );
  });

  it("再投稿コンテンツの設定はアカウントごとに読む", async () => {
    vi.mocked(db.getAccountSettings).mockResolvedValue({
      ...DEFAULT_SETTINGS, autoFillEvergreen: true, recycleCooldownDays: 7,
    });
    vi.mocked(db.getEvergreenCandidate).mockResolvedValue(undefined);
    await runSlotForAccount(CREAW, scopeOf(CREAW, 1), 0, NOW);
    expect(db.getAccountSettings).toHaveBeenCalledWith(2);
    expect(db.getEvergreenCandidate).toHaveBeenCalledWith(
      { accountId: 2, includeLegacy: false }, 7, NOW
    );
  });

  it("片方のアカウントの再投稿設定が他方に漏れない", async () => {
    vi.mocked(db.getAccountSettings).mockImplementation(async (id: number) =>
      id === 1 ? { ...DEFAULT_SETTINGS, autoFillEvergreen: true } : { ...DEFAULT_SETTINGS }
    );
    vi.mocked(db.getEvergreenCandidate).mockResolvedValue(undefined);

    await runSlotForAccount(CREAW, scopeOf(CREAW, 1), 0, NOW);
    expect(db.getEvergreenCandidate).not.toHaveBeenCalled();

    await runSlotForAccount(SCSU, scopeOf(SCSU, 1), 0, NOW);
    expect(db.getEvergreenCandidate).toHaveBeenCalledTimes(1);
  });
});

describe("枠ごとのタイムゾーン", () => {
  /** JSTの朝夕 + PTの朝夕。1アカウントに4枠 */
  const MIXED = account(1, "SCSU.Japan", "28207384535618732", true, JSON.stringify([
    { hour: 12, minute: 0, timezone: "JP" },
    { hour: 17, minute: 0, timezone: "JP" },
    { hour: 8, minute: 0, timezone: "LA" },
    { hour: 18, minute: 0, timezone: "LA" },
  ]));

  it("設定した枠の数だけ発火判定する", async () => {
    vi.mocked(db.listAccounts).mockResolvedValue([MIXED]);
    await runTick(NOW);
    // NOW = 2026-09-01T20:00Z ＝ JST 9/2 05:00 / PT 9/1 13:00
    // JST枠(12:00,17:00)はまだ来ていない。PT枠(8:00,18:00)は8:00だけ到来済み
    const calls = vi.mocked(db.getNextPendingPost).mock.calls.map((c) => c[0]);
    expect(calls).toEqual([2]);
  });

  it("枠のタイムゾーンで「今日」を数えるので、日付境界も枠ごとに違う", async () => {
    // JST 9/2 05:00 なので、JST枠の当日は 9/2、PT枠の当日は 9/1
    vi.mocked(db.listAccounts).mockResolvedValue([MIXED]);
    await runTick(NOW);
    const dates = vi.mocked(db.getNextPendingPost).mock.calls.map((c) => c[1]);
    expect(dates).toEqual(["2026-09-01"]); // 発火したPT枠の当日
  });

  it("JSTの枠は日本の時刻で発火する", async () => {
    vi.mocked(db.listAccounts).mockResolvedValue([MIXED]);
    // 2026-09-02T04:00Z = JST 13:00 / PT 21:00 → JST 12:00枠が到来
    await runTick(new Date("2026-09-02T04:00:00Z"));
    const calls = vi.mocked(db.getNextPendingPost).mock.calls.map((c) => c[0]);
    expect(calls).toContain(0);
  });

  it("存在しない枠番号では何もしない", async () => {
    expect(await runSlotForAccount(MIXED, scopeOf(MIXED, 1), 9, NOW)).toBeNull();
    expect(db.getNextPendingPost).not.toHaveBeenCalled();
  });

  it("枠未設定のアカウントは従来どおり朝夕2枠", async () => {
    vi.mocked(db.listAccounts).mockResolvedValue([SCSU]);
    await runTick(NOW);
    const calls = vi.mocked(db.getNextPendingPost).mock.calls.map((c) => c[0]);
    expect(calls).toEqual([0, 1]);
  });
});

describe("runTick", () => {
  it("各アカウントを自分自身のスコープで処理する", async () => {
    await runTick(NOW);
    const scopes = vi.mocked(db.getNextPendingPost).mock.calls.map((c) => c[2]);
    expect(scopes).toContainEqual({ accountId: 1, includeLegacy: true });
    expect(scopes).toContainEqual({ accountId: 2, includeLegacy: false });
    // creaw.usa のスコープで旧データが拾われることは無い
    expect(scopes.filter((s) => s.accountId === 2).every((s) => !s.includeLegacy)).toBe(true);
  });

  it("無効化されたアカウントは投稿対象から外れる", async () => {
    vi.mocked(db.listAccounts).mockResolvedValue([SCSU, account(2, "creaw.usa", "x", false)]);
    await runTick(NOW);
    const scopes = vi.mocked(db.getNextPendingPost).mock.calls.map((c) => c[2]);
    expect(scopes.every((s) => s.accountId === 1)).toBe(true);
  });
});

describe("分析データの取得", () => {
  it("各ログを、そのログのアカウントのトークンで取得する", async () => {
    vi.mocked(db.listLogsForAnalytics).mockResolvedValue([
      { id: 1, accountId: 1, threadsPostId: "scsu-1" },
      { id: 2, accountId: 2, threadsPostId: "creaw-1" },
    ] as never);
    vi.mocked(threadsApi.fetchPostInsights).mockResolvedValue({
      likes: 1, replies: 0, reposts: 0, views: 10,
    });
    vi.mocked(db.listActiveAccounts).mockResolvedValue([SCSU, CREAW]);

    await fetchAnalyticsForRecentPosts();

    expect(threadsApi.fetchPostInsights).toHaveBeenCalledWith("token-for-SCSU.Japan", "scsu-1");
    expect(threadsApi.fetchPostInsights).toHaveBeenCalledWith("token-for-creaw.usa", "creaw-1");
  });

  it("所属アカウントが消えたログは、他アカウントのトークンで取りに行かない", async () => {
    vi.mocked(db.listLogsForAnalytics).mockResolvedValue([
      { id: 3, accountId: 99, threadsPostId: "orphan-1" },
    ] as never);
    await fetchAnalyticsForRecentPosts();
    expect(threadsApi.fetchPostInsights).not.toHaveBeenCalled();
  });

  it("accountId 未設定の旧ログは最古アカウントのトークンで取得する", async () => {
    vi.mocked(db.listLogsForAnalytics).mockResolvedValue([
      { id: 4, accountId: null, threadsPostId: "legacy-1" },
    ] as never);
    vi.mocked(threadsApi.fetchPostInsights).mockResolvedValue({
      likes: 0, replies: 0, reposts: 0, views: 0,
    });
    await fetchAnalyticsForRecentPosts();
    expect(threadsApi.fetchPostInsights).toHaveBeenCalledWith("token-for-SCSU.Japan", "legacy-1");
  });
});

describe("トレンド取得と投稿処理の分離", () => {
  it("トレンド取得は投稿処理の後に、投稿対象アカウントのスコープで呼ばれる", async () => {
    const order: string[] = [];
    vi.mocked(db.getNextPendingPost).mockImplementation(async () => {
      order.push("post");
      return { id: 1, content: "hello", imageUrl: null, categoryId: null } as never;
    });
    vi.mocked(threadsApi.publishTextPost).mockResolvedValue({ containerId: "c", postId: "p" });
    vi.mocked(trends.runTrendFetchIfDue).mockImplementation(async () => { order.push("trends"); return []; });

    await runTick(NOW);

    expect(order.indexOf("trends")).toBeGreaterThan(order.lastIndexOf("post"));
    const [accounts, scopeFn] = vi.mocked(trends.runTrendFetchIfDue).mock.calls[0];
    expect(accounts.map((a) => a.id)).toEqual([1, 2]);
    expect(scopeFn(CREAW)).toEqual({ accountId: 2, includeLegacy: false });
    expect(scopeFn(SCSU)).toEqual({ accountId: 1, includeLegacy: true });
  });

  it("トレンド取得が例外を投げても、投稿は完了し結果が返る", async () => {
    vi.mocked(db.getNextPendingPost).mockResolvedValue({ id: 1, content: "hello", imageUrl: null, categoryId: null } as never);
    vi.mocked(threadsApi.publishTextPost).mockResolvedValue({ containerId: "c", postId: "p" });
    vi.mocked(trends.runTrendFetchIfDue).mockRejectedValue(new Error("Threads keyword search failed (429): rate limit"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const r = await runTick(NOW);

    expect(r.fired.length).toBeGreaterThan(0);
    expect(r.fired.every((f) => f.posted === "p")).toBe(true);
    expect(db.createPostLog).toHaveBeenCalled();
    // ログには例外名だけで、メッセージ本文（レスポンス）は出さない
    expect(warn.mock.calls.flat().join(" ")).not.toContain("429");
    warn.mockRestore();
  });

  it("日次の削除確認が失敗しても、トークン更新・分析取得は影響を受けない", async () => {
    vi.mocked(db.getSettings).mockResolvedValue({ lastMaintenanceDate: "2026-08-31" } as never);
    vi.mocked(db.listActiveAccounts).mockResolvedValue([SCSU]);
    vi.mocked(trends.markDeletedSavedPosts).mockRejectedValue(new Error("boom"));
    vi.mocked(trends.runTrendFetchIfDue).mockResolvedValue([]);
    vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(runTick(NOW)).resolves.toBeTruthy();
    expect(db.upsertSettings).toHaveBeenCalledWith({ lastMaintenanceDate: "2026-09-01" });
  });
});

describe("受信箱の取得と投稿処理の分離", () => {
  it("返信取得はトレンド取得の後に、アクティブな全アカウントで呼ばれる", async () => {
    vi.mocked(db.getNextPendingPost).mockResolvedValue(undefined);
    vi.mocked(replies.fetchRepliesForAccounts).mockResolvedValue([]);

    await runTick(NOW);

    const [accounts] = vi.mocked(replies.fetchRepliesForAccounts).mock.calls[0];
    expect(accounts.map((a) => a.id)).toEqual([1, 2]);
  });

  it("返信取得が例外を投げても、投稿は完了し結果が返る", async () => {
    vi.mocked(db.getNextPendingPost).mockResolvedValue({ id: 1, content: "hello", imageUrl: null, categoryId: null } as never);
    vi.mocked(threadsApi.publishTextPost).mockResolvedValue({ containerId: "c", postId: "p" });
    vi.mocked(replies.fetchRepliesForAccounts).mockRejectedValue(new Error("Threads replies fetch failed (401): OAuthException"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const r = await runTick(NOW);

    expect(r.fired.length).toBeGreaterThan(0);
    expect(r.fired.every((f) => f.posted === "p")).toBe(true);
    expect(warn.mock.calls.flat().join(" ")).not.toContain("OAuthException");
    warn.mockRestore();
  });

  it("無効化されたアカウントは返信取得の対象から外れる", async () => {
    vi.mocked(db.listAccounts).mockResolvedValue([SCSU, account(2, "creaw.usa", "x", false)]);
    vi.mocked(db.getNextPendingPost).mockResolvedValue(undefined);
    vi.mocked(replies.fetchRepliesForAccounts).mockResolvedValue([]);

    await runTick(NOW);

    const [accounts] = vi.mocked(replies.fetchRepliesForAccounts).mock.calls[0];
    expect(accounts.map((a) => a.id)).toEqual([1]);
  });
});
