/**
 * Threads APIクライアントの純粋関数と、返信送信が通常投稿と同じ2段階フローに
 * `reply_to_id` を足しているだけであることの検証。
 * 実際のThreads APIは呼ばない（fetchをモックする）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeReply, publishReply, publishTextPost } from "./threadsApi";

describe("normalizeReply", () => {
  it("必要な項目を取り出し、root_post からメディアIDを抽出する", () => {
    const r = normalizeReply({
      id: "reply1", text: "ありがとうございます", username: "fan_account",
      permalink: "https://www.threads.net/@fan_account/post/reply1",
      timestamp: "2026-09-04T03:00:00.000Z",
      root_post: { id: "root1" }, hide_status: "NOT_HUSHED",
    });
    expect(r).toEqual({
      id: "reply1", text: "ありがとうございます", username: "fan_account",
      permalink: "https://www.threads.net/@fan_account/post/reply1",
      timestamp: new Date("2026-09-04T03:00:00.000Z"),
      rootMediaId: "root1", hideStatus: "NOT_HUSHED",
    });
  });

  it("id が無ければ null（不正な行は捨てる）", () => {
    expect(normalizeReply({ text: "x" })).toBeNull();
  });

  it("欠けている項目は null で埋め、壊れた日時は落ちない", () => {
    const r = normalizeReply({ id: "reply2", timestamp: "not-a-date" });
    expect(r).toEqual({
      id: "reply2", text: null, username: null, permalink: null,
      timestamp: null, rootMediaId: null, hideStatus: null,
    });
  });
});

describe("publishTextPost / publishReply（2段階フローの共有）", () => {
  let calls: { url: string; body: string }[];

  beforeEach(() => {
    calls = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), body: String(init?.body ?? "") });
      if (String(url).includes("/threads_publish")) {
        return new Response(JSON.stringify({ id: "published-1" }), { status: 200 });
      }
      return new Response(JSON.stringify({ id: "container-1" }), { status: 200 });
    }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("publishTextPost はコンテナ作成→公開の2段階で、画像URLが無ければ reply_to_id を含まない", async () => {
    const r = await publishTextPost("token", "user1", "こんにちは");
    expect(r).toEqual({ containerId: "container-1", postId: "published-1" });
    expect(calls).toHaveLength(2);
    expect(calls[0].url).toContain("/user1/threads");
    expect(calls[0].body).toContain("media_type=TEXT");
    expect(calls[0].body).not.toContain("reply_to_id");
    expect(calls[1].url).toContain("/threads_publish");
    expect(calls[1].body).toContain("creation_id=container-1");
  }, 10_000);

  it("publishReply は同じ2段階フローに reply_to_id を足すだけ", async () => {
    const r = await publishReply("token", "user1", "コメントありがとうございます", "reply-target-1");
    expect(r).toEqual({ containerId: "container-1", postId: "published-1" });
    expect(calls[0].body).toContain("media_type=TEXT");
    expect(calls[0].body).toContain("reply_to_id=reply-target-1");
    expect(calls[0].body).not.toContain("image_url");
  }, 10_000);

  it("コンテナ作成が失敗したら理由つきで例外にする（トークンは含めない）", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response("permission denied", { status: 403 })
    ));
    await expect(publishReply("SECRET-TOKEN", "user1", "x", "reply-1"))
      .rejects.toThrow(/Threads container creation failed \(403\)/);
  });
});
