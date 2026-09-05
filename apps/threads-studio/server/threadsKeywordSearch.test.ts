import { afterEach, describe, expect, it, vi } from "vitest";
import { searchThreadsKeyword } from "./threadsApi";

const item = (id: string) => ({
  id,
  text: `post ${id}`,
  permalink: `https://www.threads.net/@user/post/${id}`,
  timestamp: "2026-09-04T00:00:00Z",
  username: "user",
});

afterEach(() => vi.unstubAllGlobals());

describe("searchThreadsKeyword", () => {
  it("ページングを追い、ページ間の重複を除く", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: [item("a"), item("b")],
        paging: { next: "https://graph.threads.net/v1.0/keyword_search?after=cursor" },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [item("b"), item("c")] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await searchThreadsKeyword("secret", "study abroad", "TOP");
    expect(result.map((post) => post.id)).toEqual(["a", "b", "c"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("不正なページ送りURLへアクセストークンを送らない", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({
      data: [item("a")], paging: { next: "https://attacker.example/steal" },
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(searchThreadsKeyword("secret", "study", "RECENT")).rejects.toThrow(/unsafe paging URL/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("壊れた応答を空の検索結果として扱わない", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: {} }), { status: 200 })));
    await expect(searchThreadsKeyword("secret", "study", "TOP")).rejects.toThrow(/invalid response/);
  });

  it("応答本文をエラーへ無制限に含めない", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("x".repeat(2_000), { status: 503 })));
    const error = await searchThreadsKeyword("secret", "study", "TOP").catch((value: unknown) => value);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message.length).toBeLessThan(600);
  });
});
