import { z } from "zod";
import { purposeRatiosSchema } from "@shared/contentStrategy";
import {
  getAccountSettings, getSettings, upsertAccountSettings,
} from "../db";
import { accountProcedure } from "../accountScope";
import { publicProcedure, router } from "../_core/trpc";

/**
 * ブランド設定は2階層ある。
 * - グローバル（settings テーブル）: この導入環境そのものの名前。サインイン画面で使う
 *   （ログイン前はどのアカウントを見るか決まっていないため）
 * - アカウントごと（account_settings）: 選択中クライアントの表示名・色。ダッシュボード内で使う
 */
export const settingsRouter = router({
  /**
   * サインイン画面用の公開ブランド情報。
   * ログイン前に表示するため publicProcedure。表示名と色だけを返し、
   * トークン等の運用情報は一切含めない。
   */
  brand: publicProcedure.query(async () => {
    const s = await getSettings();
    return {
      brandName: s?.brandName ?? null,
      brandAccent: s?.brandAccent ?? null,
    };
  }),

  /**
   * 選択中アカウントの運用設定とスケジュール。
   * トークンそのものは返さず、登録済みかどうかだけを返す。
   */
  get: accountProcedure.query(async ({ ctx }) => {
    const ops = await getAccountSettings(ctx.account.id);
    return {
      accountId: ctx.account.id,
      accountName: ctx.account.name,
      threadsUserId: ctx.account.threadsUserId,
      hasToken: !!ctx.account.threadsAccessToken,
      tokenExpiresAt: ctx.account.tokenExpiresAt,
      morningHour: ctx.account.morningHour,
      morningMinute: ctx.account.morningMinute,
      eveningHour: ctx.account.eveningHour,
      eveningMinute: ctx.account.eveningMinute,
      timezone: ctx.account.timezone,
      ...ops,
    };
  }),

  /** 運用設定（承認フロー・通知・再投稿）とブランド設定。選択中アカウントにのみ適用される */
  saveOps: accountProcedure
    .input(z.object({
      requireApproval: z.boolean().optional(),
      notifyOnError: z.boolean().optional(),
      brandName: z.string().max(64).nullable().optional(),
      brandAccent: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
      autoFillEvergreen: z.boolean().optional(),
      recycleRewrite: z.boolean().optional(),
      recycleCooldownDays: z.number().int().min(1).max(365).optional(),
      postsPerDay: z.number().int().min(1).max(10).optional(),
      weeklyPostCount: z.number().int().min(1).max(42).optional(),
      purposeRatios: purposeRatiosSchema.nullable().optional(),
      defaultCta: z.string().max(300).nullable().optional(),
      forbiddenTopics: z.string().max(4_000).nullable().optional(),
      qualityStrictness: z.enum(["standard", "strict"]).optional(),
      strategyAiDailyLimit: z.number().int().min(0).max(100).optional(),
      autoWeeklyStrategy: z.boolean().optional(),
      weeklyReviewEnabled: z.boolean().optional(),
      conversionTrackingEnabled: z.boolean().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      await upsertAccountSettings(ctx.account.id, {
        ...input,
        purposeRatios: input.purposeRatios === undefined
          ? undefined
          : input.purposeRatios === null ? null : JSON.stringify(input.purposeRatios),
      });
      return { ok: true };
    }),
});
