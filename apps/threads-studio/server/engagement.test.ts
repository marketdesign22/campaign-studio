/**
 * エンゲージメント（他アカウントの投稿へのコメント）の検証。Threads APIはモックする。
 *
 * - 返信一覧の取得は失敗しても例外を投げず、エラー種別を返す（呼び出し側でフォールバックできるように）
 * - コメント送信は500文字制限を守り、Threadsへ1回だけ送る
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Account } from "../drizzle/schema";

vi.mock("./threadsApi", () => ({
  fetchPostReplies: vi.fn(),
  publishReply: vi.fn(),
}));

import * as api from "./threadsApi";
import { listPostReplies, MAX_COMMENT_LENGTH, sendEngagementComment } from "./engagement";

const TOKEN = "TOKEN-NEVER-LEAK";
function account(id: number, name: string): Account {
  return {
    id, name, threadsUserId: `user-${id}`, threadsAccessToken: TOKEN,
    tokenRefreshedAt: null, tokenExpiresAt: null,
    morningHour: 8, morningMinute: 0, eveningHour: 18, eveningMinute: 0,
    timezone: "JP", slots: null, active: true,
    lastReplyFetchAt: null, lastReplyFetchError: null, threadsUsername: null as string | null,
    createdAt: new Date("2026-01-01T00:00:00Z"), updatedAt: new Date("2026-01-01T00:00:00Z"),
  } as Account;
}
const SCSU = account(1, "SCSU.Japan");

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

function reply(id: string, extra: Partial<api.ThreadsReply> = {}): api.ThreadsReply {
  return {
    id, text: `コメント ${id}`, username: "fan", permalink: `https://www.threads.net/@fan/post/${id}`,
    timestamp: new Date(), rootMediaId: "root-1", hideStatus: "NOT_HUSHED", ...extra,
  };
}

describe("listPostReplies", () => {
  it("取得できた返信のうち本文があるものだけを返す", async () => {
    vi.mocked(api.fetchPostReplies).mockResolvedValue([reply("a"), reply("b", { text: null })]);
    const r = await listPostReplies(SCSU, "post-1");
    expect(r.error).toBeNull();
    expect(r.items).toHaveLength(1);
    expect(api.fetchPostReplies).toHaveBeenCalledWith(TOKEN, "post-1", expect.any(Number));
  });

  it("他アカウントの投稿で権限エラーになっても例外を投げず、種別だけ返す（トークンは残さない）", async () => {
    vi.mocked(api.fetchPostReplies).mockRejectedValue(
      new Error("Threads post replies fetch failed (403): OAuthException token=" + TOKEN)
    );
    const r = await listPostReplies(SCSU, "post-1");
    expect(r).toEqual({ items: [], error: "permission" });
    const logged = vi.mocked(console.warn).mock.calls.flat().join(" ");
    expect(logged).not.toContain(TOKEN);
    expect(logged).toContain("permission");
  });

  it("通信エラーは network として返す", async () => {
    vi.mocked(api.fetchPostReplies).mockRejectedValue(new Error("fetch failed: ECONNRESET"));
    const r = await listPostReplies(SCSU, "post-1");
    expect(r.error).toBe("network");
  });
});

describe("sendEngagementComment", () => {
  it("空の内容は送信しない", async () => {
    await expect(sendEngagementComment(SCSU, "target-1", "   ")).rejects.toThrow(/empty/);
    expect(api.publishReply).not.toHaveBeenCalled();
  });

  it(`${MAX_COMMENT_LENGTH}文字を超える内容は送信しない`, async () => {
    await expect(sendEngagementComment(SCSU, "target-1", "あ".repeat(MAX_COMMENT_LENGTH + 1))).rejects.toThrow(/too long/);
    expect(api.publishReply).not.toHaveBeenCalled();
  });

  it("トリムしたうえで、自アカウントのトークンで1回だけ送信する", async () => {
    vi.mocked(api.publishReply).mockResolvedValue({ containerId: "c", postId: "p" });
    const r = await sendEngagementComment(SCSU, "target-1", "  素敵な投稿ですね  ");
    expect(r).toEqual({ containerId: "c", postId: "p" });
    expect(api.publishReply).toHaveBeenCalledTimes(1);
    expect(api.publishReply).toHaveBeenCalledWith(TOKEN, "user-1", "素敵な投稿ですね", "target-1");
  });
});
