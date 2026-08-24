/**
 * 予約日の割り当て計画（純粋関数・DB非依存）。
 *
 * 方針は「順番より、途切れないこと」。既に埋まっている枠を飛ばして、
 * 今日から一番近い空き枠へ順に詰めていく。
 */

/** YYYY-MM-DD に日数を足す（タイムゾーンの影響を受けないようUTCで計算） */
export function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export type SlotKey = string; // `${date}#${slotIndex}`

export const slotKey = (date: string, slotIndex: number): SlotKey => `${date}#${slotIndex}`;

export type Assignment = { id: number; scheduledDate: string; slotIndex: number };

/**
 * 未割り当ての原稿を、startDate 以降の空き枠へ順に割り当てる。
 * `occupied` には既に使われている枠（過去日は含めない）を渡す。
 */
export function planSchedule(params: {
  ids: number[];
  occupied: Iterable<SlotKey>;
  startDate: string;
  postsPerDay: number;
}): Assignment[] {
  const { ids, startDate, postsPerDay } = params;
  const taken = new Set(params.occupied);
  const perDay = Math.max(1, postsPerDay);

  const out: Assignment[] = [];
  let date = startDate;
  let slot = 0;

  const advance = () => {
    slot += 1;
    if (slot >= perDay) {
      slot = 0;
      date = addDays(date, 1);
    }
  };

  for (const id of ids) {
    while (taken.has(slotKey(date, slot))) advance();
    out.push({ id, scheduledDate: date, slotIndex: slot });
    taken.add(slotKey(date, slot));
    advance();
  }
  return out;
}

/**
 * 予約済みの「在庫」を集計する。ダッシュボード表示用。
 * 今日以降に予約が入っている日数と、最後に投稿が入っている日付を返す。
 */
export function summarizeRunway(
  scheduled: { scheduledDate: string | null; status: string }[],
  today: string
): { days: number; lastDate: string | null; gapDates: string[] } {
  const dates = new Set<string>();
  for (const p of scheduled) {
    if (p.status !== "pending" || !p.scheduledDate) continue;
    if (p.scheduledDate >= today) dates.add(p.scheduledDate);
  }
  if (dates.size === 0) return { days: 0, lastDate: null, gapDates: [] };

  const sorted = Array.from(dates).sort();
  const lastDate = sorted[sorted.length - 1];

  // 今日から最終予約日までの間で、1件も予約が無い日（＝投稿が途切れる日）
  const gapDates: string[] = [];
  for (let d = today; d <= lastDate; d = addDays(d, 1)) {
    if (!dates.has(d)) gapDates.push(d);
  }
  return { days: sorted.length, lastDate, gapDates };
}
