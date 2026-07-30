import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { invokeLLM } from "../_core/llm";
import { listPostLogs } from "../db";
import { protectedProcedure, router } from "../_core/trpc";

/** LLMの応答からテキストを取り出す（configによりcontentの型が揺れるため） */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractText(result: any): string {
  const content = result?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((c) => (typeof c === "string" ? c : c?.text ?? "")).join("");
  }
  return "";
}

function parseJsonSafely(text: string): unknown {
  // モデルがコードブロックで包む場合に備える
  const stripped = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  return JSON.parse(stripped);
}

/** 直近の成功投稿をスタイル参照として集める */
async function getStyleExamples(limit = 8): Promise<string[]> {
  const logs = await listPostLogs(50);
  return logs
    .filter((l) => l.status === "posted")
    .slice(0, limit)
    .map((l) => l.content);
}

export const aiRouter = router({
  /** ブランドボイスに合わせた下書きを複数案生成する */
  generateDrafts: protectedProcedure
    .input(z.object({
      topic: z.string().min(1).max(300),
      tone: z.enum(["standard", "casual", "formal", "energetic"]).default("standard"),
      count: z.number().int().min(1).max(5).default(3),
      language: z.enum(["ja", "en"]).default("ja"),
    }))
    .mutation(async ({ input }) => {
      const examples = await getStyleExamples();
      const isEn = input.language === "en";
      const toneLabel = isEn
        ? {
            standard: "matching the account's usual tone",
            casual: "friendly and casual",
            formal: "polished and professional",
            energetic: "upbeat and energetic",
          }[input.tone]
        : {
            standard: "これまでの投稿と同じトーン",
            casual: "親しみやすくカジュアルなトーン",
            formal: "丁寧でフォーマルなトーン",
            energetic: "明るく勢いのあるトーン",
          }[input.tone];

      const system = isEn
        ? [
            "You are a professional social media copywriter running an organization's official Threads account.",
            "Strict rules:",
            "- Each post must be in English and at most 500 characters",
            "- At most 2 hashtags",
            "- No exaggeration or false claims; use at most 0-2 emoji per post",
            '- Output JSON only: {"drafts": ["...", ...]}',
            examples.length > 0
              ? `\nMatch the voice and vocabulary of this account's past posts:\n${examples.map((e, i) => `${i + 1}. ${e}`).join("\n")}`
              : "",
          ].join("\n")
        : [
            "あなたは組織の公式Threadsアカウントを運用するプロのSNSコピーライターです。",
            "以下の制約を厳守してください:",
            "- 各投稿は日本語で、500文字以内",
            "- ハッシュタグは多くても2個まで",
            "- 誇張・虚偽・絵文字の乱用をしない（絵文字は1投稿に0〜2個）",
            "- 出力はJSONのみ: {\"drafts\": [\"...\", ...]}",
            examples.length > 0
              ? `\n参考として、このアカウントの過去投稿の文体・語彙に合わせてください:\n${examples.map((e, i) => `${i + 1}. ${e}`).join("\n")}`
              : "",
          ].join("\n");

      const user = isEn
        ? `Topic: ${input.topic}\nTone: ${toneLabel}\nGenerate ${input.count} post drafts as JSON.`
        : `テーマ: ${input.topic}\nトーン: ${toneLabel}\n投稿案を${input.count}案、JSONで出力してください。`;

      try {
        const result = await invokeLLM({
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          responseFormat: { type: "json_object" },
          maxTokens: 2000,
        });
        const parsed = parseJsonSafely(extractText(result)) as { drafts?: unknown };
        const drafts = Array.isArray(parsed.drafts)
          ? parsed.drafts.filter((d): d is string => typeof d === "string" && d.trim().length > 0)
              .map((d) => d.slice(0, 500))
          : [];
        if (drafts.length === 0) throw new Error("empty drafts");
        return { drafts };
      } catch (e) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `AI生成に失敗しました: ${e instanceof Error ? e.message : String(e)}`,
        });
      }
    }),

  /** 既存の下書きを指示に従ってリライトする */
  rewrite: protectedProcedure
    .input(z.object({
      content: z.string().min(1).max(2000),
      instruction: z.string().min(1).max(300),
    }))
    .mutation(async ({ input }) => {
      try {
        const result = await invokeLLM({
          messages: [
            {
              role: "system",
              content:
                "あなたは公式SNSアカウントの編集者です。渡された投稿文を指示に従って書き直し、" +
                "書き直した本文のみを出力してください（前置き・説明・引用符は不要）。500文字以内。" +
                "指示がない限り、元の投稿と同じ言語で書き直すこと。" +
                " / You are an editor for an official social account. Rewrite the given post per the instruction and output only the rewritten text (max 500 chars). Keep the post's original language unless instructed otherwise.",
            },
            { role: "user", content: `投稿文:\n${input.content}\n\n指示: ${input.instruction}` },
          ],
          maxTokens: 1200,
        });
        const text = extractText(result).trim().slice(0, 500);
        if (!text) throw new Error("empty result");
        return { content: text };
      } catch (e) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `AIリライトに失敗しました: ${e instanceof Error ? e.message : String(e)}`,
        });
      }
    }),
});
