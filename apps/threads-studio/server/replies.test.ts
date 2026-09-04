/**
 * 受信箱（返信管理）の検証。Threads API と DB はモックする。
 *
 * - アカウントごとに分離され、1件の失敗が他を止めない
 * - 反応が取れなくても失敗しても既存データは消えない
 * - 認証・権限・レート制限を区別する
 * - 返信送信は500文字制限を守り、Threadsへ1回だけ送る
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Account } from "../drizzle/schema";

vi.mock("./db", () => ({
  upsertThreadReply: vi.fn(),
  updateAccount: vi.fn(),
}));
vi.mock("./threadsApi", () => ({
  fetchAccountReplies: vi.fn(),
  publishReply: vi.fn(),
}));

import * as db from "./db";
import * as api from "./threadsApi";
import {
  fetchRepliesForAccount, fetchRepliesForAccounts, MAX_REPLY_LENGTH, sendReply, worstReplyError,
} from "./replies";
import { _test } from "./threadsRetry";

const TOKEN_A = "TOKEN-FOR-SCSU-NEVER-LEAK";
const TOKEN_B = "TOKEN-FOR-CREAW-NEVER-LEAK";

function account(id: number, name: string, token: string): Account {
  return {
    id, name, threadsUserId: `user-${id}`, threadsAccessToken: token,
    tokenRefreshedAt: null, tokenExpiresAt: null,
    morningHour: 8, morningMinute: 0, eveningHour: 18, eveningMinute: 0,
    timezone: "JP", slots: null, active: true,
    lastReplyFetchAt: null, lastReplyFetchError: null,
    createdAt: new Date("2026-01-01T00:00:00Z"), updatedAt: new Date("2026-01-01T00:00:00Z"),
  } as Account;
}
const SCSU = account(1, "SCSU.Japan", TOKEN_A);
const CREAW = account(2, "creaw.usa", TOKEN_B);
const NOW = new Date("2026-09-04T03:00:00Z");

function reply(id: string, extra: Partial<api.ThreadsReply> = {}): api.ThreadsReply {
  return {
    id, text: `返信 ${id}`, username: "fan", permalink: `https://www.threads.net/@fan/post/${id}`,
    timestamp: NOW, rootMediaId: "root-1", hideStatus: "NOT_HUSHED", ...extra,
  };
}

const sleeps: number[] = [];
beforeEach(() => {
  vi.clearAllMocks();
  sleeps.length = 0;
  _test.sleep = async (ms) => { sleeps.push(ms); };
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.mocked(db.upsertThreadReply).mockResolvedValue(undefined);
  vi.mocked(db.updateAccount).mockResolvedValue(undefined);
});

describe("fetchRepliesForAccount", () => {
  it("取得した返信を保存し、自アカウントのトークンだけで検索する", async () => {
    vi.mocked(api.fetchAccountReplies).mockResolvedValue([reply("a"), reply("b")]);
    const r = await fetchRepliesForAccount(CREAW, NOW);
    expect(r).toEqual({ accountId: 2, fetched: 2, stored: 2, error: null });
    expect(api.fetchAccountReplies).toHaveBeenCalledWith(TOKEN_B, "user-2", expect.any(Number));
    expect(db.upsertThreadReply).toHaveBeenCalledTimes(2);
    const row = vi.mocked(db.upsertThreadReply).mock.calls[0][0];
    expect(row.accountId).toBe(2);
    expect(row.text).toBe("返信 a");
    expect(db.updateAccount).toHaveBeenCalledWith(2, { lastReplyFetchAt: NOW, lastReplyFetchError: null });
  });

  it("本文の無い返信（画像のみ等）は保存しない", async () => {
    vi.mocked(api.fetchAccountReplies).mockResolvedValue([reply("a", { text: null }), reply("b")]);
    const r = await fetchRepliesForAccount(SCSU, NOW);
    expect(r.fetched).toBe(2);
    expect(r.stored).toBe(1);
    expect(db.upsertThreadReply).toHaveBeenCalledTimes(1);
  });

  it("失敗しても既存データを消さず、失敗種別を返してアカウント行に記録する（トークンは残さない）", async () => {
    vi.mocked(api.fetchAccountReplies).mockRejectedValue(new Error("Threads replies fetch failed (401): OAuthException token=SECRET"));
    const r = await fetchRepliesForAccount(SCSU, NOW);
    expect(r).toEqual({ accountId: 1, fetched: 0, stored: 0, error: "auth" });
    expect(db.upsertThreadReply).not.toHaveBeenCalled();
    expect(db.updateAccount).toHaveBeenCalledWith(1, { lastReplyFetchAt: NOW, lastReplyFetchError: "auth" });
    const logged = vi.mocked(console.warn).mock.calls.flat().join(" ");
    expect(logged).not.toContain("SECRET");
    expect(logged).toContain("auth");
  });

  it("レート制限は間を空けて1回だけ再試行する", async () => {
    vi.mocked(api.fetchAccountReplies)
      .mockRejectedValueOnce(new Error("Threads replies fetch failed (429): rate limit"))
      .mockResolvedValueOnce([reply("a")]);
    const r = await fetchRepliesForAccount(SCSU, NOW);
    expect(r.error).toBeNull();
    expect(r.stored).toBe(1);
    expect(sleeps).toEqual([5000]);
  });

  it("権限不足は再試行しない", async () => {
    vi.mocked(api.fetchAccountReplies).mockRejectedValue(new Error("Threads replies fetch failed (403): requires threads_manage_replies"));
    const r = await fetchRepliesForAccount(SCSU, NOW);
    expect(r.error).toBe("permission");
    expect(api.fetchAccountReplies).toHaveBeenCalledTimes(1);
    expect(sleeps).toEqual([]);
  });

  it("成功時のアカウント行の書き込みが失敗しても、取得結果自体は成功のまま返す", async () => {
    vi.mocked(api.fetchAccountReplies).mockResolvedValue([reply("a")]);
    vi.mocked(db.updateAccount).mockRejectedValue(new Error("db write failed"));
    const r = await fetchRepliesForAccount(SCSU, NOW);
    expect(r).toEqual({ accountId: 1, fetched: 1, stored: 1, error: null });
  });
});

describe("fetchRepliesForAccounts", () => {
  it("1アカウントの失敗が他アカウントを止めない", async () => {
    vi.mocked(api.fetchAccountReplies)
      .mockRejectedValueOnce(new Error("Threads replies fetch failed (401): OAuthException"))
      .mockResolvedValueOnce([reply("z")]);
    const out = await fetchRepliesForAccounts([SCSU, CREAW], NOW);
    expect(out.map((r) => r.accountId)).toEqual([1, 2]);
    expect(out[0].error).toBe("auth");
    expect(out[1].error).toBeNull();
    expect(out[1].stored).toBe(1);
  });

  it("worstReplyError は複数アカウントの失敗から対処すべきものを1つ選ぶ", async () => {
    vi.mocked(api.fetchAccountReplies)
      .mockRejectedValueOnce(new Error("Threads replies fetch failed (429): rate limit"))
      .mockRejectedValueOnce(new Error("Threads replies fetch failed (403): requires threads_manage_replies"));
    const out = await fetchRepliesForAccounts([SCSU, CREAW], NOW);
    expect(worstReplyError(out)).toBe("permission");
  });
});

describe("sendReply", () => {
  it("空の内容は送信しない", async () => {
    await expect(sendReply(SCSU, "reply-1", "   ")).rejects.toThrow(/empty/);
    expect(api.publishReply).not.toHaveBeenCalled();
  });

  it(`${MAX_REPLY_LENGTH}文字を超える内容は送信しない`, async () => {
    await expect(sendReply(SCSU, "reply-1", "あ".repeat(MAX_REPLY_LENGTH + 1))).rejects.toThrow(/too long/);
    expect(api.publishReply).not.toHaveBeenCalled();
  });

  it("トリムしたうえで、自アカウントのトークンで1回だけ送信する", async () => {
    vi.mocked(api.publishReply).mockResolvedValue({ containerId: "c", postId: "p" });
    const r = await sendReply(CREAW, "reply-1", "  ありがとうございます  ");
    expect(r).toEqual({ containerId: "c", postId: "p" });
    expect(api.publishReply).toHaveBeenCalledTimes(1);
    expect(api.publishReply).toHaveBeenCalledWith(TOKEN_B, "user-2", "ありがとうございます", "reply-1");
  });
});
