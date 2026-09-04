/**
 * 原稿編集のバリデーション。
 * 画面とサーバーで同じ判定を使えるよう、副作用のない関数だけを置く。
 */

export const MAX_POST_LENGTH = 500;
/** これを超えたら警告色。上限に達したらエラー色 */
export const WARN_POST_LENGTH = 450;

/**
 * 投稿本文の文字数。
 *
 * 日本語・英語・改行・絵文字で判定を揃えるため、UTF-16のコード単位ではなく
 * コードポイントで数える（`"👍".length` は2だが1文字として扱う）。
 */
export function countChars(text: string): number {
  return Array.from(text).length;
}

export type LengthState = "ok" | "warn" | "error";

export function lengthState(text: string): LengthState {
  const n = countChars(text);
  if (n >= MAX_POST_LENGTH) return "error";
  if (n >= WARN_POST_LENGTH) return "warn";
  return "ok";
}

/** 空白・改行だけの本文は保存させない */
export function isBlank(text: string): boolean {
  return text.trim().length === 0;
}

export function canSave(text: string): boolean {
  return !isBlank(text) && countChars(text) <= MAX_POST_LENGTH;
}

/** YYYY-MM-DD として妥当か（存在しない日付も弾く） */
export function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export type DraftIssue =
  | { kind: "blank" }
  | { kind: "too_long"; count: number }
  | { kind: "invalid_date" }
  | { kind: "past_date" }
  | { kind: "slot_taken"; postId: number };

export type DraftInput = {
  content: string;
  scheduledDate: string;
  slotIndex: number;
  /** 編集中の原稿ID。重複判定で自分自身を除くのに使う */
  editingId?: number | null;
};

export type ExistingPost = {
  id: number;
  status: string;
  scheduledDate: string | null;
  slotIndex: number;
};

/**
 * 保存前の検証。
 *
 * `blank` と `too_long` は保存を止める。`past_date` と `slot_taken` は
 * 警告として返すだけで保存自体は妨げない（過去日での投稿や意図的な重ねを
 * 運用側が選べるようにするため）。
 */
export function validateDraft(
  input: DraftInput,
  existing: ExistingPost[],
  today: string
): DraftIssue[] {
  const issues: DraftIssue[] = [];
  if (isBlank(input.content)) issues.push({ kind: "blank" });
  const count = countChars(input.content);
  if (count > MAX_POST_LENGTH) issues.push({ kind: "too_long", count });

  if (input.scheduledDate) {
    if (!isValidDate(input.scheduledDate)) {
      issues.push({ kind: "invalid_date" });
    } else {
      if (input.scheduledDate < today) issues.push({ kind: "past_date" });
      const clash = existing.find(
        (p) =>
          p.id !== input.editingId &&
          p.status === "pending" &&
          p.scheduledDate === input.scheduledDate &&
          p.slotIndex === input.slotIndex
      );
      if (clash) issues.push({ kind: "slot_taken", postId: clash.id });
    }
  }
  return issues;
}

/** 保存を止める種類の問題があるか */
export function isBlocking(issues: DraftIssue[]): boolean {
  return issues.some((i) => i.kind === "blank" || i.kind === "too_long" || i.kind === "invalid_date");
}

/** 入力に未保存の変更があるか（閉じる前の確認に使う） */
export function isDirty(a: DraftInput & { imageUrl: string | null }, b: DraftInput & { imageUrl: string | null }): boolean {
  return (
    a.content !== b.content ||
    a.scheduledDate !== b.scheduledDate ||
    a.slotIndex !== b.slotIndex ||
    a.imageUrl !== b.imageUrl
  );
}
