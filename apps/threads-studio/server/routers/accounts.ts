import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  createAccount, deleteAccount, getAccountById, listAccounts, updateAccount,
} from "../db";
import { getThreadsProfile, refreshLongLivedToken } from "../threadsApi";
import { protectedProcedure, router } from "../_core/trpc";

/** トークンは常にマスクして返す */
function mask(account: Awaited<ReturnType<typeof getAccountById>> & object) {
  const { threadsAccessToken, ...rest } = account;
  return { ...rest, hasToken: !!threadsAccessToken };
}

export const accountsRouter = router({
  list: protectedProcedure.query(async () => {
    const rows = await listAccounts();
    return rows.map(mask);
  }),

  /** トークンを検証してアカウントを追加 */
  create: protectedProcedure
    .input(z.object({
      name: z.string().min(1).max(64),
      threadsAccessToken: z.string().min(1),
    }))
    .mutation(async ({ input }) => {
      let profile;
      try {
        profile = await getThreadsProfile(input.threadsAccessToken);
      } catch (e) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `トークンの検証に失敗しました: ${e instanceof Error ? e.message : String(e)}`,
        });
      }
      await createAccount({
        name: input.name,
        threadsUserId: profile.id,
        threadsAccessToken: input.threadsAccessToken,
        tokenRefreshedAt: new Date(),
      });
      return { ok: true, threadsUserId: profile.id, username: profile.username ?? null };
    }),

  /** 名前・スケジュール・有効/無効の更新 */
  update: protectedProcedure
    .input(z.object({
      id: z.number().int(),
      name: z.string().min(1).max(64).optional(),
      morningHour: z.number().int().min(0).max(23).optional(),
      morningMinute: z.number().int().min(0).max(59).optional(),
      eveningHour: z.number().int().min(0).max(23).optional(),
      eveningMinute: z.number().int().min(0).max(59).optional(),
      timezone: z.enum(["LA", "JP", "ET", "CT", "MT"]).optional(),
      active: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      await updateAccount(id, data);
      return { ok: true };
    }),

  /** トークンの差し替え（検証つき） */
  replaceToken: protectedProcedure
    .input(z.object({ id: z.number().int(), threadsAccessToken: z.string().min(1) }))
    .mutation(async ({ input }) => {
      let profile;
      try {
        profile = await getThreadsProfile(input.threadsAccessToken);
      } catch (e) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `トークンの検証に失敗しました: ${e instanceof Error ? e.message : String(e)}`,
        });
      }
      await updateAccount(input.id, {
        threadsAccessToken: input.threadsAccessToken,
        threadsUserId: profile.id,
        tokenRefreshedAt: new Date(),
        tokenExpiresAt: null,
      });
      return { ok: true, threadsUserId: profile.id };
    }),

  /** 手動トークンリフレッシュ */
  refreshToken: protectedProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ input }) => {
      const account = await getAccountById(input.id);
      if (!account) throw new TRPCError({ code: "NOT_FOUND" });
      try {
        const now = new Date();
        const { accessToken, expiresIn } = await refreshLongLivedToken(account.threadsAccessToken);
        await updateAccount(account.id, {
          threadsAccessToken: accessToken,
          tokenRefreshedAt: now,
          tokenExpiresAt: new Date(now.getTime() + expiresIn * 1000),
        });
        return { ok: true, expiresAt: new Date(now.getTime() + expiresIn * 1000) };
      } catch (e) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `リフレッシュに失敗しました: ${e instanceof Error ? e.message : String(e)}`,
        });
      }
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ input }) => {
      await deleteAccount(input.id);
      return { ok: true };
    }),
});
