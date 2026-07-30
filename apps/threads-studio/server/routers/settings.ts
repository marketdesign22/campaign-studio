import { z } from "zod";
import { getSettings, upsertSettings } from "../db";
import { getThreadsUserId } from "../threadsApi";
import { protectedProcedure, router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";

export const settingsRouter = router({
  get: protectedProcedure.query(async () => {
    const s = await getSettings();
    if (!s) return {
      threadsAccessToken: null,
      threadsUserId: null,
      morningHour: 8,
      morningMinute: 0,
      eveningHour: 18,
      eveningMinute: 0,
      timezone: "LA" as const,
      requireApproval: false,
      notifyOnError: true,
      brandName: null as string | null,
      brandAccent: null as string | null,
    };
    return {
      threadsAccessToken: s.threadsAccessToken ? "***saved***" : null,
      threadsUserId: s.threadsUserId,
      morningHour: s.morningHour,
      morningMinute: s.morningMinute,
      eveningHour: s.eveningHour,
      eveningMinute: s.eveningMinute,
      timezone: s.timezone,
      requireApproval: s.requireApproval,
      notifyOnError: s.notifyOnError,
      brandName: s.brandName,
      brandAccent: s.brandAccent,
    };
  }),

  /** 運用設定（承認フロー・通知）とブランド設定 */
  saveOps: protectedProcedure
    .input(z.object({
      requireApproval: z.boolean().optional(),
      notifyOnError: z.boolean().optional(),
      brandName: z.string().max(64).nullable().optional(),
      brandAccent: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
    }))
    .mutation(async ({ input }) => {
      await upsertSettings(input);
      return { ok: true };
    }),

  /** Legacy: 単一トークン保存（アカウント管理UIへ移行済みだが互換のため残す） */
  save: protectedProcedure
    .input(
      z.object({
        threadsAccessToken: z.string().min(1),
        threadsUserId: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      let userId = input.threadsUserId;
      if (!userId) {
        try {
          userId = await getThreadsUserId(input.threadsAccessToken);
        } catch (e) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Token verification failed: ${e instanceof Error ? e.message : String(e)}`,
          });
        }
      }
      await upsertSettings({
        threadsAccessToken: input.threadsAccessToken,
        threadsUserId: userId,
      });
      return { ok: true, threadsUserId: userId };
    }),

  clear: protectedProcedure.mutation(async () => {
    await upsertSettings({ threadsAccessToken: null, threadsUserId: null });
    return { ok: true };
  }),

  saveSchedule: protectedProcedure
    .input(
      z.object({
        morningHour: z.number().int().min(0).max(23),
        morningMinute: z.number().int().min(0).max(59),
        eveningHour: z.number().int().min(0).max(23),
        eveningMinute: z.number().int().min(0).max(59),
        timezone: z.enum(["LA", "JP", "ET", "CT", "MT"]),
      })
    )
    .mutation(async ({ input }) => {
      await upsertSettings(input);
      return { ok: true };
    }),
});
