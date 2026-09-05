/**
 * エンゲージメントAPI（トレンドで収集した他アカウントの投稿へのコメント）。
 *
 * - すべて accountProcedure。対象はこのアカウントが収集済みのトレンド投稿に限る
 * - Threads APIやAIの生レスポンス、トークンは返さない
 * - AIによる下書きは「案」を1つ返すだけ。実際にThreadsへ送るのは `send` を呼んだ時だけ
 * - 送信には回数制限を掛ける（誤送信・連投の防止）
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createEngagementComment, countEngagementCommentsForTarget, getOwnedTrendPost, listEngagementComments, listPostLogs } from "../db";
import { listPostReplies, MAX_COMMENT_LENGTH, sendEngagementComment } from "../engagement";
import { classifyError, type ThreadsErrorKind } from "../threadsErrors";
import { invokeLLM } from "../_core/llm";
import { AI_GUARDRAILS, aiError, createRateLimiter, parseJsonLoose } from "../aiSupport";
import { ENV } from "../_core/env";
import { accountProcedure } from "../accountScope";
import type { AccountScope } from "../accountScope";
import { router } from "../_core/trpc";

/** 送信の連打防止（誤送信対策も兼ねる） */
const SEND_COOLDOWN_MS = 3_000;
const lastSend = new Map<number, number>();

/** AI下書きは1ユーザーあたり1分間に10回まで */
const takeAiCall = createRateLimiter(10, 60_000);

/** 失敗種別ごとの案内。専門用語だけで終わらせず、次に何をすればよいかを書く */
const ERROR_MESSAGE: Record<ThreadsErrorKind, string> = {
  auth: "Threadsの認証が切れています。設定画面の「アカウントを追加」から同じ表示名で連携リンクを発行し、このアカウントで再接続してください。",
  permission: "コメントの送信・閲覧の権限がありません。設定画面の「アカウントを追加」から同じ表示名で連携リンクを発行し、このアカウントで再接続すると付与されます。",
  rate_limited: "Threadsの利用制限に達しました。しばらく待ってからお試しください。",
  network: "Threadsに接続できませんでした。しばらくしてからもう一度お試しください。",
  unknown: "処理に失敗しました。時間をおいて再度お試しください。続く場合は担当者にご連絡ください。",
};

/**
 * 直近の成功投稿をスタイル参照として集める（routers/ai.ts の getStyleExamples と同じ考え方）。
 * 参照するのは選択中アカウントの投稿だけ（他クライアントの文面を学習させない）。
 */
async function getStyleExamples(scope: AccountScope, limit = 8): Promise<string[]> {
  const logs = await listPostLogs(50, scope);
  return logs.filter((l) => l.status === "posted").slice(0, limit).map((l) => l.content);
}

export const engagementRouter = router({
  /**
   * 対象投稿についた返信の一覧。「返信への返信」を選ぶために使う。
   * 他アカウントの投稿では権限上どうしても取得できない場合があり、その時は
   * available:false を返す（画面側は投稿本体へのコメントにフォールバックする）。
   */
  listReplies: accountProcedure
    .input(z.object({ trendPostId: z.number().int() }))
    .query(async ({ input, ctx }) => {
      const row = await getOwnedTrendPost(input.trendPostId, ctx.account.id);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "対象の投稿が見つかりません。" });
      const { items, error } = await listPostReplies(ctx.account, row.externalId);
      return {
        available: error === null,
        errorMessage: error ? ERROR_MESSAGE[error] : null,
        replies: items.map((r) => ({
          id: r.id, username: r.username, text: r.text, permalink: r.permalink, postedAt: r.timestamp,
        })),
      };
    }),

  /**
   * AIによるコメント案の生成。返すのは1件の案のみで、原稿への反映（送信）は
   * 画面側で利用者が編集・送信ボタンを押した時に別途行う。
   */
  suggestComment: accountProcedure
    .input(z.object({
      trendPostId: z.number().int(),
      targetType: z.enum(["post", "reply"]).default("post"),
      /** targetType が reply のときの対象コメント本文（要約ではなく実文。AIへの一時的な入力にのみ使う） */
      replyText: z.string().max(600).optional(),
      replyUsername: z.string().max(64).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      if (!ENV.openaiApiKey) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "AI設定が必要です。OPENAI_API_KEY を設定してください。" });
      }
      if (!takeAiCall(String(ctx.user.id))) {
        throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "AIの利用が集中しています。しばらく待ってからお試しください。" });
      }
      const row = await getOwnedTrendPost(input.trendPostId, ctx.account.id);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "対象の投稿が見つかりません。" });
      if (input.targetType === "reply" && !input.replyText?.trim()) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "コメント対象の本文がありません。" });
      }

      const examples = await getStyleExamples(ctx.scope);
      const targetBlock = input.targetType === "reply"
        ? `対象は投稿本体ではなく、その投稿についた返信（@${input.replyUsername ?? "unknown"}）です:\n${input.replyText}`
        : `対象の投稿（要約。全文ではない）:\n${row.summary}`;

      const system = [
        "あなたは組織の公式Threadsアカウントを運用するプロのSNS担当者です。",
        "他のアカウントの投稿に、こちらから公開コメントを1件だけ書きます。",
        AI_GUARDRAILS,
        "- 自分の投稿の宣伝や売り込みにしない。相手の投稿への反応・共感・具体的な問いかけを中心にする",
        "- 短く、会話として自然な長さにする（目安80文字以内。長い演説にしない）",
        "- 絵文字は0〜1個まで",
        examples.length > 0
          ? `\n参考として、このアカウントの過去投稿の文体・語彙に合わせてください:\n${examples.map((e, i) => `${i + 1}. ${e}`).join("\n")}`
          : "",
        '出力はJSONのみ: {"comment": "..."}',
      ].filter(Boolean).join("\n");

      try {
        const result = await invokeLLM({
          messages: [{ role: "system", content: system }, { role: "user", content: targetBlock }],
          responseFormat: { type: "json_object" },
          maxTokens: 300,
        });
        const content = result.choices[0]?.message?.content ?? "";
        const parsed = parseJsonLoose(content) as { comment?: unknown };
        const comment = typeof parsed.comment === "string" ? parsed.comment.trim() : "";
        if (!comment) throw new Error("empty comment draft");
        return { comment: Array.from(comment).slice(0, MAX_COMMENT_LENGTH).join("") };
      } catch (e) {
        throw aiError(e);
      }
    }),

  /**
   * コメントを送信する。実際にThreadsへ投稿するのはここだけで、AIが自動で送ることはない。
   *
   * targetType が "post" のときは、対象投稿のThreadsメディアIDをサーバー側で
   * 保有しているトレンド投稿行から解決する（クライアントには渡していないため）。
   * "reply" のときは、直前に `listReplies` で取得した返信のIDをそのまま渡す。
   */
  send: accountProcedure
    .input(z.union([
      z.object({
        trendPostId: z.number().int(),
        targetType: z.literal("post"),
        content: z.string().trim().min(1).max(MAX_COMMENT_LENGTH),
      }),
      z.object({
        trendPostId: z.number().int(),
        targetType: z.literal("reply"),
        targetExternalId: z.string().min(1).max(128),
        targetUsername: z.string().max(64).optional(),
        targetSummary: z.string().max(255).optional(),
        content: z.string().trim().min(1).max(MAX_COMMENT_LENGTH),
      }),
    ]))
    .mutation(async ({ input, ctx }) => {
      const row = await getOwnedTrendPost(input.trendPostId, ctx.account.id);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "対象の投稿が見つかりません。" });

      const last = lastSend.get(ctx.account.id) ?? 0;
      const waitMs = SEND_COOLDOWN_MS - (Date.now() - last);
      if (waitMs > 0) {
        throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "少し間隔を空けてから送信してください。" });
      }
      lastSend.set(ctx.account.id, Date.now());

      const targetExternalId = input.targetType === "post" ? row.externalId : input.targetExternalId;
      let postId: string | null = null;
      try {
        const res = await sendEngagementComment(ctx.account, targetExternalId, input.content);
        postId = res.postId;
      } catch (e) {
        const kind = classifyError(e);
        console.warn(`[engagement] send failed (account ${ctx.account.id}): ${kind}`);
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: ERROR_MESSAGE[kind] });
      }

      await createEngagementComment({
        accountId: ctx.account.id,
        targetExternalId,
        targetType: input.targetType,
        trendPostId: row.id,
        targetUsername: input.targetType === "post" ? row.username : (input.targetUsername ?? null),
        targetPermalink: input.targetType === "post" ? row.permalink : null,
        targetSummary: input.targetType === "post" ? row.summary : (input.targetSummary ?? null),
        content: input.content.trim(),
        threadsCommentId: postId,
      });
      return { ok: true };
    }),

  /** 対象投稿へ既に送ったコメントの件数（重複送信の目安。送信をブロックはしない） */
  countForTarget: accountProcedure
    .input(z.object({ trendPostId: z.number().int() }))
    .query(async ({ input, ctx }) => {
      const row = await getOwnedTrendPost(input.trendPostId, ctx.account.id);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "対象の投稿が見つかりません。" });
      return countEngagementCommentsForTarget(ctx.account.id, row.externalId);
    }),

  /** 送信履歴。新しい順 */
  history: accountProcedure.query(({ ctx }) => listEngagementComments(ctx.account.id, 50)),
});
