/**
 * ルーター層のアカウント検証。
 *
 * リクエストを直接叩いて、
 *   - 書き込みが常に「選択中アカウント」に紐づくこと
 *   - 他アカウントのIDを渡しても弾かれること
 *   - 投稿が選択中アカウントのトークンで実行されること
 * を確かめる。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Account, Post } from "../drizzle/schema";

vi.mock("./db", () => ({
  listAccounts: vi.fn(),
  listPosts: vi.fn(),
  createPost: vi.fn(),
  updatePost: vi.fn(),
  deletePost: vi.fn(),
  deletePostsByIds: vi.fn(),
  filterOwnedPostIds: vi.fn(),
  getOwnedPost: vi.fn(),
  getAccountById: vi.fn(),
  getAccountSettings: vi.fn(),
  getNextPendingPostAny: vi.fn(),
  bulkCreatePosts: vi.fn(),
  saveAsEvergreen: vi.fn(),
  createPostLog: vi.fn(),
}));

vi.mock("./threadsApi", () => ({ publishTextPost: vi.fn() }));

import * as db from "./db";
import * as threadsApi from "./threadsApi";
import { postsRouter } from "./routers/posts";
import { manualPostRouter } from "./routers/manualPost";

function account(id: number, name: string, threadsUserId: string, active = true): Account {
  return {
    id, name, threadsUserId,
    threadsAccessToken: `token-for-${name}`,
    tokenRefreshedAt: null, tokenExpiresAt: null,
    morningHour: 8, morningMinute: 0, eveningHour: 18, eveningMinute: 0,
    timezone: "LA", active,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
  };
}

const SCSU = account(1, "SCSU.Japan", "28207384535618732");
const CREAW = account(2, "creaw.usa", "39203306012602270");

function post(id: number, accountId: number | null): Post {
  return {
    id, content: `post-${id}`, status: "pending", approvalStatus: "approved",
    accountId, slotIndex: 0, scheduledDate: null, categoryId: null, sortOrder: 0,
    imageUrl: null, evergreen: false, lastRecycledAt: null, recycleCount: 0,
    createdAt: new Date(), updatedAt: new Date(),
  };
}

/** 指定アカウントを選択中としてルーターを呼ぶ */
function caller(router: { createCaller: (ctx: never) => unknown }, accountId: number | string) {
  const ctx = {
    req: { headers: { "x-account-id": String(accountId) } },
    res: {},
    user: { id: 1, role: "admin" },
  };
  return router.createCaller(ctx as never);
}

const postsCaller = (id: number | string) =>
  caller(postsRouter, id) as ReturnType<typeof postsRouter.createCaller>;
const manualCaller = (id: number | string) =>
  caller(manualPostRouter, id) as ReturnType<typeof manualPostRouter.createCaller>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(db.listAccounts).mockResolvedValue([SCSU, CREAW]);
  vi.mocked(db.getAccountSettings).mockResolvedValue({
    requireApproval: false, notifyOnError: true, autoFillEvergreen: false,
    recycleRewrite: true, recycleCooldownDays: 30, postsPerDay: 2,
    brandName: null, brandAccent: null,
  });
});

describe("原稿の作成", () => {
  it("新規原稿は選択中アカウントに保存される", async () => {
    vi.mocked(db.createPost).mockResolvedValue(10);
    await postsCaller(2).create({ content: "こんにちは", slotIndex: 0, sortOrder: 0 });
    expect(db.createPost).toHaveBeenCalledWith(expect.objectContaining({ accountId: 2 }));
  });

  it("一括インポートも選択中アカウントに保存される", async () => {
    vi.mocked(db.listPosts).mockResolvedValue([]);
    await postsCaller(1).bulkImport({ lines: ["a", "b"], postsPerDay: 2 });
    const items = vi.mocked(db.bulkCreatePosts).mock.calls[0][0];
    expect(items.every((i) => i.accountId === 1)).toBe(true);
  });

  it("承認フローの判定は選択中アカウントの設定を使う", async () => {
    vi.mocked(db.getAccountSettings).mockResolvedValue({
      requireApproval: true, notifyOnError: true, autoFillEvergreen: false,
      recycleRewrite: true, recycleCooldownDays: 30, postsPerDay: 2,
      brandName: null, brandAccent: null,
    });
    vi.mocked(db.createPost).mockResolvedValue(11);
    await postsCaller(2).create({ content: "x", slotIndex: 0, sortOrder: 0 });
    expect(db.getAccountSettings).toHaveBeenCalledWith(2);
    expect(db.createPost).toHaveBeenCalledWith(expect.objectContaining({ approvalStatus: "draft" }));
  });
});

describe("他アカウントのデータへの操作", () => {
  it("所有していない原稿は更新できない", async () => {
    vi.mocked(db.getOwnedPost).mockResolvedValue(undefined);
    await expect(postsCaller(2).update({ id: 5, content: "書き換え" })).rejects.toThrow(/見つかりません/);
    expect(db.updatePost).not.toHaveBeenCalled();
  });

  it("所有していない原稿は削除できない", async () => {
    vi.mocked(db.getOwnedPost).mockResolvedValue(undefined);
    await expect(postsCaller(2).delete({ id: 5 })).rejects.toThrow(/見つかりません/);
    expect(db.deletePost).not.toHaveBeenCalled();
  });

  it("所有していない原稿は予約日を動かせない", async () => {
    vi.mocked(db.getOwnedPost).mockResolvedValue(undefined);
    await expect(
      postsCaller(2).reschedule({ id: 5, scheduledDate: "2026-09-10", slotIndex: 0 })
    ).rejects.toThrow(/見つかりません/);
    expect(db.updatePost).not.toHaveBeenCalled();
  });

  it("一括削除は所有している原稿だけに絞り込まれる", async () => {
    vi.mocked(db.filterOwnedPostIds).mockResolvedValue([10]);
    const r = await postsCaller(2).bulkDelete({ ids: [10, 999] });
    expect(db.filterOwnedPostIds).toHaveBeenCalledWith([10, 999], { accountId: 2, includeLegacy: false });
    expect(db.deletePostsByIds).toHaveBeenCalledWith([10], { accountId: 2, includeLegacy: false });
    expect(r.count).toBe(1);
  });

  it("移動先が無効なアカウントなら拒否する", async () => {
    vi.mocked(db.getAccountById).mockResolvedValue(account(3, "unknown", "x", false));
    await expect(
      postsCaller(1).bulkAssignAccount({ ids: [1], accountId: 3 })
    ).rejects.toThrow(/移動先のアカウントが不正/);
    expect(db.updatePost).not.toHaveBeenCalled();
  });

  it("移動できるのは自分が所有する原稿だけ", async () => {
    vi.mocked(db.getAccountById).mockResolvedValue(CREAW);
    vi.mocked(db.filterOwnedPostIds).mockResolvedValue([1]);
    const r = await postsCaller(1).bulkAssignAccount({ ids: [1, 777], accountId: 2 });
    expect(db.updatePost).toHaveBeenCalledTimes(1);
    expect(db.updatePost).toHaveBeenCalledWith(1, { accountId: 2 });
    expect(r.count).toBe(1);
  });
});

describe("不正なアカウント指定", () => {
  it("存在しないアカウントIDでは何も読めない", async () => {
    await expect(postsCaller(999).list()).rejects.toThrow(/操作できません/);
  });

  it("数値でないアカウントIDは拒否される", async () => {
    await expect(postsCaller("2; DROP TABLE posts").list()).rejects.toThrow(/不正/);
  });
});

describe("今すぐ投稿", () => {
  it("選択中アカウントのトークンとユーザーIDで投稿する", async () => {
    vi.mocked(db.getOwnedPost).mockResolvedValue(post(7, 2));
    vi.mocked(threadsApi.publishTextPost).mockResolvedValue({
      containerId: "c", postId: "threads-post-1",
    });
    await manualCaller(2).post({ postId: 7 });
    expect(threadsApi.publishTextPost).toHaveBeenCalledWith(
      "token-for-creaw.usa", "39203306012602270", "post-7", null
    );
  });

  it("投稿履歴は投稿したアカウントに記録される", async () => {
    vi.mocked(db.getOwnedPost).mockResolvedValue(post(7, 2));
    vi.mocked(threadsApi.publishTextPost).mockResolvedValue({
      containerId: "c", postId: "threads-post-1",
    });
    await manualCaller(2).post({ postId: 7 });
    expect(db.createPostLog).toHaveBeenCalledWith(expect.objectContaining({ accountId: 2, status: "posted" }));
  });

  it("失敗しても履歴は正しいアカウントに残る", async () => {
    vi.mocked(db.getOwnedPost).mockResolvedValue(post(7, 2));
    vi.mocked(threadsApi.publishTextPost).mockRejectedValue(new Error("Threads API error"));
    await expect(manualCaller(2).post({ postId: 7 })).rejects.toThrow(/Threads API error/);
    expect(db.createPostLog).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: 2, status: "error" })
    );
  });

  it("他アカウントの原稿は投稿できない", async () => {
    vi.mocked(db.getOwnedPost).mockResolvedValue(undefined);
    await expect(manualCaller(2).post({ postId: 7 })).rejects.toThrow(/投稿可能な原稿がありません/);
    expect(threadsApi.publishTextPost).not.toHaveBeenCalled();
  });
});
