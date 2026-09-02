/**
 * 投稿枠（スロット）の定義。
 *
 * 1アカウントに複数の投稿枠を持たせ、**枠ごとにタイムゾーンを指定**できる。
 * 「日本時間の朝夕」と「太平洋時間の朝夕」を同じアカウントで運用する、
 * といった使い方のため。
 *
 * 枠ごとにタイムゾーンを持つ理由: JSTには夏時間が無く、PTにはある。
 * 片方のタイムゾーンに固定して時刻を並べると、もう片方が年2回1時間ずれる。
 */

export type SlotTimezone = "LA" | "JP" | "ET" | "CT" | "MT";

export type PostingSlot = {
  hour: number;
  minute: number;
  timezone: SlotTimezone;
};

/** 原稿側の slotIndex が 0〜5 を想定しているため、枠数もそれに合わせる */
export const MAX_SLOTS = 6;

const TIMEZONES: SlotTimezone[] = ["LA", "JP", "ET", "CT", "MT"];

/** 一覧表示用の短いラベル（例: PT / JST） */
export const TZ_SHORT: Record<SlotTimezone, string> = {
  LA: "PT",
  JP: "JST",
  ET: "ET",
  CT: "CT",
  MT: "MT",
};

function isSlot(v: unknown): v is PostingSlot {
  if (typeof v !== "object" || v === null) return false;
  const s = v as Record<string, unknown>;
  return (
    typeof s.hour === "number" && Number.isInteger(s.hour) && s.hour >= 0 && s.hour <= 23 &&
    typeof s.minute === "number" && Number.isInteger(s.minute) && s.minute >= 0 && s.minute <= 59 &&
    typeof s.timezone === "string" && TIMEZONES.includes(s.timezone as SlotTimezone)
  );
}

/**
 * DBに入っているJSON文字列を枠の配列にする。
 * 壊れていた場合は null を返し、呼び出し側が従来の朝夕設定にフォールバックする
 * （設定が読めないという理由で投稿が止まらないようにする）。
 */
export function parseSlots(raw: string | null | undefined): PostingSlot[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    const slots = parsed.slice(0, MAX_SLOTS).filter(isSlot);
    return slots.length > 0 ? slots : null;
  } catch {
    return null;
  }
}

export function serializeSlots(slots: PostingSlot[]): string {
  return JSON.stringify(slots.slice(0, MAX_SLOTS));
}

/** 枠設定を持たないアカウント（＝この機能より前からあるもの）の形 */
export type LegacySchedule = {
  slots?: string | null;
  morningHour: number;
  morningMinute: number;
  eveningHour: number;
  eveningMinute: number;
  timezone: SlotTimezone;
};

/**
 * このアカウントの投稿枠を確定する。
 * `slots` が未設定なら、従来の「朝・夕＋アカウントのタイムゾーン」から組み立てる。
 * これにより、DBを書き換えなくても既存アカウントは今まで通り動く。
 */
export function resolveSlots(account: LegacySchedule): PostingSlot[] {
  return (
    parseSlots(account.slots) ?? [
      { hour: account.morningHour, minute: account.morningMinute, timezone: account.timezone },
      { hour: account.eveningHour, minute: account.eveningMinute, timezone: account.timezone },
    ]
  );
}

/**
 * アカウントの基準タイムゾーン。
 * カレンダーや配信在庫の「今日」を決めるのに使う。最初の枠のものを採用する。
 */
export function primaryTimezone(account: LegacySchedule): SlotTimezone {
  return resolveSlots(account)[0]?.timezone ?? account.timezone;
}

/** 「12:00 JST」のような表示ラベル */
export function formatSlot(slot: PostingSlot): string {
  const hh = String(slot.hour).padStart(2, "0");
  const mm = String(slot.minute).padStart(2, "0");
  return `${hh}:${mm} ${TZ_SHORT[slot.timezone]}`;
}
