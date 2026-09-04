/**
 * フォロワー数の取得と保存。実際のThreads APIは呼ばない。
 * 1アカウントの失敗が他を巻き込まないこと、既存履歴を消さないことが要点。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Account } from "../drizzle/schema";

vi.mock("./db", () => ({
  listAccounts: vi.fn(),
  listActiveAccounts: vi.fn(),
  recordFollowerSnapshot: vi.fn(),
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
  fetchFollowerCount: vi.fn(),
  fetchPostInsights: vi.fn(),
  publishTextPost: vi.fn(),
  refreshLongLivedToken: vi.fn(),
}));
vi.mock("./_core/notification", () => ({ notifyOwner: vi.fn() }));

import * as db from "./db";
import * as threadsApi from "./threadsApi";
import { fetchFollowerCounts } from "./scheduler";
import { classifyFollowerError } from "./routers/analytics";

function account(id: number, name: string, threadsUserId: string, slots: string | null = null): Account {
  return {
    id, name, threadsUserId,
    threadsAccessToken: `token-for-${name}`,
    tokenRefreshedAt: null, tokenExpiresAt: null,
    morningHour: 8, morningMinute: 0, eveningHour: 18, eveningMinute: 0,
    timezone: "LA", slots, active: true,
    createdAt: new Date(), updatedAt: new Date(),
  };
}

const SCSU = account(1, "SCSU.Japan", "28207384535618732");
const CREAW = account(30001, "creaw.usa", "39203306012602276");
/** 2026-09-01T20:00Z = PT 13:00 / JST 9/2 05:00 */
const NOW = new Date("2026-09-01T20:00:00Z");

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(db.listAccounts).mockResolvedValue([SCSU, CREAW] as never);
});

describe("フォロワー数の取得", () => {
  it("アカウントごとに自分のトークンとユーザーIDで取得する", async () => {
    vi.mocked(threadsApi.fetchFollowerCount).mockResolvedValue(1250);
    await fetchFollowerCounts(NOW);
    expect(threadsApi.fetchFollowerCount)
      .toHaveBeenCalledWith("token-for-SCSU.Japan", "28207384535618732");
    expect(threadsApi.fetchFollowerCount)
      .toHaveBeenCalledWith("token-for-creaw.usa", "39203306012602276");
  });

  it("アカウントのタイムゾーンの日付で記録する", async () => {
    // SCSU は PT（9/1）、creaw は枠をJSTにしてあるので 9/2 になる
    const jst = account(30001, "creaw.usa", "39203306012602276",
      JSON.stringify([{ hour: 12, minute: 0, timezone: "JP" }]));
    vi.mocked(db.listAccounts).mockResolvedValue([SCSU, jst] as never);
    vi.mocked(threadsApi.fetchFollowerCount).mockResolvedValue(100);

    await fetchFollowerCounts(NOW);

    expect(db.recordFollowerSnapshot).toHaveBeenCalledWith(1, "2026-09-01", 100);
    expect(db.recordFollowerSnapshot).toHaveBeenCalledWith(30001, "2026-09-02", 100);
  });

  it("1アカウントが失敗しても他のアカウントの取得は続く", async () => {
    vi.mocked(threadsApi.fetchFollowerCount)
      .mockRejectedValueOnce(new Error("Threads follower count fetch failed (401): expired"))
      .mockResolvedValueOnce(880);

    const results = await fetchFollowerCounts(NOW);

    expect(results[0].error).toBeDefined();
    expect(results[1].followers).toBe(880);
    // 失敗した方は記録しない。過去の履歴も触らない
    expect(db.recordFollowerSnapshot).toHaveBeenCalledTimes(1);
    expect(db.recordFollowerSnapshot).toHaveBeenCalledWith(30001, expect.any(String), 880);
  });

  it("メトリクスが利用できない場合（null）は記録しない", async () => {
    vi.mocked(threadsApi.fetchFollowerCount).mockResolvedValue(null);
    const results = await fetchFollowerCounts(NOW);
    expect(db.recordFollowerSnapshot).not.toHaveBeenCalled();
    expect(results.every((r) => r.error === "followers_count unavailable")).toBe(true);
  });

  it("取得できなかった日を0で埋めない", async () => {
    vi.mocked(threadsApi.fetchFollowerCount).mockRejectedValue(new Error("network"));
    await fetchFollowerCounts(NOW);
    expect(db.recordFollowerSnapshot).not.toHaveBeenCalled();
  });

  it("無効化されたアカウントは取得しない", async () => {
    vi.mocked(db.listAccounts).mockResolvedValue([{ ...CREAW, active: false }] as never);
    await fetchFollowerCounts(NOW);
    expect(threadsApi.fetchFollowerCount).not.toHaveBeenCalled();
  });
});

describe("失敗理由の分類", () => {
  it("画面に出せる粒度へ丸める（APIの生文面は返さない）", () => {
    expect(classifyFollowerError("followers_count unavailable")).toBe("unavailable");
    expect(classifyFollowerError("Threads follower count fetch failed (401): x")).toBe("token_expired");
    expect(classifyFollowerError("... (429) rate limit ...")).toBe("rate_limited");
    expect(classifyFollowerError("fetch failed")).toBe("network");
    expect(classifyFollowerError("なにか未知のエラー")).toBe("unknown");
  });
});
