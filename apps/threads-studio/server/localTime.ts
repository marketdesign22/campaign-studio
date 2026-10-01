/**
 * アカウントのタイムゾーンでの日付計算（純粋関数）。
 * scheduler.ts から切り出したもので、レポート集計などスケジューラ以外からも使う。
 * scheduler.ts は従来どおり同じ名前で再エクスポートしている。
 */
export type Tz = "LA" | "JP" | "ET" | "CT" | "MT";

export const TZ_NAMES: Record<Tz, string> = {
  LA: "America/Los_Angeles",
  JP: "Asia/Tokyo",
  ET: "America/New_York",
  CT: "America/Chicago",
  MT: "America/Denver",
};

export type LocalParts = { dateStr: string; hour: number; minute: number };

/** アカウントのタイムゾーンでの現在日付・時刻 */
export function getLocalParts(now: Date, tz: Tz): LocalParts {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ_NAMES[tz],
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));
  return {
    dateStr: `${parts.year}-${parts.month}-${parts.day}`,
    // Intl may return "24" for midnight in some engines
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
  };
}

/** ローカル日付 dateStr の 0:00〜24:00 に対応する UTC 範囲 */
export function localDayUtcRange(dateStr: string, tz: Tz): { start: Date; end: Date } {
  // Determine the UTC offset in effect on that local date by probing noon UTC
  // (safe from DST transitions which happen in the early morning).
  const probe = new Date(`${dateStr}T12:00:00Z`);
  const local = getLocalParts(probe, tz);
  // offsetMinutes = local time - UTC time at the probe instant
  const probeMinutes = 12 * 60;
  let localMinutes = local.hour * 60 + local.minute;
  // local date may differ from probe date (JP is ahead)
  if (local.dateStr > dateStr) localMinutes += 24 * 60;
  else if (local.dateStr < dateStr) localMinutes -= 24 * 60;
  const offsetMinutes = localMinutes - probeMinutes;
  const startUtcMs = Date.parse(`${dateStr}T00:00:00Z`) - offsetMinutes * 60 * 1000;
  return { start: new Date(startUtcMs), end: new Date(startUtcMs + 24 * 60 * 60 * 1000) };
}
