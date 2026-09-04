/**
 * 受信箱: Threadsの返信管理。
 *
 * - 自社投稿への公開返信だけを扱う。DM（ダイレクトメッセージ）は公式APIが
 *   公開されていないため対象外（スクレイピングもしない）
 * - 収集はアカウント単位。1アカウントの失敗が他を止めない
 * - 保存は上書き型。失敗しても既存データは消えず、利用者が付けた既読・返信済み
 *   状態や送信済みの返信内容も再取得で消えない
 * - 返信は「案」ではなく実際の送信操作。自動では送信せず、利用者が送信ボタンを
 *   押した時だけ Threads へ1回送る
 * - ログにはトークン・返信本文を出さず、失敗の種別だけ残す
 */
import type { Account } from "../drizzle/schema";
import { updateAccount, upsertThreadReply } from "./db";
import { fetchAccountReplies, getThreadsProfile, publishReply as publishReplyToThreads } from "./threadsApi";
import { classifyError, worstError, type ThreadsErrorKind } from "./threadsErrors";
import { withRetry } from "./threadsRetry";

/** 1回の取得で引く件数。受信箱は「直近」を見る用途なので多すぎる件数は取らない */
export const REPLY_FETCH_LIMIT = 50;

function retryClass(e: unknown): "network" | "rate_limited" | "other" {
  const kind = classifyError(e);
  return kind === "network" || kind === "rate_limited" ? kind : "other";
}

/**
 * 自分自身の投稿（スレッドの続きとして自分に返信したもの）かどうか。
 * どちらかのユーザー名が分からない場合は判定できないので false（除外しない）。
 */
export function isOwnReply(username: string | null, ownUsername: string | null): boolean {
  if (!username || !ownUsername) return false;
  return username.toLowerCase() === ownUsername.toLowerCase();
}

export type ReplyFetchResult = {
  accountId: number;
  fetched: number;
  stored: number;
  error: ThreadsErrorKind | null;
};

/**
 * 1アカウント分の返信取得。
 * 失敗しても例外は投げない（呼び出し側で他アカウントの処理を続けられるように）。
 * 失敗種別はアカウント行の `lastReplyFetchError` に記録し、画面で案内する。
 */
export async function fetchRepliesForAccount(account: Account, now: Date = new Date()): Promise<ReplyFetchResult> {
  /** 取得結果の記録はベストエフォート。これ自体の失敗で結果を「失敗」に変えない */
  async function recordOutcome(error: ThreadsErrorKind | null, threadsUsername?: string | null) {
    try {
      await updateAccount(account.id, {
        lastReplyFetchAt: now, lastReplyFetchError: error,
        ...(threadsUsername !== undefined ? { threadsUsername } : {}),
      });
    } catch {
      /* 記録に失敗しても取得結果自体は返す */
    }
  }

  // 自分自身の返信（スレッドの続き）を除くために、自分のユーザー名が要る。
  // 未登録（初回接続時にプロフィール取得が失敗した等）なら、ここで一度だけ解決して保存する
  let ownUsername = account.threadsUsername;
  let resolvedUsername: string | null | undefined;
  if (!ownUsername) {
    try {
      const profile = await getThreadsProfile(account.threadsAccessToken);
      ownUsername = profile.username ?? null;
      resolvedUsername = ownUsername;
    } catch {
      // 取得できなくても返信の取得自体は続ける（自分の返信の除外だけ効かなくなる）
    }
  }

  try {
    const items = await withRetry(
      () => fetchAccountReplies(account.threadsAccessToken, account.threadsUserId, REPLY_FETCH_LIMIT),
      retryClass
    );
    let stored = 0;
    for (const it of items) {
      // 本文の無い返信（画像のみ等）は現状扱わない
      if (!it.text) continue;
      // 自分自身の返信（スレッドの続き）は「返信が必要な受信」ではないので保存しない
      if (isOwnReply(it.username, ownUsername)) continue;
      await upsertThreadReply({
        accountId: account.id, externalId: it.id, rootMediaId: it.rootMediaId, rootPermalink: null,
        username: it.username, text: it.text.slice(0, 500), permalink: it.permalink,
        postedAt: it.timestamp, hideStatus: it.hideStatus,
      });
      stored++;
    }
    await recordOutcome(null, resolvedUsername);
    return { accountId: account.id, fetched: items.length, stored, error: null };
  } catch (e) {
    const kind = classifyError(e);
    // トークンやレスポンス本文はログに残さない。種別だけ記録する
    console.warn(`[replies] fetch failed (account ${account.id}): ${kind}`);
    await recordOutcome(kind, resolvedUsername);
    return { accountId: account.id, fetched: 0, stored: 0, error: kind };
  }
}

/** スケジューラから呼ぶ。1アカウントの失敗が他アカウントを止めない */
export async function fetchRepliesForAccounts(accounts: Account[], now: Date = new Date()): Promise<ReplyFetchResult[]> {
  const out: ReplyFetchResult[] = [];
  for (const account of accounts) {
    try {
      out.push(await fetchRepliesForAccount(account, now));
    } catch (e) {
      // fetchRepliesForAccount は内部で例外を握りつぶす設計だが、二重の保険として
      // 想定外の失敗でも他アカウントを止めない
      console.warn(`[replies] unexpected failure for account ${account.id}: ${e instanceof Error ? e.name : "error"}`);
    }
  }
  return out;
}

/** 複数アカウントの失敗から、利用者が対処すべきものを1つ選ぶ */
export function worstReplyError(results: ReplyFetchResult[]): ThreadsErrorKind | null {
  return worstError(results.map((r) => r.error).filter((k): k is ThreadsErrorKind => k !== null));
}

export const MAX_REPLY_LENGTH = 500;

/**
 * 返信を送信する。500文字制限を守り、Threadsへは1回だけ送る。
 * 呼び出しは利用者が送信ボタンを押した時だけ（自動送信はしない）。
 */
export async function sendReply(account: Account, replyToExternalId: string, text: string) {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("empty reply");
  if (Array.from(trimmed).length > MAX_REPLY_LENGTH) throw new Error("reply too long");
  return publishReplyToThreads(account.threadsAccessToken, account.threadsUserId, trimmed, replyToExternalId);
}
