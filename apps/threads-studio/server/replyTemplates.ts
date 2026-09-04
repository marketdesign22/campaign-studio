/**
 * 受信箱: キーワードに一致した返信へ、登録済みの定型文を提案する。
 *
 * - 提案はあくまで案。マッチしても自動では送信しない
 * - 実際に送るのは、利用者が受信箱で「この内容で送信」を押した時だけ
 *   （server/routers/replies.ts の `reply` — 通常の手動返信と全く同じ経路を通る）
 * - 一致判定はこのアプリの中だけで完結する（Threads側に自動応答の設定はしない）
 */

export const MAX_TEMPLATES_PER_ACCOUNT = 20;
export const MAX_KEYWORDS_PER_TEMPLATE = 10;

export type ReplyTemplateRule = {
  id: number;
  keywords: string[];
  replyText: string;
  enabled: boolean;
};

/**
 * 本文に一致するキーワードを持つ、最初の有効なテンプレートを返す。
 * 大文字小文字は区別しない部分一致。登録順（id昇順）で最初に一致したものを採用する。
 * 一致が無ければ null。
 */
export function matchReplyTemplate(text: string, templates: ReplyTemplateRule[]): ReplyTemplateRule | null {
  const lower = text.toLowerCase();
  for (const t of templates) {
    if (!t.enabled) continue;
    if (t.keywords.some((k) => k.trim() && lower.includes(k.toLowerCase()))) return t;
  }
  return null;
}

/** DBのJSON列（キーワード配列）を読む。壊れていても空配列にする */
export function parseTemplateKeywords(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x.trim()) : [];
  } catch {
    return [];
  }
}
