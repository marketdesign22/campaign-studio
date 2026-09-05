/**
 * エンゲージメントAPI（トレンドで収集した他アカウントの投稿へのコメント）。
 *
 * - 対象はこのアカウントが収集済みのトレンド投稿に限る（他アカウントの投稿は選べない）
 * - AIは案を1つ返すだけで、実際にThreadsへ送るのは send を呼んだ時だけ
 * - 送信は連打防止・500文字制限を守る。生のThreadsエラーやAPIキーは返さない
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({
  listAccounts: vi.fn(),
  getOwnedTrendPost: vi.fn(),
  listPostLogs: vi.fn(),
  createEngagementComment: vi.fn(),
  listEngagementComments: vi.fn(),
  countEngagementCommentsForTarget: vi.fn(),
}));
vi.mock("./engagement", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./engagement")>();
  return { ...actual, listPostReplies: vi.fn(), sendEngagementComment: vi.fn() };
});
vi.mock("./_core/llm", () => ({ invokeLLM: vi.fn() }));

import * as db from "./db";
import * as engagementLib from "./engagement";
import * as llm from "./_core/llm";

const TOKEN = "THREADS-TOKEN-NEVER-LEAK";
const SECRET = "sk-proj-NEVER-LEAK";

function account(id: number, name: string) {
  return {
    id, name, threadsUserId: `user-${id}`, threadsAccessToken: TOKEN,
    tokenRefreshedAt: null, tokenExpiresAt: null,
    morningHour: 8, morningMinute: 0, eveningHour: 18, eveningMinute: 0,
    timezone: "JP" as const, slots: null, active: true,
    lastReplyFetchAt: null, lastReplyFetchError: null, threadsUsername: null as string | null,
    createdAt: new Date(), updatedAt: new Date(),
  };
}
const SCSU = account(1, "SCSU.Japan");
const CREAW = account(2, "creaw.usa");

function ctx(accountId = 1, role: "admin" | "user" = "admin") {
  return { req: { headers: { "x-account-id": String(accountId) } }, res: {}, user: { id: 1, role } } as never;
}

function trendPost(id: number, extra: Record<string, unknown> = {}) {
  return {
    id, accountId: 1, platform: "threads", source: "keyword", keyword: "留学",
    externalId: `ext-${id}`, permalink: `https://www.threads.net/@other/post/ext-${id}`,
    username: "other_user", postedAt: new Date(), mediaType: "TEXT",
    summary: "留学準備の話題", hasReplies: true,
    likes: null, replies: null, reposts: null, views: null, saves: null,
    score: 70, scoreBreakdown: "[]", isRising: false, status: "active",
    aiReason: null, aiIdeas: null,
    firstSeenAt: new Date(), fetchedAt: new Date(), updatedAt: new Date(),
    ...extra,
  };
}

function llmReply(content: string) {
  return {
    id: "msg_1", model: "gpt-5.6-terra",
    choices: [{ index: 0, message: { role: "assistant" as const, content }, finish_reason: "end_turn" }],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  delete process.env.OPENAI_API_KEY;
  vi.mocked(db.listAccounts).mockResolvedValue([SCSU, CREAW] as never);
  vi.mocked(db.listPostLogs).mockResolvedValue([] as never);
  vi.mocked(db.listEngagementComments).mockResolvedValue([] as never);
  vi.mocked(db.countEngagementCommentsForTarget).mockResolvedValue(0);
});

describe("engagementRouter.listReplies", () => {
  it("選択中アカウントのトレンド投稿以外は見られない", async () => {
    vi.mocked(db.getOwnedTrendPost).mockResolvedValue(undefined);
    const { engagementRouter } = await import("./routers/engagement");
    await expect(engagementRouter.createCaller(ctx(2)).listReplies({ trendPostId: 1 }))
      .rejects.toThrow(/見つかりません/);
  });

  it("取得できれば返信の一覧を返す", async () => {
    vi.mocked(db.getOwnedTrendPost).mockResolvedValue(trendPost(1) as never);
    vi.mocked(engagementLib.listPostReplies).mockResolvedValue({
      items: [{ id: "r1", text: "私も気になります", username: "fan", permalink: null, timestamp: null, rootMediaId: null, hideStatus: null }],
      error: null,
    });
    const { engagementRouter } = await import("./routers/engagement");
    const r = await engagementRouter.createCaller(ctx(1)).listReplies({ trendPostId: 1 });
    expect(r.available).toBe(true);
    expect(r.replies).toEqual([{ id: "r1", username: "fan", text: "私も気になります", permalink: null, postedAt: null }]);
  });

  it("他アカウントの投稿で権限エラーになった場合は available:false と案内文を返す（例外にしない）", async () => {
    vi.mocked(db.getOwnedTrendPost).mockResolvedValue(trendPost(1) as never);
    vi.mocked(engagementLib.listPostReplies).mockResolvedValue({ items: [], error: "permission" });
    const { engagementRouter } = await import("./routers/engagement");
    const r = await engagementRouter.createCaller(ctx(1)).listReplies({ trendPostId: 1 });
    expect(r.available).toBe(false);
    expect(r.errorMessage).toContain("再接続");
    expect(r.replies).toEqual([]);
  });
});

describe("engagementRouter.suggestComment", () => {
  it("AI未設定ならエラーにする", async () => {
    vi.mocked(db.getOwnedTrendPost).mockResolvedValue(trendPost(1) as never);
    const { engagementRouter } = await import("./routers/engagement");
    await expect(engagementRouter.createCaller(ctx(1)).suggestComment({ trendPostId: 1, targetType: "post" }))
      .rejects.toThrow(/OPENAI_API_KEY/);
    expect(llm.invokeLLM).not.toHaveBeenCalled();
  });

  it("投稿本体を対象に1件だけコメント案を作る。APIキーは送らない", async () => {
    process.env.OPENAI_API_KEY = SECRET;
    vi.mocked(db.getOwnedTrendPost).mockResolvedValue(trendPost(1) as never);
    vi.mocked(llm.invokeLLM).mockResolvedValue(llmReply(JSON.stringify({ comment: "私も同じ経験があります！" })) as never);
    const { engagementRouter } = await import("./routers/engagement");
    const r = await engagementRouter.createCaller(ctx(1)).suggestComment({ trendPostId: 1, targetType: "post" });
    expect(r).toEqual({ comment: "私も同じ経験があります！" });
    const sent = JSON.stringify(vi.mocked(llm.invokeLLM).mock.calls[0][0]);
    expect(sent).not.toContain(SECRET);
    expect(sent).toContain("留学準備の話題");
  });

  it("返信を対象にする場合は本文を渡す。無ければ拒否する", async () => {
    process.env.OPENAI_API_KEY = SECRET;
    vi.mocked(db.getOwnedTrendPost).mockResolvedValue(trendPost(1) as never);
    const { engagementRouter } = await import("./routers/engagement");
    await expect(engagementRouter.createCaller(ctx(1)).suggestComment({ trendPostId: 1, targetType: "reply" }))
      .rejects.toThrow();
    expect(llm.invokeLLM).not.toHaveBeenCalled();

    vi.mocked(llm.invokeLLM).mockResolvedValue(llmReply(JSON.stringify({ comment: "わかります" })) as never);
    const r = await engagementRouter.createCaller(ctx(1))
      .suggestComment({ trendPostId: 1, targetType: "reply", replyText: "私も悩んでいます", replyUsername: "fan" });
    expect(r).toEqual({ comment: "わかります" });
    const sent = JSON.stringify(vi.mocked(llm.invokeLLM).mock.calls[0][0]);
    expect(sent).toContain("私も悩んでいます");
  });

  it("500文字を超える出力は切り詰める", async () => {
    process.env.OPENAI_API_KEY = SECRET;
    vi.mocked(db.getOwnedTrendPost).mockResolvedValue(trendPost(1) as never);
    vi.mocked(llm.invokeLLM).mockResolvedValue(llmReply(JSON.stringify({ comment: "あ".repeat(700) })) as never);
    const { engagementRouter } = await import("./routers/engagement");
    const r = await engagementRouter.createCaller(ctx(1)).suggestComment({ trendPostId: 1, targetType: "post" });
    expect(Array.from(r.comment).length).toBe(500);
  });

  it("他アカウントの投稿は対象にできない", async () => {
    process.env.OPENAI_API_KEY = SECRET;
    vi.mocked(db.getOwnedTrendPost).mockResolvedValue(undefined);
    const { engagementRouter } = await import("./routers/engagement");
    await expect(engagementRouter.createCaller(ctx(2)).suggestComment({ trendPostId: 1, targetType: "post" }))
      .rejects.toThrow(/見つかりません/);
    expect(llm.invokeLLM).not.toHaveBeenCalled();
  });
});

describe("engagementRouter.send", () => {
  it("送信に成功したら履歴に記録する。トークンは送らない", async () => {
    vi.mocked(db.getOwnedTrendPost).mockResolvedValue(trendPost(1) as never);
    vi.mocked(engagementLib.sendEngagementComment).mockResolvedValue({ containerId: "c", postId: "p1" });
    const { engagementRouter } = await import("./routers/engagement");
    const r = await engagementRouter.createCaller(ctx(1))
      .send({ trendPostId: 1, targetType: "post", content: "素敵な投稿ですね" });
    expect(r).toEqual({ ok: true });
    expect(engagementLib.sendEngagementComment).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }), "ext-1", "素敵な投稿ですね");
    expect(db.createEngagementComment).toHaveBeenCalledWith(expect.objectContaining({
      accountId: 1, targetExternalId: "ext-1", targetType: "post", trendPostId: 1,
      content: "素敵な投稿ですね", threadsCommentId: "p1",
      targetUsername: "other_user", targetPermalink: "https://www.threads.net/@other/post/ext-1", targetSummary: "留学準備の話題",
    }));
    expect(JSON.stringify(r)).not.toContain(TOKEN);
  });

  it("対象トレンド投稿が他アカウントのものだと送信できない", async () => {
    vi.mocked(db.getOwnedTrendPost).mockResolvedValue(undefined);
    const { engagementRouter } = await import("./routers/engagement");
    await expect(engagementRouter.createCaller(ctx(2))
      .send({ trendPostId: 1, targetType: "post", content: "x" }))
      .rejects.toThrow(/見つかりません/);
    expect(engagementLib.sendEngagementComment).not.toHaveBeenCalled();
  });

  it("連打を防止する", async () => {
    vi.mocked(db.getOwnedTrendPost).mockResolvedValue(trendPost(1) as never);
    vi.mocked(engagementLib.sendEngagementComment).mockResolvedValue({ containerId: "c", postId: "p1" });
    const { engagementRouter } = await import("./routers/engagement");
    const caller = engagementRouter.createCaller(ctx(1));
    await caller.send({ trendPostId: 1, targetType: "post", content: "x" });
    await expect(caller.send({ trendPostId: 1, targetType: "post", content: "y" }))
      .rejects.toThrow(/間隔/);
  });

  it("送信失敗は日本語の案内文にし、履歴には残さない", async () => {
    vi.mocked(db.getOwnedTrendPost).mockResolvedValue(trendPost(1) as never);
    vi.mocked(engagementLib.sendEngagementComment).mockRejectedValue(
      new Error("Threads publish failed (401): OAuthException token=" + TOKEN)
    );
    const { engagementRouter } = await import("./routers/engagement");
    const err = await engagementRouter.createCaller(ctx(1))
      .send({ trendPostId: 1, targetType: "post", content: "x" }).catch((e) => e as Error);
    expect(err.message).not.toContain(TOKEN);
    expect(db.createEngagementComment).not.toHaveBeenCalled();
  });

  it("返信を対象にした場合は渡されたユーザー名・要約を記録する", async () => {
    vi.mocked(db.getOwnedTrendPost).mockResolvedValue(trendPost(1) as never);
    vi.mocked(engagementLib.sendEngagementComment).mockResolvedValue({ containerId: "c", postId: "p2" });
    const { engagementRouter } = await import("./routers/engagement");
    await engagementRouter.createCaller(ctx(1)).send({
      trendPostId: 1, targetType: "reply", targetExternalId: "reply-9",
      targetUsername: "fan", targetSummary: "私も悩んでいます", content: "わかります",
    });
    expect(db.createEngagementComment).toHaveBeenCalledWith(expect.objectContaining({
      targetType: "reply", targetExternalId: "reply-9", targetUsername: "fan", targetSummary: "私も悩んでいます",
    }));
  });
});

describe("engagementRouter.countForTarget / history", () => {
  it("対象への送信済み件数を返す（投稿のメディアIDはサーバー側で解決する）", async () => {
    vi.mocked(db.getOwnedTrendPost).mockResolvedValue(trendPost(1) as never);
    vi.mocked(db.countEngagementCommentsForTarget).mockResolvedValue(2);
    const { engagementRouter } = await import("./routers/engagement");
    expect(await engagementRouter.createCaller(ctx(1)).countForTarget({ trendPostId: 1 })).toBe(2);
    expect(db.countEngagementCommentsForTarget).toHaveBeenCalledWith(1, "ext-1");
  });

  it("他アカウントの投稿は件数を確認できない", async () => {
    vi.mocked(db.getOwnedTrendPost).mockResolvedValue(undefined);
    const { engagementRouter } = await import("./routers/engagement");
    await expect(engagementRouter.createCaller(ctx(2)).countForTarget({ trendPostId: 1 })).rejects.toThrow(/見つかりません/);
  });

  it("選択中アカウントの送信履歴だけを返す", async () => {
    const { engagementRouter } = await import("./routers/engagement");
    await engagementRouter.createCaller(ctx(2)).history();
    expect(db.listEngagementComments).toHaveBeenCalledWith(2, 50);
  });
});
