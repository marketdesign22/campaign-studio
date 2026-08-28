import { z } from "zod";
import {
  createPostLog, getAccountById, getNextPendingPostAny, getPostById,
  getSettings, listActiveAccounts, updatePost,
} from "../db";
import { getLocalParts, resolveImageUrl } from "../scheduler";
import { publishTextPost } from "../threadsApi";
import { protectedProcedure, router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";

export const manualPostRouter = router({
  post: protectedProcedure
    .input(z.object({ postId: z.number().int().optional() }))
    .mutation(async ({ input }) => {
      const accounts = await listActiveAccounts();
      if (accounts.length === 0) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Threadsアカウントが登録されていません。設定ページからアカウントを追加してください。",
        });
      }

      let post;
      if (input.postId) {
        post = await getPostById(input.postId);
      } else {
        const tz = accounts[0].timezone;
        const today = getLocalParts(new Date(), tz).dateStr;
        post = await getNextPendingPostAny(today, accounts[0].id);
      }

      if (!post) {
        throw new TRPCError({ code: "NOT_FOUND", message: "投稿可能な原稿がありません。" });
      }

      // 承認フロー有効時は未承認原稿の手動投稿もブロックする
      const cfg = await getSettings();
      if (cfg?.requireApproval && post.approvalStatus !== "approved") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "この原稿は未承認です。承認後に投稿してください。",
        });
      }

      const account =
        (post.accountId ? await getAccountById(post.accountId) : undefined) ?? accounts[0];
      if (!account.active) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "投稿先アカウントが無効化されています。" });
      }

      try {
        const result = await publishTextPost(
          account.threadsAccessToken,
          account.threadsUserId,
          post.content,
          resolveImageUrl(post.imageUrl)
        );
        await updatePost(post.id, { status: "posted" });
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
