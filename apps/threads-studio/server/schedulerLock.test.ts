/**
 * 投稿処理の多重起動防止。
 *
 * 内蔵スケジューラ・外部cron（/api/scheduled/tick）・旧固定時刻エンドポイントが
 * 同時に走ると、どちらも「この枠はまだ投稿していない」と判断して二重投稿しうる。
 * ここでは、重なった呼び出しがスキップされ、投稿が1回だけになることを確かめる。
 * DB と Threads API はすべてモック。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import type { Account } from "../drizzle/schema";

vi.mock("./_core/env", () => ({ ENV: { cronSecret: "test-cron-secret", appUrl: "" } }));
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
  upsertAnalyticsDaily: vi.fn(),
  updateAccount: vi.fn(),
  getSettings: vi.fn(),
  upsertSettings: vi.fn(),
  recordFollowerSnapshot: vi.fn(),
}));
vi.mock("./threadsApi", () => ({
  publishTextPost: vi.fn(),
  fetchPostInsights: vi.fn(),
  refreshLongLivedToken: vi.fn(),
  fetchFollowerCount: vi.fn(),
}));
vi.mock("./_core/notification", () => ({ notifyOwner: vi.fn() }));
vi.mock("./accountInsights", () => ({ fetchAccountInsights: vi.fn().mockResolvedValue([]) }));
vi.mock("./reportMaintenance", () => ({ runMonthlyReportMaintenance: vi.fn().mockResolvedValue([]) }));
vi.mock("./strategyService", () => ({ runStrategyMaintenance: vi.fn().mockResolvedValue(undefined) }));
vi.mock("./trends", () => ({ runTrendFetchIfDue: vi.fn(), markDeletedSavedPosts: vi.fn() }));
vi.mock("./replies", () => ({ fetchRepliesForAccounts: vi.fn() }));

import * as db from "./db";
import * as threadsApi from "./threadsApi";
import { runTick } from "./scheduler";
import { eveningPostHandler, morningPostHandler, tickHandler } from "./scheduledHandlers";
import { ALREADY_RUNNING, isSchedulerRunning, runExclusive } from "./schedulerLock";

/** 0:00（LA）の1枠だけを持つアカウント。テスト時刻では常に到来済み */
const ACCOUNT: Account = {
  id: 1, name: "test-account", threadsUserId: "test-user",
  threadsAccessToken: "test-token",
  tokenRefreshedAt: new Date(), tokenExpiresAt: null,
  morningHour: 0, morningMinute: 0, eveningHour: 0, eveningMinute: 0,
  timezone: "LA", slots: JSON.stringify([{ hour: 0, minute: 0, timezone: "LA" }]), active: true,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
};
const NOW = new Date("2026-09-01T20:00:00Z"); // LA 13:00

const SETTINGS = {
  requireApproval: false, notifyOnError: false, autoFillEvergreen: false,
  recycleRewrite: false, recycleCooldownDays: 30, postsPerDay: 1,
  brandName: null, brandAccent: null,
};

type Published = { containerId: string; postId: string };

/** 外から解決できる Promise（投稿APIの呼び出しを途中で止めておくため） */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const cronReq = () =>
  ({ headers: { authorization: "Bearer test-cron-secret" } }) as unknown as Request;

function fakeRes() {
  const res = { statusCode: 200, body: undefined as unknown } as {
    statusCode: number; body: unknown; status: (c: number) => unknown; json: (b: unknown) => unknown;
  };
  res.status = vi.fn((c: number) => { res.statusCode = c; return res; });
  res.json = vi.fn((b: unknown) => { res.body = b; return res; });
  return res as typeof res & Response;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(db.listAccounts).mockResolvedValue([ACCOUNT]);
  vi.mocked(db.listActiveAccounts).mockResolvedValue([]);
  vi.mocked(db.listLogsForAnalytics).mockResolvedValue([]);
  vi.mocked(db.getAccountSettings).mockResolvedValue({ ...SETTINGS });
  // どちらの実行から見ても「まだ投稿ログが無い」状態（＝ロックが無いと二重投稿になる状況）
  vi.mocked(db.hasSlotLogInRange).mockResolvedValue(false);
  vi.mocked(db.getNextPendingPost).mockResolvedValue({
    id: 10, content: "予約投稿", imageUrl: null, categoryId: null,
  } as never);
  vi.mocked(db.getSettings).mockResolvedValue({ lastMaintenanceDate: "2026-09-01" } as never);
  vi.mocked(threadsApi.publishTextPost).mockResolvedValue({ containerId: "c", postId: "p" });
});

describe("runExclusive", () => {
  it("実行中は2つ目を呼ばずにスキップする", async () => {
    const gate = deferred<void>();
    const fn = vi.fn(() => gate.promise);
    const first = runExclusive("a", fn);
    const second = await runExclusive("b", fn);
    expect(second).toMatchObject({ ran: false, heldBy: "a" });
    expect(fn).toHaveBeenCalledTimes(1);
    gate.resolve();
    expect(await first).toEqual({ ran: true, value: undefined });
    expect(isSchedulerRunning()).toBe(false);
  });

  it("例外（非同期・同期とも）でもロックを解放し、例外は呼び出し元へ伝える", async () => {
    await expect(runExclusive("x", async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    expect(isSchedulerRunning()).toBe(false);
    await expect(runExclusive("y", () => { throw new Error("sync boom"); })).rejects.toThrow("sync boom");
    expect(isSchedulerRunning()).toBe(false);
    expect(await runExclusive("z", async () => 1)).toEqual({ ran: true, value: 1 });
  });
});

describe("runTick の多重起動防止", () => {
  it("同時に2回呼ばれても投稿は1回だけ", async () => {
    const [a, b] = await Promise.all([runTick(NOW), runTick(NOW)]);
    expect(threadsApi.publishTextPost).toHaveBeenCalledTimes(1);
    expect(db.createPostLog).toHaveBeenCalledTimes(1);
    expect(a.fired).toHaveLength(1);
    expect(b).toEqual({ fired: [], skipped: ALREADY_RUNNING });
  });

  it("投稿APIの応答待ちの間に来た tick はスキップされ、終了後はロックが外れる", async () => {
    const gate = deferred<Published>();
    vi.mocked(threadsApi.publishTextPost).mockReturnValueOnce(gate.promise);

    const first = runTick(NOW);
    await vi.waitFor(() => expect(threadsApi.publishTextPost).toHaveBeenCalledTimes(1));
    expect(await runTick(NOW)).toEqual({ fired: [], skipped: ALREADY_RUNNING });

    gate.resolve({ containerId: "c", postId: "p" });
    expect((await first).fired).toHaveLength(1);
    expect(threadsApi.publishTextPost).toHaveBeenCalledTimes(1);
    expect(isSchedulerRunning()).toBe(false);
  });

  it("tick が例外で終わってもロックは残らず、次の tick は通常どおり動く", async () => {
    vi.mocked(db.listAccounts).mockRejectedValueOnce(new Error("db down"));
    await expect(runTick(NOW)).rejects.toThrow("db down");
    expect(isSchedulerRunning()).toBe(false);

    const r = await runTick(NOW);
    expect(r.skipped).toBeUndefined();
    expect(threadsApi.publishTextPost).toHaveBeenCalledTimes(1);
  });

  it("通常の tick の戻り値は従来どおり（skipped を含まない）", async () => {
    const r = await runTick(NOW);
    expect(r).toEqual({ fired: [{ account: 1, slotIndex: 0, posted: "p" }] });
  });
});

describe("HTTP エンドポイント", () => {
  it("内蔵スケジューラの tick 実行中に /api/scheduled/tick が来たら 200 でスキップを返す", async () => {
    const gate = deferred<Published>();
    vi.mocked(threadsApi.publishTextPost).mockReturnValueOnce(gate.promise);
    const internal = runTick(NOW); // server/cron.ts と同じ呼び出し
    await vi.waitFor(() => expect(threadsApi.publishTextPost).toHaveBeenCalledTimes(1));

    const res = fakeRes();
    await tickHandler(cronReq(), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true, fired: [], skipped: ALREADY_RUNNING });

    gate.resolve({ containerId: "c", postId: "p" });
    await internal;
    expect(threadsApi.publishTextPost).toHaveBeenCalledTimes(1);
  });

  it("tick 実行中は旧 morning / evening エンドポイントもスキップする", async () => {
    const gate = deferred<Published>();
    vi.mocked(threadsApi.publishTextPost).mockReturnValueOnce(gate.promise);
    const internal = runTick(NOW);
    await vi.waitFor(() => expect(threadsApi.publishTextPost).toHaveBeenCalledTimes(1));

    for (const handler of [morningPostHandler, eveningPostHandler]) {
      const res = fakeRes();
      await handler(cronReq(), res);
      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual({ ok: true, skipped: ALREADY_RUNNING, fired: [] });
    }

    gate.resolve({ containerId: "c", postId: "p" });
    await internal;
    expect(threadsApi.publishTextPost).toHaveBeenCalledTimes(1);
  });

  it("旧エンドポイントの実行中に来た tick もスキップされる", async () => {
    const gate = deferred<Published>();
    vi.mocked(threadsApi.publishTextPost).mockReturnValueOnce(gate.promise);
    const res = fakeRes();
    const legacy = morningPostHandler(cronReq(), res);
    await vi.waitFor(() => expect(threadsApi.publishTextPost).toHaveBeenCalledTimes(1));

    expect(await runTick(NOW)).toEqual({ fired: [], skipped: ALREADY_RUNNING });

    gate.resolve({ containerId: "c", postId: "p" });
    await legacy;
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: true, fired: [{ account: 1, posted: "p" }] });
    expect(threadsApi.publishTextPost).toHaveBeenCalledTimes(1);
    expect(isSchedulerRunning()).toBe(false);
  });

  it("旧エンドポイントが例外で終わっても 500 を返し、ロックは解放される", async () => {
    vi.mocked(db.listAccounts).mockRejectedValueOnce(new Error("db down"));
    const res = fakeRes();
    await morningPostHandler(cronReq(), res);
    expect(res.statusCode).toBe(500);
    expect(isSchedulerRunning()).toBe(false);

    const ok = fakeRes();
    await tickHandler(cronReq(), ok);
    expect(ok.statusCode).toBe(200);
    expect((ok.body as { skipped?: string }).skipped).toBeUndefined();
  });

  it("CRON_SECRET が違えばロックに触れずに 403", async () => {
    const res = fakeRes();
    await tickHandler({ headers: { authorization: "Bearer wrong" } } as unknown as Request, res);
    expect(res.statusCode).toBe(403);
    expect(db.listAccounts).not.toHaveBeenCalled();
  });
});
