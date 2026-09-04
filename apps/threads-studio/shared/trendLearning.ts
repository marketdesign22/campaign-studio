/**
 * 学習サイクル（7日）の集計。純粋関数なのでそのままテストできる。
 *
 * - トレンド反映の原稿と未反映の原稿を、同じ指標で並べて比べる
 * - 分析値が無い投稿は平均に含めない（0扱いにしない）
 * - 文章は返さず、数値と分類だけを返す。表示文は画面側で組み立てる
 */

export type OutcomeInput = {
  usedTrend: boolean;
  /** 原稿に付けた反映情報（JSON文字列）。referencedTrends を主題として数える */
  trendMeta: string | null;
  /** 投稿時刻（アカウントのローカル時刻の「時」） */
  localHour: number;
  likes: number | null;
  replies: number | null;
  reposts: number | null;
  views: number | null;
  hasAnalytics: boolean;
};

export type GroupStat = {
  posts: number;
  /** 分析値が取れている投稿数。平均はこの件数で割る */
  measured: number;
  avgViews: number | null;
  avgEngagement: number | null;
};

export type Suggestion =
  | { kind: "not_enough_data"; posts: number }
  | { kind: "no_analytics"; posts: number }
  | { kind: "trend_vs_other"; trendAvg: number; otherAvg: number; trendN: number; otherN: number; ratio: number }
  | { kind: "best_hour"; hour: number; avg: number; posts: number }
  | { kind: "top_theme"; theme: string; avg: number; posts: number }
  | { kind: "next_theme"; theme: string; posts: number; avg: number };

export type Recommendations = {
  trend: GroupStat;
  other: GroupStat;
  byHour: { hour: number; posts: number; avgEngagement: number | null }[];
  byTheme: { theme: string; posts: number; avgEngagement: number | null }[];
  suggestions: Suggestion[];
};

/** いいね＋返信＋再投稿。1つでも取れていれば合計、全て未取得なら null */
export function engagementOf(o: Pick<OutcomeInput, "likes" | "replies" | "reposts" | "hasAnalytics">): number | null {
  if (!o.hasAnalytics) return null;
  const vals = [o.likes, o.replies, o.reposts].filter((v): v is number => typeof v === "number");
  return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10;
}

function groupStat(items: OutcomeInput[]): GroupStat {
  const measured = items.filter((i) => i.hasAnalytics);
  return {
    posts: items.length,
    measured: measured.length,
    avgViews: mean(measured.map((i) => i.views).filter((v): v is number => typeof v === "number")),
    avgEngagement: mean(measured.map(engagementOf).filter((v): v is number => v !== null)),
  };
}

export function themesOf(trendMeta: string | null): string[] {
  if (!trendMeta) return [];
  try {
    const v = JSON.parse(trendMeta) as { referencedTrends?: unknown };
    return Array.isArray(v.referencedTrends)
      ? v.referencedTrends.filter((x): x is string => typeof x === "string" && !!x.trim()).map((x) => x.trim())
      : [];
  } catch {
    return [];
  }
}

/** 最低この件数が無いと比較を出さない（1件の偶然で結論を出させない） */
export const MIN_SAMPLE = 3;

export function buildRecommendations(items: OutcomeInput[]): Recommendations {
  const trendItems = items.filter((i) => i.usedTrend);
  const otherItems = items.filter((i) => !i.usedTrend);
  const trend = groupStat(trendItems);
  const other = groupStat(otherItems);

  // 時間帯別
  const hourMap = new Map<number, OutcomeInput[]>();
  for (const i of items) {
    const list = hourMap.get(i.localHour) ?? [];
    list.push(i);
    hourMap.set(i.localHour, list);
  }
  const byHour = Array.from(hourMap.entries())
    .map(([hour, list]) => ({ hour, posts: list.length, avgEngagement: groupStat(list).avgEngagement }))
    .sort((a, b) => a.hour - b.hour);

  // 主題別（トレンド反映の原稿だけが主題を持つ）
  const themeMap = new Map<string, OutcomeInput[]>();
  for (const i of trendItems) {
    for (const th of themesOf(i.trendMeta)) {
      const list = themeMap.get(th) ?? [];
      list.push(i);
      themeMap.set(th, list);
    }
  }
  const byTheme = Array.from(themeMap.entries())
    .map(([theme, list]) => ({ theme, posts: list.length, avgEngagement: groupStat(list).avgEngagement }))
    .sort((a, b) => (b.avgEngagement ?? -1) - (a.avgEngagement ?? -1))
    .slice(0, 8);

  const suggestions: Suggestion[] = [];
  if (items.length < MIN_SAMPLE) {
    suggestions.push({ kind: "not_enough_data", posts: items.length });
    return { trend, other, byHour, byTheme, suggestions };
  }
  if (trend.measured + other.measured === 0) {
    suggestions.push({ kind: "no_analytics", posts: items.length });
    return { trend, other, byHour, byTheme, suggestions };
  }

  if (
    trend.avgEngagement !== null && other.avgEngagement !== null &&
    trend.measured >= MIN_SAMPLE && other.measured >= MIN_SAMPLE
  ) {
    const ratio = other.avgEngagement > 0
      ? Math.round((trend.avgEngagement / other.avgEngagement) * 100) / 100
      : trend.avgEngagement > 0 ? Infinity : 1;
    suggestions.push({
      kind: "trend_vs_other",
      trendAvg: trend.avgEngagement, otherAvg: other.avgEngagement,
      trendN: trend.measured, otherN: other.measured,
      ratio: Number.isFinite(ratio) ? ratio : 99,
    });
  }

  const bestHour = byHour
    .filter((h) => h.avgEngagement !== null && h.posts >= MIN_SAMPLE)
    .sort((a, b) => (b.avgEngagement ?? 0) - (a.avgEngagement ?? 0))[0];
  if (bestHour && bestHour.avgEngagement !== null) {
    suggestions.push({ kind: "best_hour", hour: bestHour.hour, avg: bestHour.avgEngagement, posts: bestHour.posts });
  }

  const topTheme = byTheme.find((th) => th.avgEngagement !== null && th.posts >= 2);
  if (topTheme && topTheme.avgEngagement !== null) {
    suggestions.push({ kind: "top_theme", theme: topTheme.theme, avg: topTheme.avgEngagement, posts: topTheme.posts });
    suggestions.push({ kind: "next_theme", theme: topTheme.theme, posts: topTheme.posts, avg: topTheme.avgEngagement });
  }

  return { trend, other, byHour, byTheme, suggestions };
}

/**
 * 参考URLの解釈。ThreadsとInstagramの公開投稿URLだけを受け付ける。
 * 取得はしない（Instagramはスクレイピングしない）。IDと投稿者名を取り出すだけ。
 */
export function parseReferenceUrl(input: string):
  | { platform: "threads" | "instagram"; externalId: string; username: string | null; permalink: string }
  | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  const host = url.hostname.replace(/^www\./, "");
  const parts = url.pathname.split("/").filter(Boolean);
  if (host === "threads.net" || host === "threads.com") {
    // /@user/post/CODE
    const i = parts.indexOf("post");
    if (i === -1 || !parts[i + 1]) return null;
    const user = parts[0]?.startsWith("@") ? parts[0].slice(1) : null;
    const code = parts[i + 1];
    if (!/^[A-Za-z0-9_-]{5,40}$/.test(code)) return null;
    return { platform: "threads", externalId: `shortcode:${code}`, username: user, permalink: `https://www.threads.net${url.pathname}` };
  }
  if (host === "instagram.com") {
    // /p/CODE, /reel/CODE, /user/p/CODE
    const i = parts.findIndex((p) => p === "p" || p === "reel" || p === "reels");
    if (i === -1 || !parts[i + 1]) return null;
    const code = parts[i + 1];
    if (!/^[A-Za-z0-9_-]{5,40}$/.test(code)) return null;
    const user = i > 0 ? parts[0] : null;
    return { platform: "instagram", externalId: `shortcode:${code}`, username: user, permalink: `https://www.instagram.com${url.pathname}` };
  }
  return null;
}
