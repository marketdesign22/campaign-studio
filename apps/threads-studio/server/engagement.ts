/**
 * エンゲージメント: トレンドで収集した他アカウントの投稿へ、こちらからコメントを送る機能。
 *
 * - 対象はトレンド機能で収集済みの投稿（自社が保存しているデータの中からだけ選ぶ）。
 *   任意のURLを貼って知らない投稿へコメントする、という経路は用意しない
 * - 投稿本体だけでなく、その投稿についた返信（他人のコメント）へ返信することもできる。
 *   ただし他アカウントの投稿の返信一覧は、Threads側の権限モデルにより取得できない
 *   場合がある。その場合は例外を投げるので、呼び出し側で失敗として扱い、
 *   投稿本体へのコメントにフォールバックできるようにする
 * - AIはコメント文の「案」を1つ作るだけ。送信は利用者が送信ボタンを押した時だけ
 * - ログにはトークン・本文・APIの生レスポンスを出さず、失敗の種別だけ残す
 */
import type { Account } from "../drizzle/schema";
import { fetchPostReplies, publishReply as publishReplyToThreads, type ThreadsReply } from "./threadsApi";
import { classifyError, type ThreadsErrorKind } from "./threadsErrors";

export const MAX_COMMENT_LENGTH = 500;
/** 返信一覧を見るときの取得件数。多すぎる件数は取らない */
const POST_REPLIES_LIMIT = 25;

export type PostRepliesResult = { items: ThreadsReply[]; error: ThreadsErrorKind | null };

/**
 * 指定した投稿についた返信の一覧。取得できなければ空配列とエラー種別を返す
 * （例外は投げない。呼び出し側で「投稿本体へのコメント」に切り替えられるように）。
 */
export async function listPostReplies(account: Account, mediaId: string): Promise<PostRepliesResult> {
  try {
    const items = await fetchPostReplies(account.threadsAccessToken, mediaId, POST_REPLIES_LIMIT);
    return { items: items.filter((it) => !!it.text), error: null };
  } catch (e) {
    const kind = classifyError(e);
    console.warn(`[engagement] post replies fetch failed (account ${account.id}): ${kind}`);
    return { items: [], error: kind };
  }
}

/**
 * コメントを送信する。500文字制限を守り、Threadsへは1回だけ送る。
 * 呼び出しは利用者が送信ボタンを押した時だけ（自動送信はしない）。
 */
export async function sendEngagementComment(account: Account, targetExternalId: string, text: string) {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("empty comment");
  if (Array.from(trimmed).length > MAX_COMMENT_LENGTH) throw new Error("comment too long");
  return publishReplyToThreads(account.threadsAccessToken, account.threadsUserId, trimmed, targetExternalId);
}
