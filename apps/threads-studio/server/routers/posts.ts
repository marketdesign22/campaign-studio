import { z } from "zod";
import {
  bulkCreatePosts, createPost, deletePost, deletePostsByIds, getNextPendingPostAny,
  getSettings, listActiveAccounts, listPosts, saveAsEvergreen, updatePost,
} from "../db";
import { getLocalParts } from "../scheduler";
import { planSchedule, slotKey, summarizeRunway } from "../schedulePlanner";
import { protectedProcedure, router } from "../_core/trpc";

/** 承認フロー有効時は新規原稿を draft で作成する */
async function initialApprovalStatus(): Promise<"draft" | "approved"> {
  const cfg = await getSettings();
  return cfg?.requireApproval ? "draft" : "approved";
}

/** Group posts by date for calendar view */
async function getCalendarView(year: number, month: number) {
  const all = await listPosts();
  const prefix = `${year}-${String(month).padStart(2, "0")}`;
  const inMonth = all.filter(p => p.scheduledDate?.startsWith(prefix));
  const byDate: Record<string, typeof inMonth> = {};
  for (const p of inMonth) {
    const d = p.scheduledDate!;
    if (!byDate[d]) byDate[d] = [];
    byDate[d].push(p);
  }
  return byDate;
}

/** アカウントのローカル日付（YYYY-MM-DD）。アカウント未登録時はサーバー日付 */
async function localToday(): Promise<string> {
  const accounts = await listActiveAccounts();
  const tz = accounts[0]?.timezone ?? "LA";
  return getLocalParts(new Date(), tz).dateStr;
}

/**
 * 未割り当ての原稿に予約日・スロットを割り当てる。
 * 既に埋まっている枠は飛ばすので、実行しても既存の予定は動かない
 * （＝何度押しても安全で、投稿が途切れた日から順に埋まっていく）。
 */
async function autoSchedule(postsPerDay: number, _items: unknown[], startDate?: string) {
  const db = await import("../db");
  const all = await db.listPosts();
  const unscheduled = all.filter(p => p.status === "pending" && !p.scheduledDate);
  if (unscheduled.length === 0) return;

  const start = startDate ?? (await localToday());
  const occupied = all
    .filter(p => p.scheduledDate && p.scheduledDate >= start)
    .map(p => slotKey(p.scheduledDate as string, p.slotIndex));

  const plan = planSchedule({
    ids: unscheduled.map(p => p.id),
    occupied,
    startDate: start,
    postsPerDay,
  });
  for (const a of plan) {
    await db.updatePost(a.id, { scheduledDate: a.scheduledDate, slotIndex: a.slotIndex });
  }
}

export const postsRouter = router({
  list: protectedProcedure.query(() => listPosts()),

  create: protectedProcedure
    .input(z.object({
      content: z.string().min(1).max(500),
      slotIndex: z.number().int().min(0).default(0),
      categoryId: z.number().int().nullable().optional(),
      accountId: z.number().int().nullable().optional(),
      scheduledDate: z.string().nullable().optional(),
      imageUrl: z.string().max(512).nullable().optional(),
      sortOrder: z.number().int().default(0),
    }))
    .mutation(async ({ input }) => {
      const id = await createPost({
        content: input.content, slotIndex: input.slotIndex,
        categoryId: input.categoryId ?? null, accountId: input.accountId ?? null,
        scheduledDate: input.scheduledDate ?? null, imageUrl: input.imageUrl ?? null,
        sortOrder: input.sortOrder,
        status: "pending", approvalStatus: await initialApprovalStatus(),
      });
      return { ok: true, id };
    }),

  update: protectedProcedure
    .input(z.object({
      id: z.number().int(),
      content: z.string().min(1).max(500).optional(),
      slotIndex: z.number().int().min(0).optional(),
      categoryId: z.number().int().nullable().optional(),
      accountId: z.number().int().nullable().optional(),
      scheduledDate: z.string().nullable().optional(),
      sortOrder: z.number().int().optional(),
      status: z.enum(["pending", "posted", "error"]).optional(),
      imageUrl: z.string().max(512).nullable().optional(),
      evergreen: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      await updatePost(id, data);
      return { ok: true };
    }),

  /** 承認フロー: 原稿を承認/差し戻し */
  setApproval: protectedProcedure
    .input(z.object({ id: z.number().int(), approvalStatus: z.enum(["draft", "approved"]) }))
    .mutation(async ({ input }) => {
      await updatePost(input.id, { approvalStatus: input.approvalStatus });
      return { ok: true };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ input }) => { await deletePost(input.id); return { ok: true }; }),

  /** 再投稿コンテンツとして保存する（投稿履歴からも呼べる） */
  saveAsEvergreen: protectedProcedure
    .input(z.object({
      content: z.string().min(1).max(500),
      postId: z.number().int().nullable().optional(),
    }))
    .mutation(async ({ input }) => {
      const id = await saveAsEvergreen(input.content, input.postId ?? null);
      return { ok: true, id };
    }),

  /** 選択した原稿の投稿先アカウントをまとめて変更する */
  bulkAssignAccount: protectedProcedure
    .input(z.object({
      ids: z.array(z.number().int()).min(1).max(500),
      accountId: z.number().int().nullable(),
    }))
    .mutation(async ({ input }) => {
      for (const id of input.ids) {
        await updatePost(id, { accountId: input.accountId });
      }
      return { ok: true, count: input.ids.length };
    }),

  /** 選択した原稿をまとめて削除する */
  bulkDelete: protectedProcedure
    .input(z.object({ ids: z.array(z.number().int()).min(1).max(500) }))
    .mutation(async ({ input }) => {
      await deletePostsByIds(input.ids);
      return { ok: true, count: input.ids.length };
    }),

  /** 配信の在庫状況（何日分の予約が残っているか・途切れる日はあるか） */
  runway: protectedProcedure.query(async () => {
    const today = await localToday();
    const all = await listPosts();
    const { days, lastDate, gapDates } = summarizeRunway(all, today);
    const unscheduled = all.filter(p => p.status === "pending" && !p.scheduledDate).length;
    return { today, days, lastDate, gapDates, unscheduled };
  }),

  nextPreview: protectedProcedure.query(async () => {
    // デフォルトアカウントのローカル日付基準で「今日投稿可能な」原稿のみ返す
    const accounts = await listActiveAccounts();
    const tz = accounts[0]?.timezone ?? "LA";
    const today = getLocalParts(new Date(), tz).dateStr;
    const post = await getNextPendingPostAny(today, accounts[0]?.id);
    return post ?? null;
  }),

  /** Bulk import from parsed text lines */
  bulkImport: protectedProcedure
    .input(z.object({
      lines: z.array(z.string().min(1).max(500)),
      categoryId: z.number().int().nullable().optional(),
      postsPerDay: z.number().int().min(1).max(10).default(2),
      startDate: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const approvalStatus = await initialApprovalStatus();
      const items = input.lines.map((content, i) => ({
        content,
        status: "pending" as const,
        approvalStatus,
        slotIndex: i % input.postsPerDay,
        categoryId: input.categoryId ?? null,
        sortOrder: i,
      }));
      await bulkCreatePosts(items);
      // Auto-assign scheduledDate
      await autoSchedule(input.postsPerDay, [], input.startDate);
      return { ok: true, count: items.length };
    }),

  /** Re-run auto-schedule on all unscheduled pending posts */
  autoSchedule: protectedProcedure
    .input(z.object({ postsPerDay: z.number().int().min(1).max(10).default(2), startDate: z.string().optional() }))
    .mutation(async ({ input }) => {
      await autoSchedule(input.postsPerDay, [], input.startDate);
      return { ok: true };
    }),

  /** Calendar view: posts grouped by date for a given year/month */
  calendarView: protectedProcedure
    .input(z.object({ year: z.number().int(), month: z.number().int().min(1).max(12) }))
    .query(async ({ input }) => getCalendarView(input.year, input.month)),

  /** Reschedule a single post to a new date and slot */
  reschedule: protectedProcedure
    .input(z.object({
      id: z.number().int(),
      scheduledDate: z.string(),
      slotIndex: z.number().int().min(0).max(9),
    }))
    .mutation(async ({ input }) => {
      await updatePost(input.id, { scheduledDate: input.scheduledDate, slotIndex: input.slotIndex });
      return { ok: true };
    }),
});
