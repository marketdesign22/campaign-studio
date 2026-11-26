/**
 * 枠の時刻が来たのに「出すものが無くて」見送ったときのログ。
 *
 * 投稿したときしかログが出ないと、見送りなのか不具合なのか分からない。
 * 見送りの理由を1行だけ、同じ枠・同じ日には1回だけ出すことを確かめる。
 * DB・Threads API はすべてモック。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  upsertAnalyticsDaily: vi.fn(),
  updateAccount: vi.fn(),
  getSettings: vi.fn(),
  upsertSettings: vi.fn(),
  getTrendSettings: vi.fn(),
  recordFollowerSnapshot: vi.fn(),
}));
vi.mock("./threadsApi", () => ({
  publishTextPost: vi.fn(),
  fetchPostInsights: vi.fn(),
  refreshLongLivedToken: vi.fn(),
  fetchFollowerCount: vi.fn(),
}));
vi.mock("./_core/notification", () => ({ notifyOwner: vi.fn() }));
vi.mock("./accountInsights", () => ({
  fetchAccountInsights: vi.fn().mockResolvedValue([]),
}));
vi.mock("./reportMaintenance", () => ({
  runMonthlyReportMaintenance: vi.fn().mockResolvedValue([]),
}));
vi.mock("./trends", () => ({
  runTrendFetchIfDue: vi.fn(),
  markDeletedSavedPosts: vi.fn(),
}));
vi.mock("./replies", () => ({ fetchRepliesForAccounts: vi.fn() }));

import * as db from "./db";
import * as threadsApi from "./threadsApi";
import { resetSlotSkipLogForTest, runSlotForAccount } from "./scheduler";
import { scopeOf } from "./accountScope";

const ACCOUNT: Account = {
  id: 7,
  name: "test-account",
  threadsUserId: "0000",
  threadsAccessToken: "zz-secret-token",
  tokenRefreshedAt: new Date(),
  tokenExpiresAt: null,
  // 常に時刻到来とみなされるよう 0:00
  morningHour: 0,
  morningMinute: 0,
  eveningHour: 0,
  eveningMinute: 0,
  timezone: "LA",
  slots: null,
  active: true,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
};
const SCOPE = scopeOf(ACCOUNT, ACCOUNT.id);
const DAY1 = new Date("2026-11-26T20:00:00Z"); // LA 11/26 12:00
const DAY1_LATER = new Date("2026-11-26T20:15:00Z");
const DAY2 = new Date("2026-11-27T20:00:00Z"); // LA 11/27 12:00

const SETTINGS = {
  requireApproval: false,
  notifyOnError: true,
  autoFillEvergreen: false,
  recycleRewrite: false,
  recycleCooldownDays: 30,
  postsPerDay: 2,
  brandName: null,
  brandAccent: null,
};

let log: ReturnType<typeof vi.spyOn>;
const skipLines = () =>
  log.mock.calls
    .map(args => String(args[0]))
    .filter(line => line.includes("slot skipped"));

beforeEach(() => {
  vi.clearAllMocks();
  resetSlotSkipLogForTest();
  log = vi.spyOn(console, "log").mockImplementation(() => {});
  vi.mocked(db.getAccountSettings).mockResolvedValue({ ...SETTINGS } as never);
  vi.mocked(db.hasSlotLogInRange).mockResolvedValue(false);
  vi.mocked(db.getNextPendingPost).mockResolvedValue(undefined);
  vi.mocked(db.getEvergreenCandidate).mockResolvedValue(undefined as never);
});
afterEach(() => log.mockRestore());

describe("出すものが無くて見送った枠のログ", () => {
  it("予約原稿が無く自動再投稿がオフなら、理由つきで1行出す", async () => {
    const result = await runSlotForAccount(ACCOUNT, SCOPE, 0, DAY1);
    expect(result).toBeNull();
    expect(skipLines()).toHaveLength(1);
    expect(skipLines()[0]).toContain(
      "account 7 slot 0 2026-11-26 reason=no_draft_autofill_off"
    );
    expect(threadsApi.publishTextPost).not.toHaveBeenCalled();
  });

  it("自動再投稿がオンでも候補が無ければ、その理由で出す", async () => {
    vi.mocked(db.getAccountSettings).mockResolvedValue({
      ...SETTINGS,
      autoFillEvergreen: true,
    } as never);
    await runSlotForAccount(ACCOUNT, SCOPE, 1, DAY1);
    expect(skipLines()).toHaveLength(1);
    expect(skipLines()[0]).toContain(
      "slot 1 2026-11-26 reason=no_draft_no_recycle_candidate"
    );
  });

  it("同じ枠・同じ日は、15分後の tick でも重ねて出さない", async () => {
    await runSlotForAccount(ACCOUNT, SCOPE, 0, DAY1);
    await runSlotForAccount(ACCOUNT, SCOPE, 0, DAY1_LATER);
    expect(skipLines()).toHaveLength(1);
  });

  it("別の枠や翌日は、それぞれ1回出す", async () => {
    await runSlotForAccount(ACCOUNT, SCOPE, 0, DAY1);
    await runSlotForAccount(ACCOUNT, SCOPE, 1, DAY1);
    await runSlotForAccount(ACCOUNT, SCOPE, 0, DAY2);
    expect(skipLines()).toHaveLength(3);
  });

  it("その日すでに投稿済みの枠は、見送りログを出さない", async () => {
    vi.mocked(db.hasSlotLogInRange).mockResolvedValue(true);
    await runSlotForAccount(ACCOUNT, SCOPE, 0, DAY1);
    expect(skipLines()).toHaveLength(0);
  });

  it("予約原稿があれば見送りではない（ログを出さず投稿へ進む）", async () => {
    vi.mocked(db.getNextPendingPost).mockResolvedValue({
      id: 1,
      content: "本文",
      imageUrl: null,
      categoryId: null,
    } as never);
    vi.mocked(threadsApi.publishTextPost).mockResolvedValue({
      postId: "p1",
    } as never);
    await runSlotForAccount(ACCOUNT, SCOPE, 0, DAY1);
    expect(skipLines()).toHaveLength(0);
    expect(threadsApi.publishTextPost).toHaveBeenCalledTimes(1);
  });

  it("ログにトークンを出さない", async () => {
    await runSlotForAccount(ACCOUNT, SCOPE, 0, DAY1);
    expect(skipLines().join("\n")).not.toContain("zz-secret-token");
  });
});
