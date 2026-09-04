import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  bulkCreatePosts, createPost, deletePost, deletePostsByIds, filterOwnedPostIds,
  getAccountById, getAccountSettings, getNextPendingPostAny, getOwnedPost, getOwnedTrendAnalysis,
  listPosts, saveAsEvergreen, updatePost,
} from "../db";
import { getLocalParts } from "../scheduler";
import { planSchedule, slotKey, summarizeRunway } from "../schedulePlanner";
import { primaryTimezone } from "@shared/postingSlots";
import { accountProcedure } from "../accountScope";
import type { AccountScope } from "../accountScope";
import type { Account } from "../../drizzle/schema";
import { router } from "../_core/trpc";

/** 承認フロー有効時は新規原稿を draft で作成する（アカウントごとの設定） */
async function initialApprovalStatus(accountId: number): Promise<"draft" | "approved"> {
  const cfg = await getAccountSettings(accountId);
  return cfg.requireApproval ? "draft" : "approved";
}

/**
 * 更新・削除の前に「その原稿が本当にこのアカウントのものか」を確かめる。
 * 他アカウントのIDを渡された場合はここで止まるので、
 * リクエストを書き換えても別アカウントのデータには触れられない。
 */
async function requireOwnedPost(id: number, scope: AccountScope) {
  const post = await getOwnedPost(id, scope);
  if (!post) {
    throw new TRPCError({ code: "NOT_FOUND", message: "この原稿は見つかりません。" });
  }
  return post;
}

/**
 * アカウントのローカル日付（YYYY-MM-DD）。
 * 枠ごとにタイムゾーンが異なりうるので、最初の枠のものを基準にする。
 */
function localToday(account: Account): string {
  return getLocalParts(new Date(), primaryTimezone(account)).dateStr;
}

/**
 * 未割り当ての原稿に予約日・スロットを割り当てる。
 * 既に埋まっている枠は飛ばすので、実行しても既存の予定は動かない
 * （＝何度押しても安全で、投稿が途切れた日から順に埋まっていく）。
 * 対象は選択中アカウントの原稿のみ。
 */
async function autoSchedule(
  scope: AccountScope,
  account: Account,
  postsPerDay: number,
  startDate?: string
) {
  const all = await listPosts(scope);
  const unscheduled = all.filter((p) => p.status === "pending" && !p.scheduledDate);
  if (unscheduled.length === 0) return;

  const start = startDate ?? localToday(account);
  const occupied = all
    .filter((p) => p.scheduledDate && p.scheduledDate >= start)
    .map((p) => slotKey(p.scheduledDate as string, p.slotIndex));

  const plan = planSchedule({
    ids: unscheduled.map((p) => p.id),
    occupied,
    startDate: start,
    postsPerDay,
  });
  for (const a of plan) {
    await updatePost(a.id, { scheduledDate: a.scheduledDate, slotIndex: a.slotIndex });
  }
}

export const postsRouter = router({
  list: accountProcedure.query(({ ctx }) => listPosts(ctx.scope)),

  create: accountProcedure
    .input(z.object({
      content: z.string().min(1).max(500),
      slotIndex: z.number().int().min(0).default(0),
      categoryId: z.number().int().nullable().optional(),
      scheduledDate: z.string().nullable().optional(),
      imageUrl: z.string().max(512).nullable().optional(),
      sortOrder: z.number().int().default(0),
      /** 参照したトレンド分析（学習サイクルで成果を比較するため）。自アカウントのもののみ */
      trendAnalysisId: z.number().int().nullable().optional(),
      trendMeta: z.object({
        angle: z.string().max(200).nullable().optional(),
        referencedTrends: z.array(z.string().max(200)).max(4).optional(),
      }).nullable().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      let trendAnalysisId: number | null = null;
      if (input.trendAnalysisId) {
        const owned = await getOwnedTrendAnalysis(input.trendAnalysisId, ctx.account.id);
        if (!owned) throw new TRPCError({ code: "NOT_FOUND", message: "トレンド分析が見つかりません。" });
        trendAnalysisId = owned.id;
      }
      const id = await createPost({
        content: input.content, slotIndex: input.slotIndex,
        categoryId: input.categoryId ?? null,
        // 投稿先は常に選択中のアカウント。クライアントからは指定させない
        accountId: ctx.account.id,
        scheduledDate: input.scheduledDate ?? null, imageUrl: input.imageUrl ?? null,
        sortOrder: input.sortOrder,
        status: "pending", approvalStatus: await initialApprovalStatus(ctx.account.id),
        trendAnalysisId,
        trendMeta: trendAnalysisId && input.trendMeta ? JSON.stringify(input.trendMeta) : null,
      });
      return { ok: true, id };
    }),

  update: accountProcedure
    .input(z.object({
      id: z.number().int(),
      content: z.string().min(1).max(500).optional(),
      slotIndex: z.number().int().min(0).optional(),
      categoryId: z.number().int().nullable().optional(),
      scheduledDate: z.string().nullable().optional(),
      sortOrder: z.number().int().optional(),
      status: z.enum(["pending", "posted", "error"]).optional(),
      imageUrl: z.string().max(512).nullable().optional(),
      evergreen: z.boolean().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const { id, ...data } = input;
      await requireOwnedPost(id, ctx.scope);
      await updatePost(id, data);
      return { ok: true };
    }),

  /** 承認フロー: 原稿を承認/差し戻し */
  setApproval: accountProcedure
    .input(z.object({ id: z.number().int(), approvalStatus: z.enum(["draft", "approved"]) }))
    .mutation(async ({ input, ctx }) => {
      await requireOwnedPost(input.id, ctx.scope);
      await updatePost(input.id, { approvalStatus: input.approvalStatus });
      return { ok: true };
    }),

  delete: accountProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ input, ctx }) => {
      await requireOwnedPost(input.id, ctx.scope);
      await deletePost(input.id);
      return { ok: true };
    }),

  /** 再投稿コンテンツとして保存する（投稿履歴からも呼べる） */
  saveAsEvergreen: accountProcedure
    .input(z.object({
      content: z.string().min(1).max(500),
      postId: z.number().int().nullable().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const id = await saveAsEvergreen(input.content, input.postId ?? null, ctx.scope);
      return { ok: true, id };
    }),

  /**
   * 選択した原稿を別のアカウントへ移す。
   * 移せるのは自アカウントの原稿だけで、移動先も実在する有効なアカウントに限る。
   */
  bulkAssignAccount: accountProcedure
    .input(z.object({
      ids: z.array(z.number().int()).min(1).max(500),
      accountId: z.number().int(),
    }))
    .mutation(async ({ input, ctx }) => {
      const target = await getAccountById(input.accountId);
      if (!target || !target.active) {
        throw new TRPCError({ code: "FORBIDDEN", message: "移動先のアカウントが不正です。" });
      }
      const owned = await filterOwnedPostIds(input.ids, ctx.scope);
      for (const id of owned) {
        await updatePost(id, { accountId: target.id });
      }
      return { ok: true, count: owned.length };
    }),

  /** 選択した原稿をまとめて削除する */
  bulkDelete: accountProcedure
    .input(z.object({ ids: z.array(z.number().int()).min(1).max(500) }))
    .mutation(async ({ input, ctx }) => {
      const owned = await filterOwnedPostIds(input.ids, ctx.scope);
      await deletePostsByIds(owned, ctx.scope);
      return { ok: true, count: owned.length };
    }),

  /** 配信の在庫状況（何日分の予約が残っているか・途切れる日はあるか） */
  runway: accountProcedure.query(async ({ ctx }) => {
    const today = localToday(ctx.account);
    const all = await listPosts(ctx.scope);
    const { days, lastDate, gapDates } = summarizeRunway(all, today);
    const unscheduled = all.filter((p) => p.status === "pending" && !p.scheduledDate).length;
    return { today, days, lastDate, gapDates, unscheduled };
  }),

  nextPreview: accountProcedure.query(async ({ ctx }) => {
    // 選択中アカウントのローカル日付基準で「今日投稿可能な」原稿のみ返す
    const today = localToday(ctx.account);
    const post = await getNextPendingPostAny(today, ctx.scope);
    if (!post) return null;
    return { ...post, accountName: ctx.account.name };
  }),

  /** Bulk import from parsed text lines */
  bulkImport: accountProcedure
    .input(z.object({
      lines: z.array(z.string().min(1).max(500)),
      categoryId: z.number().int().nullable().optional(),
      postsPerDay: z.number().int().min(1).max(10).default(2),
      startDate: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const approvalStatus = await initialApprovalStatus(ctx.account.id);
      const items = input.lines.map((content, i) => ({
        content,
        status: "pending" as const,
        approvalStatus,
        accountId: ctx.account.id,
        slotIndex: i % input.postsPerDay,
        categoryId: input.categoryId ?? null,
        sortOrder: i,
      }));
      await bulkCreatePosts(items);
      // Auto-assign scheduledDate
      await autoSchedule(ctx.scope, ctx.account, input.postsPerDay, input.startDate);
      return { ok: true, count: items.length };
    }),

  /** Re-run auto-schedule on all unscheduled pending posts */
  autoSchedule: accountProcedure
    .input(z.object({
      postsPerDay: z.number().int().min(1).max(10).default(2),
      startDate: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      await autoSchedule(ctx.scope, ctx.account, input.postsPerDay, input.startDate);
      return { ok: true };
    }),

  /** Calendar view: posts grouped by date for a given year/month */
  calendarView: accountProcedure
    .input(z.object({ year: z.number().int(), month: z.number().int().min(1).max(12) }))
    .query(async ({ input, ctx }) => {
      const all = await listPosts(ctx.scope);
      const prefix = `${input.year}-${String(input.month).padStart(2, "0")}`;
      const inMonth = all.filter((p) => p.scheduledDate?.startsWith(prefix));
      const byDate: Record<string, typeof inMonth> = {};
      for (const p of inMonth) {
        const d = p.scheduledDate!;
        if (!byDate[d]) byDate[d] = [];
        byDate[d].push(p);
      }
      return byDate;
    }),

  /** Reschedule a single post to a new date and slot */
  reschedule: accountProcedure
    .input(z.object({
      id: z.number().int(),
      scheduledDate: z.string(),
      slotIndex: z.number().int().min(0).max(9),
    }))
    .mutation(async ({ input, ctx }) => {
      await requireOwnedPost(input.id, ctx.scope);
      await updatePost(input.id, { scheduledDate: input.scheduledDate, slotIndex: input.slotIndex });
      return { ok: true };
    }),
});
