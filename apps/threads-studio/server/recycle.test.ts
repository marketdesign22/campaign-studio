import { describe, expect, it, vi } from "vitest";

/**
 * 再投稿（evergreen）まわりの要点だけを固定するテスト。
 * DBに触れずに済むよう、rewordForRecycle が使う LLM を差し替える。
 */
vi.mock("./_core/llm", () => ({
  invokeLLM: vi.fn(),
}));

import { invokeLLM } from "./_core/llm";
import { rewordForRecycle } from "./scheduler";

const mocked = vi.mocked(invokeLLM);

function llmReply(text: string) {
  return {
    id: "msg_test",
    model: "test",
    choices: [{ index: 0, message: { role: "assistant" as const, content: text }, finish_reason: "end_turn" }],
  };
}

describe("rewordForRecycle", () => {
  it("uses the rewritten text when the model returns a valid variant", async () => {
    mocked.mockResolvedValueOnce(llmReply("  今日はオープンキャンパスです✨  "));
    expect(await rewordForRecycle("本日オープンキャンパスを開催します。")).toBe(
      "今日はオープンキャンパスです✨"
    );
  });

  it("falls back to the original when the API is unavailable", async () => {
    mocked.mockRejectedValueOnce(new Error("ANTHROPIC_API_KEY is not configured"));
    const original = "本日オープンキャンパスを開催します。";
    expect(await rewordForRecycle(original)).toBe(original);
  });

  it("falls back to the original on empty or over-long output", async () => {
    const original = "本日オープンキャンパスを開催します。";
    mocked.mockResolvedValueOnce(llmReply("   "));
    expect(await rewordForRecycle(original)).toBe(original);
    mocked.mockResolvedValueOnce(llmReply("あ".repeat(501)));
    expect(await rewordForRecycle(original)).toBe(original);
  });
});
