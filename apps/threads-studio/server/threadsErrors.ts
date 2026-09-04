/**
 * Threads API の失敗を画面に出せる粒度へ丸める共通ロジック。
 * トレンド収集・返信管理など、Threads APIを叩く各機能から使う。
 * 生のレスポンス本文をそのまま返さない（トークンや内部詳細を漏らさないため）。
 */

export type ThreadsErrorKind = "auth" | "permission" | "rate_limited" | "network" | "unknown";

export function classifyThreadsError(message: string): ThreadsErrorKind {
  const m = message.toLowerCase();
  if (/\(429\)/.test(m) || m.includes("rate limit") || m.includes("too many") || m.includes("\"code\":4,") || m.includes("\"code\":17,")) return "rate_limited";
  if (m.includes("threads_keyword_search") || m.includes("threads_manage_replies") || m.includes("threads_read_replies") || m.includes("permission") || m.includes("subcode\":10") || /\(403\)/.test(m)) return "permission";
  if (/\(401\)/.test(m) || m.includes("oauthexception") || m.includes("expired") || m.includes("\"code\":190")) return "auth";
  if (m.includes("fetch failed") || m.includes("network") || m.includes("timed out") || m.includes("etimedout") || m.includes("econnreset") || /\(5\d{2}\)/.test(m)) return "network";
  return "unknown";
}

/** 複数の失敗から、利用者が対処すべきものを1つ選ぶ（深刻な順） */
const SEVERITY: ThreadsErrorKind[] = ["auth", "permission", "rate_limited", "network", "unknown"];
export function worstError(kinds: ThreadsErrorKind[]): ThreadsErrorKind | null {
  for (const k of SEVERITY) if (kinds.includes(k)) return k;
  return null;
}

/** 例外から失敗種別を判定する */
export function classifyError(e: unknown): ThreadsErrorKind {
  return classifyThreadsError(e instanceof Error ? e.message : String(e));
}
