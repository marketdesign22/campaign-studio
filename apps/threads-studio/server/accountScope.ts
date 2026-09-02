/**
 * アカウントスコープの解決。
 *
 * 画面で選択中のアカウントは `x-account-id` ヘッダで送られてくるが、
 * その値は一切信用しない。必ずDBを引いて「実在し、かつ有効なアカウントか」を
 * 検証し、検証済みのアカウントだけを ctx に載せる。
 * 以降のルーターは ctx.account / ctx.scope しか参照しないため、
 * クライアントが account_id を書き換えても他アカウントには到達できない。
 */
import { TRPCError } from "@trpc/server";
import type { Account } from "../drizzle/schema";
import { listAccounts } from "./db";
import { protectedProcedure } from "./_core/trpc";

export const ACCOUNT_HEADER = "x-account-id";

/**
 * 取得系クエリの絞り込み条件。
 *
 * `includeLegacy` は「accountId 未設定の旧データを含めるか」。
 * マルチアカウント化以前に作られた原稿・履歴は accountId が NULL のままで、
 * それらは最初に作られたアカウント（= 最小ID）のものである。
 * DBを書き換えずに正しく読むためのフラグで、2番目以降のアカウントでは常に false。
 * backfill スクリプトで NULL を解消すれば、このフラグは実質無効になる。
 */
export type AccountScope = {
  accountId: number;
  includeLegacy: boolean;
};

export function scopeOf(account: Account, primaryAccountId: number | null): AccountScope {
  return {
    accountId: account.id,
    includeLegacy: account.id === primaryAccountId,
  };
}

/** 旧データの持ち主 = 最初に作られたアカウント（無効化されていても基準は変わらない） */
export function primaryAccountId(accounts: Account[]): number | null {
  if (accounts.length === 0) return null;
  return accounts.reduce((min, a) => (a.id < min ? a.id : min), accounts[0].id);
}

function parseHeader(raw: unknown): number | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string" || value.trim() === "") return null;
  if (!/^\d+$/.test(value.trim())) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "アカウントIDが不正です。" });
  }
  return Number(value.trim());
}

/**
 * リクエストから操作対象アカウントを確定する。
 * ヘッダ未指定なら既定アカウント（有効なもののうち最小ID）にフォールバックする。
 */
export async function resolveRequestAccount(
  headerValue: unknown
): Promise<{ account: Account; scope: AccountScope; primaryId: number }> {
  const all = await listAccounts();
  if (all.length === 0) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Threadsアカウントが登録されていません。設定ページからアカウントを追加してください。",
    });
  }
  const primaryId = primaryAccountId(all)!;
  const requested = parseHeader(headerValue);

  let account: Account | undefined;
  if (requested !== null) {
    account = all.find((a) => a.id === requested);
    // 実在しない、または無効化されたアカウントは拒否する（他アカウントへ勝手に倒さない）
    if (!account) {
      throw new TRPCError({ code: "FORBIDDEN", message: "指定されたアカウントは操作できません。" });
    }
    if (!account.active) {
      throw new TRPCError({ code: "FORBIDDEN", message: "指定されたアカウントは無効化されています。" });
    }
  } else {
    account = all.filter((a) => a.active).sort((x, y) => x.id - y.id)[0];
    if (!account) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "有効なThreadsアカウントがありません。" });
    }
  }

  return { account, scope: scopeOf(account, primaryId), primaryId };
}

/**
 * ログイン済み かつ 検証済みアカウントを要求するプロシージャ。
 * アカウント固有のデータを触るAPIはすべてこれを使う。
 */
export const accountProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  const { account, scope } = await resolveRequestAccount(ctx.req.headers[ACCOUNT_HEADER]);
  return next({ ctx: { ...ctx, account, scope } });
});
