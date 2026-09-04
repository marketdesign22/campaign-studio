/**
 * 受信箱API。
 *
 * - アカウント単位で完全分離
 * - トークンがレスポンス・エラーに出ない
 * - 手動取得・返信送信は管理者のみ／連打防止
 * - 送信は500文字制限を守り、成功したら「返信済み」にする
 * - 失敗種別は日本語の案内文に変換する（生のThreadsエラーを出さない）
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({
  listAccounts: vi.fn(),
  getOwnedThreadReply: vi.fn(),
  listThreadReplies: vi.fn(),
  markThreadReplyReplied: vi.fn(),
  setThreadReplyStatus: vi.fn(),
  countUnreadThreadReplies: vi.fn(),
}));
vi.mock("./replies", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./replies")>();
  return {
    ...actual,
    fetchRepliesForAccount: vi.fn(),
    sendReply: vi.fn(),
  };
});

import * as db from "./db";
import * as repliesLib from "./replies";

const TOKEN = "THREADS-TOKEN-NEVER-LEAK";
function account(id: number, name: string, lastReplyFetchError: string | null = null) {
  return {
    id, name, threadsUserId: `user-${id}`, threadsAccessToken: TOKEN,
    tokenRefreshedAt: null, tokenExpiresAt: null,
    morningHour: 8, morningMinute: 0, eveningHour: 18, eveningMinute: 0,
    timezone: "JP" as const, slots: null, active: true,
    lastReplyFetchAt: new Date("2026-09-04T03:00:00Z"), lastReplyFetchError,
    createdAt: new Date(), updatedAt: new Date(),
  };
}
const SCSU = account(1, "SCSU.Japan");
const CREAW = account(2, "creaw.usa");

function ctx(accountId = 1, role: "admin" | "user" = "admin") {
  return { req: { headers: { "x-account-id": String(accountId) } }, res: {}, user: { id: 1, role } } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  // repliesRouter は連打防止用の Map をモジュールスコープに持つ。テストごとに
  // 新しいモジュールを読み直し、前のテストの連打状態を持ち越さないようにする
  vi.resetModules();
  vi.mocked(db.listAccounts).mockResolvedValue([SCSU, CREAW] as never);
  vi.mocked(db.listThreadReplies).mockResolvedValue([]);
  vi.mocked(db.countUnreadThreadReplies).mockResolvedValue(0);
});

describe("repliesRouter.list", () => {
  it("選択中アカウントの返信だけを返し、内部専用フィールドは出さない", async () => {
    const { repliesRouter } = await import("./routers/replies");
    vi.mocked(db.listThreadReplies).mockResolvedValue([{
      id: 9, accountId: 1, externalId: "ext-1", rootMediaId: "root-1", rootPermalink: null,
      username: "fan", text: "いいですね", permalink: "https://www.threads.net/@fan/post/ext-1",
      postedAt: new Date(), hideStatus: "NOT_HUSHED", status: "unread", repliedContent: null, repliedAt: null,
      firstSeenAt: new Date(), fetchedAt: new Date(), updatedAt: new Date(),
    }] as never);
    const r = await repliesRouter.createCaller(ctx(1)).list({ status: "all" });
    expect(db.listThreadReplies).toHaveBeenCalledWith(1, { status: undefined, limit: 100 });
    expect(r.replies).toHaveLength(1);
    expect(r.replies[0]).toEqual({
      id: 9, username: "fan", text: "いいですね", permalink: "https://www.threads.net/@fan/post/ext-1",
      postedAt: expect.any(Date), status: "unread", hideStatus: "NOT_HUSHED", repliedContent: null, repliedAt: null,
    });
    expect(JSON.stringify(r)).not.toContain(TOKEN);
    // externalId は返信送信のための内部識別子。permalink とは別物で、画面へは返さない
    expect(r.replies[0]).not.toHaveProperty("externalId");
    expect(r.lastFetchError).toBeNull();
  });

  it("status を渡すとその状態だけに絞る", async () => {
    const { repliesRouter } = await import("./routers/replies");
    await repliesRouter.createCaller(ctx(1)).list({ status: "unread" });
    expect(db.listThreadReplies).toHaveBeenCalledWith(1, { status: ["unread"], limit: 100 });
  });

  it("前回の取得失敗（権限不足など）を一覧に含め、画面で案内できるようにする", async () => {
    vi.mocked(db.listAccounts).mockResolvedValue([account(1, "SCSU.Japan", "permission"), CREAW] as never);
    const { repliesRouter } = await import("./routers/replies");
    const r = await repliesRouter.createCaller(ctx(1)).list({ status: "all" });
    expect(r.lastFetchError).toBe("permission");
  });
});

describe("repliesRouter.markRead", () => {
  it("未読を既読にする", async () => {
    const { repliesRouter } = await import("./routers/replies");
    vi.mocked(db.getOwnedThreadReply).mockResolvedValue({ id: 9, accountId: 1, status: "unread" } as never);
    await repliesRouter.createCaller(ctx(1)).markRead({ id: 9 });
    expect(db.setThreadReplyStatus).toHaveBeenCalledWith(9, 1, "read");
  });

  it("存在しない・他アカウントの返信は見つからないエラーにする", async () => {
    const { repliesRouter } = await import("./routers/replies");
    vi.mocked(db.getOwnedThreadReply).mockResolvedValue(undefined);
    await expect(repliesRouter.createCaller(ctx(2)).markRead({ id: 9 })).rejects.toThrow(/見つかりません/);
    expect(db.setThreadReplyStatus).not.toHaveBeenCalled();
  });

  it("既に既読・返信済みの行は無駄な書き込みをしない", async () => {
    const { repliesRouter } = await import("./routers/replies");
    vi.mocked(db.getOwnedThreadReply).mockResolvedValue({ id: 9, accountId: 1, status: "replied" } as never);
    await repliesRouter.createCaller(ctx(1)).markRead({ id: 9 });
    expect(db.setThreadReplyStatus).not.toHaveBeenCalled();
  });
});

describe("repliesRouter.fetchNow", () => {
  it("管理者のみ実行できる", async () => {
    const { repliesRouter } = await import("./routers/replies");
    await expect(repliesRouter.createCaller(ctx(1, "user")).fetchNow()).rejects.toThrow(/管理者/);
    expect(repliesLib.fetchRepliesForAccount).not.toHaveBeenCalled();
  });

  it("成功したら件数を返し、選択中アカウントで呼ぶ", async () => {
    const { repliesRouter } = await import("./routers/replies");
    vi.mocked(repliesLib.fetchRepliesForAccount).mockResolvedValue({ accountId: 2, fetched: 5, stored: 3, error: null });
    const r = await repliesRouter.createCaller(ctx(2)).fetchNow();
    expect(r).toEqual({ fetched: 5, stored: 3 });
    expect(repliesLib.fetchRepliesForAccount).toHaveBeenCalledWith(expect.objectContaining({ id: 2 }));
  });

  it("失敗種別を日本語の案内文に変換する（生のThreadsエラーを出さない）", async () => {
    const { repliesRouter } = await import("./routers/replies");
    vi.mocked(repliesLib.fetchRepliesForAccount).mockResolvedValue({ accountId: 1, fetched: 0, stored: 0, error: "permission" });
    const err = await repliesRouter.createCaller(ctx(1)).fetchNow().catch((e) => e as Error);
    expect(err.message).toContain("再接続");
    expect(err.message).not.toContain("OAuthException");
  });

  it("連打を防止する", async () => {
    const { repliesRouter } = await import("./routers/replies");
    vi.mocked(repliesLib.fetchRepliesForAccount).mockResolvedValue({ accountId: 1, fetched: 0, stored: 0, error: null });
    const caller = repliesRouter.createCaller(ctx(1));
    await caller.fetchNow();
    await expect(caller.fetchNow()).rejects.toThrow(/待って/);
  });
});

describe("repliesRouter.reply", () => {
  it("送信に成功したら返信済みにする。トークンは送らない", async () => {
    const { repliesRouter } = await import("./routers/replies");
    vi.mocked(db.getOwnedThreadReply).mockResolvedValue({ id: 9, accountId: 1, externalId: "ext-9", status: "unread" } as never);
    vi.mocked(repliesLib.sendReply).mockResolvedValue({ containerId: "c", postId: "p" });
    const r = await repliesRouter.createCaller(ctx(1)).reply({ id: 9, content: "ありがとうございます" });
    expect(r).toEqual({ ok: true });
    expect(repliesLib.sendReply).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }), "ext-9", "ありがとうございます");
    expect(db.markThreadReplyReplied).toHaveBeenCalledWith(9, 1, "ありがとうございます");
  });

  it("500文字を超える内容はサーバーで拒否する", async () => {
    const { repliesRouter } = await import("./routers/replies");
    await expect(repliesRouter.createCaller(ctx(1)).reply({ id: 9, content: "あ".repeat(501) })).rejects.toThrow();
    expect(repliesLib.sendReply).not.toHaveBeenCalled();
  });

  it("他アカウントの返信には送信できない", async () => {
    const { repliesRouter } = await import("./routers/replies");
    vi.mocked(db.getOwnedThreadReply).mockResolvedValue(undefined);
    await expect(repliesRouter.createCaller(ctx(2)).reply({ id: 9, content: "x" })).rejects.toThrow(/見つかりません/);
    expect(repliesLib.sendReply).not.toHaveBeenCalled();
  });

  it("送信失敗は日本語の案内文にし、返信済みにはしない", async () => {
    const { repliesRouter } = await import("./routers/replies");
    vi.mocked(db.getOwnedThreadReply).mockResolvedValue({ id: 9, accountId: 1, externalId: "ext-9", status: "unread" } as never);
    vi.mocked(repliesLib.sendReply).mockRejectedValue(new Error("Threads publish failed (401): OAuthException token=" + TOKEN));
    const err = await repliesRouter.createCaller(ctx(1)).reply({ id: 9, content: "x" }).catch((e) => e as Error);
    expect(err.message).not.toContain(TOKEN);
    expect(err.message).not.toContain("OAuthException");
    expect(db.markThreadReplyReplied).not.toHaveBeenCalled();
  });
});

describe("repliesRouter.unreadCount", () => {
  it("選択中アカウントの未読件数だけを返す", async () => {
    const { repliesRouter } = await import("./routers/replies");
    vi.mocked(db.countUnreadThreadReplies).mockResolvedValue(4);
    expect(await repliesRouter.createCaller(ctx(2)).unreadCount()).toBe(4);
    expect(db.countUnreadThreadReplies).toHaveBeenCalledWith(2);
  });
});
