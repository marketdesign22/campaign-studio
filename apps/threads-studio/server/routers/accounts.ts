import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  createAccount, deleteAccount, deleteAccountSettings, getAccountById, listAccounts, updateAccount,
} from "../db";
import { getThreadsProfile, refreshLongLivedToken } from "../threadsApi";
import { buildAuthorizeUrl, signConnectState } from "../threadsOAuth";
import { MAX_SLOTS, resolveSlots, serializeSlots } from "@shared/postingSlots";
import { accountProcedure } from "../accountScope";
import { protectedProcedure, router } from "../_core/trpc";

/** トークンは常にマスクして返す。投稿枠は画面で扱いやすいよう配列にして返す */
function mask(account: Awaited<ReturnType<typeof getAccountById>> & object) {
  const { threadsAccessToken, slots, ...rest } = account;
  return { ...rest, hasToken: !!threadsAccessToken, slots: resolveSlots(account) };
}

export const accountsRouter = router({
  list: protectedProcedure.query(async () => {
    const rows = await listAccounts();
    return rows.map(mask);
  }),

  /**
   * サーバーが実際に操作対象として確定したアカウント。
   * 画面の選択状態が本当にサーバーへ届いているかを確認するために使う
   * （クライアントの保存値ではなく、検証を通った値が返る）。
   */
  current: accountProcedure.query(({ ctx }) => ({
    id: ctx.account.id,
    name: ctx.account.name,
    threadsUserId: ctx.account.threadsUserId,
    timezone: ctx.account.timezone,
  })),

  /**
   * クライアントに渡す連携リンクを発行する。
   * リンクを開いた人がThreadsで許可すると、トークンがこのアプリに直接届く
   * （＝クライアントのパスワードを預からずにアカウントを追加できる）。
   */
  createConnectLink: protectedProcedure
    .input(z.object({ name: z.string().min(1).max(64) }))
    .mutation(async ({ input }) => {
      try {
        const state = await signConnectState(input.name);
        return { url: buildAuthorizeUrl(state) };
      } catch (e) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: e instanceof Error ? e.message : String(e),
        });
      }
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
      /**
       * 投稿枠。枠ごとにタイムゾーンを指定できるので、
       * 「JSTの朝夕 + PTの朝夕」のような組み合わせが1アカウントで組める。
       */
      slots: z.array(z.object({
        hour: z.number().int().min(0).max(23),
        minute: z.number().int().min(0).max(59),
        timezone: z.enum(["LA", "JP", "ET", "CT", "MT"]),
      })).min(1).max(MAX_SLOTS).optional(),
      // 以下は枠機能より前からある設定。slots 未設定のアカウント向けに残している
      morningHour: z.number().int().min(0).max(23).optional(),
      morningMinute: z.number().int().min(0).max(59).optional(),
      eveningHour: z.number().int().min(0).max(23).optional(),
      eveningMinute: z.number().int().min(0).max(59).optional(),
      timezone: z.enum(["LA", "JP", "ET", "CT", "MT"]).optional(),
      active: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, slots, ...rest } = input;
      await updateAccount(id, {
        ...rest,
        ...(slots ? { slots: serializeSlots(slots) } : {}),
      });
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
        // username が取れた時だけ更新する（失敗時に既存の値を消さないため）
        ...(profile.username ? { threadsUsername: profile.username } : {}),
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
      // 原稿・履歴は監査のため残し、そのアカウント固有の設定行だけ片付ける
      await deleteAccountSettings(input.id);
      await deleteAccount(input.id);
      return { ok: true };
    }),
});
