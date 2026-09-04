import { z } from "zod";
import {
  createPostLog, getAccountSettings, getNextPendingPostAny, getOwnedPost, updatePost,
} from "../db";
import { getLocalParts, resolveImageUrl } from "../scheduler";
import { publishTextPost } from "../threadsApi";
import { accountProcedure } from "../accountScope";
import { router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { assertPublishableContent, parseForbiddenTopics } from "../quality";

export const manualPostRouter = router({
  /**
   * 「今すぐ投稿」。投稿先は常に選択中のアカウントで、
   * 対象原稿もそのアカウントが所有するものに限られる。
   */
  post: accountProcedure
    .input(z.object({ postId: z.number().int().optional() }))
    .mutation(async ({ input, ctx }) => {
      const { account, scope } = ctx;

      const post = input.postId
        ? await getOwnedPost(input.postId, scope)
        : await getNextPendingPostAny(getLocalParts(new Date(), account.timezone).dateStr, scope);

      if (!post) {
        throw new TRPCError({ code: "NOT_FOUND", message: "投稿可能な原稿がありません。" });
      }

      // 承認フロー有効時は未承認原稿の手動投稿もブロックする
      const cfg = await getAccountSettings(account.id);
      if (cfg.requireApproval && post.approvalStatus !== "approved") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "この原稿は未承認です。承認後に投稿してください。",
        });
      }
      const forbidden = parseForbiddenTopics(cfg.forbiddenTopics);
      try { assertPublishableContent(post.content, forbidden); } catch (error) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: error instanceof Error ? error.message : "投稿前チェックで停止しました。" });
      }

      try {
        const result = await publishTextPost(
          account.threadsAccessToken,
          account.threadsUserId,
          post.content,
          resolveImageUrl(post.imageUrl)
        );
        await updatePost(post.id, { status: "posted", accountId: account.id });
        await createPostLog({
          postId: post.id,
          accountId: account.id,
          content: post.content,
          status: "posted",
          threadsPostId: result.postId,
          imageUrl: post.imageUrl,
          slotIndex: 99,
          categoryId: post.categoryId,
        });
        return { ok: true, threadsPostId: result.postId };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await updatePost(post.id, { status: "error" });
        await createPostLog({
          postId: post.id,
          accountId: account.id,
          content: post.content,
          status: "error",
          errorMessage: msg,
          imageUrl: post.imageUrl,
          slotIndex: 99,
        });
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: msg });
      }
    }),
});
