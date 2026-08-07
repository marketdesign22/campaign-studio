import { z } from "zod";
import {
  bulkCreatePosts, createPost, deletePost, getNextPendingPostAny,
  getSettings, listActiveAccounts, listPosts, updatePost,
} from "../db";
import { getLocalParts } from "../scheduler";
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

/** Auto-assign scheduledDate and slotIndex to pending posts */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function autoSchedule(postsPerDay: number, _items: any[], startDate?: string) {
  const db = await import("../db");
  const allPending = (await db.listPosts()).filter(p => p.status === "pending" && !p.scheduledDate);
  if (allPending.length === 0) return;
  const base = startDate ? new Date(startDate) : new Date();
  base.setHours(0, 0, 0, 0);
  let dayOffset = 0;
  let slotIdx = 0;
  for (const p of allPending) {
    const d = new Date(base);
    d.setDate(d.getDate() + dayOffset);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    await db.updatePost(p.id, { scheduledDate: `${yyyy}-${mm}-${dd}`, slotIndex: slotIdx });
    slotIdx++;
    if (slotIdx >= postsPerDay) { slotIdx = 0; dayOffset++; }
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
      sortOrder: z.number().int().default(0),
    }))
    .mutation(async ({ input }) => {
      const id = await createPost({
        content: input.content, slotIndex: input.slotIndex,
        categoryId: input.categoryId ?? null, accountId: input.accountId ?? null,
        scheduledDate: input.scheduledDate ?? null, sortOrder: input.sortOrder,
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
