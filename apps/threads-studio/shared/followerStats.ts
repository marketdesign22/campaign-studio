/**
 * フォロワー数の増減計算。
 *
 * Threads Insights の followers_count は「現在の総数」しか返さないので、
 * 増減は日次スナップショットの差分から求める。純粋関数にしてテスト可能にしている。
 *
 * 「データが無い」と「増減が0」を必ず区別する。前者は null、後者は 0。
 */

export type Snapshot = { capturedDate: string; followerCount: number };

export type FollowerPoint = {
  date: string;
  /** その日の総フォロワー数 */
  followers: number;
  /** 前日（＝1つ前のスナップショット）からの増減。基準が無ければ null */
  dailyChange: number | null;
  /** 期間開始時点からの純増減。基準が無ければ null */
  sinceStart: number | null;
};

/** 同じ日付が複数あれば最後のものを残す（重複計上を防ぐ） */
export function dedupeByDate(snapshots: Snapshot[]): Snapshot[] {
  const byDate = new Map<string, Snapshot>();
  for (const s of snapshots) byDate.set(s.capturedDate, s);
  return Array.from(byDate.values()).sort((a, b) => a.capturedDate.localeCompare(b.capturedDate));
}

/**
 * 期間中の純増減。
 *
 * 原則: 期間末の最新値 − 期間開始以前で最も近いスナップショット。
 * 期間開始以前のデータが無い場合は期間内の最初のスナップショットとの差分を使い、
 * `approximate: true`（画面では「参考値」）を立てる。
 * 比較対象が1点しか無ければ増減は求められないので null を返す。
 */
export function netChange(
  inPeriod: Snapshot[],
  baseline?: Snapshot | null
): { change: number | null; approximate: boolean } {
  const rows = dedupeByDate(inPeriod);
  const last = rows[rows.length - 1];
  if (!last) return { change: null, approximate: false };
  if (baseline) return { change: last.followerCount - baseline.followerCount, approximate: false };
  const first = rows[0];
  if (rows.length < 2 || !first) return { change: null, approximate: false };
  return { change: last.followerCount - first.followerCount, approximate: true };
}

/** グラフ用の系列。総数・前日比・期間開始比をまとめて持たせる */
export function buildSeries(inPeriod: Snapshot[], baseline?: Snapshot | null): FollowerPoint[] {
  const rows = dedupeByDate(inPeriod);
  const start = baseline?.followerCount ?? rows[0]?.followerCount ?? null;
  return rows.map((row, i) => {
    const prev = i === 0 ? baseline?.followerCount ?? null : rows[i - 1].followerCount;
    return {
      date: row.capturedDate,
      followers: row.followerCount,
      dailyChange: prev === null ? null : row.followerCount - prev,
      // 期間開始比: 基準が baseline ならその差、無ければ期間内先頭からの差
      sinceStart: start === null ? null : row.followerCount - start,
    };
  });
}

/** +8 / −3 / ±0 / — の表示。色だけに頼らず符号で増減が分かるようにする */
export function formatDelta(change: number | null): string {
  if (change === null) return "—";
  if (change === 0) return "±0";
  return change > 0 ? `+${change.toLocaleString()}` : `−${Math.abs(change).toLocaleString()}`;
}
