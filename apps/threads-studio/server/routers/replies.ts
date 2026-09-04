/**
 * 受信箱API（Threadsの返信管理）。
 *
 * - すべて accountProcedure。返信データ・状態はアカウント単位で完全に分離
 * - Threads APIの生レスポンス、トークンは返さない
 * - 手動取得・返信送信には回数制限を掛ける（費用と外部API保護、誤送信の防止）
 * - DMは扱わない（公式APIが公開されていないため実装しない）
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  countUnreadThreadReplies, getOwnedThreadReply, listThreadReplies, markThreadReplyReplied, setThreadReplyStatus,
} from "../db";
import { fetchRepliesForAccount, MAX_REPLY_LENGTH, sendReply } from "../replies";
import { classifyError, type ThreadsErrorKind } from "../threadsErrors";
import { accountProcedure } from "../accountScope";
import { router } from "../_core/trpc";

/** 手動取得の連打防止（アカウントごと） */
const FETCH_COOLDOWN_MS = 60_000;
const lastManualFetch = new Map<number, number>();

/** 返信送信の連打防止（誤送信対策も兼ねる） */
const SEND_COOLDOWN_MS = 3_000;
const lastSend = new Map<number, number>();

/** 失敗種別ごとの案内。専門用語だけで終わらせず、次に何をすればよいかを書く */
const ERROR_MESSAGE: Record<ThreadsErrorKind, string> = {
  auth: "Threadsの認証が切れています。設定画面の「アカウントを追加」から同じ表示名で連携リンクを発行し、このアカウントで再接続してください。",
  permission: "返信の閲覧・送信の権限がありません。設定画面の「アカウントを追加」から同じ表示名で連携リンクを発行し、このアカウントで再接続すると付与されます。",
  rate_limited: "Threadsの利用制限に達しました。しばらく待ってからお試しください。",
  network: "Threadsに接続できませんでした。しばらくしてからもう一度お試しください。",
  unknown: "処理に失敗しました。時間をおいて再度お試しください。続く場合は担当者にご連絡ください。",
};

export const repliesRouter = router({
  /** 返信一覧。新しい順 */
  list: accountProcedure
    .input(z.object({ status: z.enum(["all", "unread", "read", "replied"]).default("all") }).optional())
    .query(async ({ input, ctx }) => {
      const status = input?.status ?? "all";
      const rows = await listThreadReplies(ctx.account.id, {
        status: status === "all" ? undefined : [status], limit: 100,
        excludeUsername: ctx.account.threadsUsername,
      });
      return {
        replies: rows.map((r) => ({
          id: r.id, username: r.username, text: r.text, permalink: r.permalink, postedAt: r.postedAt,
          status: r.status, hideStatus: r.hideStatus, repliedContent: r.repliedContent, repliedAt: r.repliedAt,
        })),
        lastFetchAt: ctx.account.lastReplyFetchAt,
        lastFetchError: ctx.account.lastReplyFetchError as ThreadsErrorKind | null,
        maxReplyLength: MAX_REPLY_LENGTH,
      };
    }),

  /** サイドバーのバッジ用。未読件数だけを返す */
  unreadCount: accountProcedure.query(({ ctx }) => countUnreadThreadReplies(ctx.account.id, ctx.account.threadsUsername)),

  /** 既読にする */
  markRead: accountProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ input, ctx }) => {
      const row = await getOwnedThreadReply(input.id, ctx.account.id);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "対象の返信が見つかりません。" });
      if (row.status === "unread") await setThreadReplyStatus(input.id, ctx.account.id, "read");
      return { ok: true };
    }),

  /**
   * 今すぐ取得（管理者のみ）。
   * 失敗しても既存の一覧は消えない。失敗種別を日本語の案内文にして返す。
   */
  fetchNow: accountProcedure.mutation(async ({ ctx }) => {
    if (ctx.user.role !== "admin") {
      throw new TRPCError({ code: "FORBIDDEN", message: "この操作は管理者のみ実行できます。" });
    }
    const last = lastManualFetch.get(ctx.account.id) ?? 0;
    const waitMs = FETCH_COOLDOWN_MS - (Date.now() - last);
    if (waitMs > 0) {
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: `取得はしばらく待ってからお試しください（あと${Math.ceil(waitMs / 1000)}秒）。`,
      });
    }
    lastManualFetch.set(ctx.account.id, Date.now());
    const r = await fetchRepliesForAccount(ctx.account);
    if (r.error) {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: ERROR_MESSAGE[r.error] });
    }
    return { fetched: r.fetched, stored: r.stored };
  }),

  /**
   * 返信を送信する。成功したら該当行を「返信済み」にする。
   * 実際にThreadsへ投稿するのはここだけで、AIが自動で送ることはない。
   */
  reply: accountProcedure
    .input(z.object({ id: z.number().int(), content: z.string().trim().min(1).max(MAX_REPLY_LENGTH) }))
    .mutation(async ({ input, ctx }) => {
      const row = await getOwnedThreadReply(input.id, ctx.account.id);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "対象の返信が見つかりません。" });

      const last = lastSend.get(ctx.account.id) ?? 0;
      const waitMs = SEND_COOLDOWN_MS - (Date.now() - last);
      if (waitMs > 0) {
        throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "少し間隔を空けてから送信してください。" });
      }
      lastSend.set(ctx.account.id, Date.now());

      try {
        await sendReply(ctx.account, row.externalId, input.content);
      } catch (e) {
        const kind = classifyError(e);
        console.warn(`[replies] send failed (account ${ctx.account.id}): ${kind}`);
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: ERROR_MESSAGE[kind] });
      }
      await markThreadReplyReplied(input.id, ctx.account.id, input.content.trim());
      return { ok: true };
    }),
});
