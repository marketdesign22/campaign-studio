import type {
  ReportConfig,
  ReportData,
  ReportPost,
  Breakdown,
  MetricKey,
} from "@shared/monthlyReport";
import { metricKeys, metricLabels } from "@shared/monthlyReport";

export const REPORT_TIMEZONES = {
  LA: "America/Los_Angeles",
  JP: "Asia/Tokyo",
  ET: "America/New_York",
  CT: "America/Chicago",
  MT: "America/Denver",
};
export function localReportParts(date: Date, timezone: string) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .map(p => [p.type, p.value])
  );
  const day = `${p.year}-${p.month}-${p.day}`;
  return {
    date: day,
    hour: Number(p.hour),
    weekday: new Date(`${day}T12:00:00Z`).getUTCDay(),
  };
}
export function shiftMonth(month: string, offset: number) {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + offset, 1)).toISOString().slice(0, 7);
}
export function shiftDay(day: string, offset: number) {
  return new Date(Date.parse(`${day}T12:00:00Z`) + offset * 86400000)
    .toISOString()
    .slice(0, 10);
}
// Iteratively resolve local midnight; month boundaries use their own offsets (DST safe).
export function reportMonthRange(month: string, timezone: string) {
  const midnight = (ym: string) => {
    const target = Date.parse(`${ym}-01T00:00:00Z`);
    let time = target;
    for (let i = 0; i < 4; i++) {
      const p = localReportParts(new Date(time), timezone);
      const represented = Date.parse(
        `${p.date}T${String(p.hour).padStart(2, "0")}:00:00Z`
      );
      time += target - represented;
    }
    return new Date(time);
  };
  return { from: midnight(month), to: midnight(shiftMonth(month, 1)) };
}
export const reportRate = (reactions: number, views: number): number | null =>
  views > 0 ? (reactions / views) * 100 : null;
export function reportTotals(posts: ReportPost[]) {
  const measured = posts.filter(
    p =>
      p.views !== null &&
      p.likes !== null &&
      p.replies !== null &&
      p.reposts !== null
  );
  const views = measured.reduce((n, p) => n + p.views!, 0);
  const reactions = measured.reduce(
    (n, p) => n + p.likes! + p.replies! + p.reposts!,
    0
  );
  return {
    posts: posts.length,
    measured: measured.length,
    views: measured.length ? views : null,
    engagementRate: measured.length ? reportRate(reactions, views) : null,
  };
}
function breakdown(
  posts: ReportPost[],
  key: "category" | "campaign" | "purpose"
): Breakdown[] {
  return Array.from(new Set(posts.map(p => p[key])))
    .map(name => {
      const group = posts.filter(p => p[key] === name);
      const t = reportTotals(group);
      const values = group
        .flatMap(p => (p.views === null ? [] : [p.views]))
        .sort((a, b) => a - b);
      const m = Math.floor(values.length / 2);
      return {
        name,
        posts: group.length,
        measured: t.measured,
        views: t.views,
        rate: t.engagementRate,
        medianViews: values.length
          ? values.length % 2
            ? values[m]
            : (values[m - 1] + values[m]) / 2
          : null,
      };
    })
    .sort((a, b) => (b.views ?? -1) - (a.views ?? -1));
}
export type ReportEvent = {
  eventType: string;
  quantity: number;
  campaign: string | null;
};
const businessTypes = new Set([
  "inquiry",
  "booking",
  "lead",
  "purchase",
  "custom",
]);
export function reportBusiness(
  events: ReportEvent[],
  complete: boolean
): ReportData["business"] {
  const converted = events.filter(e => businessTypes.has(e.eventType));
  const sum = (list: ReportEvent[]) => list.reduce((n, e) => n + e.quantity, 0);
  const clickEvents = events.filter(e => e.eventType === "link_click");
  return {
    complete,
    events: events.length,
    clicks: clickEvents.length || complete ? sum(clickEvents) : null,
    conversions: converted.length || complete ? sum(converted) : null,
    byType: Array.from(new Set(converted.map(e => e.eventType))).map(name => ({
      name,
      count: sum(converted.filter(e => e.eventType === name)),
    })),
    byCampaign: Array.from(
      new Set(converted.map(e => e.campaign ?? "未分類"))
    ).map(name => ({
      name,
      count: sum(converted.filter(e => (e.campaign ?? "未分類") === name)),
    })),
  };
}
export function followerGrowth(
  rows: Array<{ date: string; count: number }>,
  month: string,
  endDay: string
) {
  const base = rows.find(r => r.date === shiftDay(`${month}-01`, -1));
  const end = rows.find(r => r.date === endDay);
  return base && end ? end.count - base.count : null;
}
export function buildReportData(input: {
  accountId: number;
  accountName: string;
  month: string;
  timezone: string;
  config: ReportConfig;
  previousConfig: ReportConfig;
  posts: ReportPost[];
  followers: Array<{ date: string; count: number }>;
  events: ReportEvent[];
  previousEvents: ReportEvent[];
  observations: ReportData["observations"];
  now?: Date;
}): ReportData {
  const now = input.now ?? new Date();
  const today = localReportParts(now, input.timezone).date;
  const provisional = input.month >= today.slice(0, 7);
  const previousMonth = shiftMonth(input.month, -1);
  const current = input.posts.filter(p => p.date.startsWith(input.month));
  const previous = input.posts.filter(p => p.date.startsWith(previousMonth));
  const totals = reportTotals(current),
    prev = reportTotals(previous);
  const endDay = provisional
    ? today
    : shiftDay(`${shiftMonth(input.month, 1)}-01`, -1);
  const business = reportBusiness(
    input.events,
    input.config.conversionComplete
  );
  const previousBusiness = reportBusiness(
    input.previousEvents,
    input.previousConfig.conversionComplete
  );
  const curr: Record<MetricKey, number | null> = {
    ...totals,
    followerGrowth: followerGrowth(input.followers, input.month, endDay),
    conversions: business.conversions,
  };
  const prior: Record<MetricKey, number | null> = {
    ...prev,
    followerGrowth: followerGrowth(
      input.followers,
      previousMonth,
      shiftDay(`${input.month}-01`, -1)
    ),
    conversions: previousBusiness.conversions,
  };
  const kpis = metricKeys.map(key => {
    const target = input.config.targets[key];
    const a = curr[key],
      b = prior[key];
    // Incomplete cohorts / partial conversion tracking must not receive a performance verdict.
    const complete =
      key === "views" || key === "engagementRate"
        ? totals.measured === totals.posts && prev.measured === prev.posts
        : key === "conversions"
          ? business.complete && previousBusiness.complete
          : true;
    const comparable = !provisional && complete && a !== null && b !== null;
    const currentComplete =
      key === "views" || key === "engagementRate"
        ? totals.measured === totals.posts
        : key === "conversions"
          ? business.complete
          : true;
    return {
      key,
      label: metricLabels[key],
      current: a,
      previous: b,
      target,
      achievement:
        a !== null && target !== null && target > 0 && currentComplete
          ? (a / target) * 100
          : null,
      change: comparable && b! > 0 ? ((a! - b!) / b!) * 100 : null,
      delta: comparable ? a! - b! : null,
    };
  });
  const rankable = current
    .filter(p => p.views !== null && p.views >= 50 && p.rate !== null)
    .sort((a, b) => b.rate! - a.rate! || b.views! - a.views! || a.id - b.id);
  const top = rankable.slice(0, 5);
  const topIds = new Set(top.map(p => p.id));
  const bottom = rankable
    .filter(p => !topIds.has(p.id))
    .slice(-5)
    .reverse();
  const fetches = current
    .flatMap(p => (p.fetchedAt ? [p.fetchedAt] : []))
    .sort();
  const stale = current.filter(
    p => p.fetchedAt && now.getTime() - Date.parse(p.fetchedAt) > 48 * 3600000
  ).length;
  const warnings = [
    "投稿数はこのアプリの公開履歴に記録された投稿が対象です。Threads上の全投稿を網羅するとは限りません。",
    "ビューは対象月に公開した投稿の取得時点の累計です。月内発生数・ユニーク到達人数ではありません。前月との投稿経過日数は異なります。",
    "ERは（いいね＋返信＋リポスト）÷ビュー×100。引用・シェアは含みません。",
    ...(provisional
      ? ["月途中の速報です。前月全体との増減評価は表示しません。"]
      : []),
    ...(totals.measured < totals.posts
      ? [
          `インサイト未取得の投稿が${totals.posts - totals.measured}件あります。ビュー・ERは取得分のみです。`,
        ]
      : []),
    ...(stale
      ? [
          `取得から時間が経過した投稿が${stale}件あります。取得日時を確認してください。`,
        ]
      : []),
    ...(current.length < 5
      ? ["投稿数が少ないため、要因分析は参考傾向です。"]
      : []),
    ...(curr.followerGrowth === null
      ? ["月初基準または期末のフォロワー記録が不足し、純増は算出できません。"]
      : []),
    ...(!business.complete
      ? [
          "事業成果は登録分のみ。未登録と実績ゼロを区別し、計測が完全でない期間は達成率を表示しません。",
        ]
      : []),
    "登録済み成果には複数の成果種別が含まれます。同一人物の複数行動を含む可能性があり、ユニーク顧客数・出願数とは限りません。",
  ];
  const daily = [];
  for (
    let day = `${input.month}-01`;
    day < `${shiftMonth(input.month, 1)}-01` && day <= today;
    day = shiftDay(day, 1)
  )
    daily.push({
      date: day,
      posts: current.filter(p => p.date === day).length,
    });
  return {
    version: 1,
    accountId: input.accountId,
    accountName: input.accountName,
    month: input.month,
    timezone: input.timezone,
    generatedAt: now.toISOString(),
    provisional,
    config: input.config,
    kpis,
    coverage: {
      posts: current.length,
      measured: totals.measured,
      stale,
      earliestFetch: fetches[0] ?? null,
      latestFetch: fetches.at(-1) ?? null,
    },
    warnings,
    posts: current,
    top,
    bottom,
    categories: breakdown(current, "category"),
    campaigns: breakdown(current, "campaign"),
    purposes: breakdown(current, "purpose"),
    heatmap: Array.from(
      new Set(current.map(p => `${p.weekday}:${p.hour}`))
    ).map(key => {
      const [weekday, hour] = key.split(":").map(Number);
      const group = current.filter(
        p => p.weekday === weekday && p.hour === hour
      );
      return {
        weekday,
        hour,
        posts: group.length,
        rate: reportTotals(group).engagementRate,
      };
    }),
    followers: input.followers.filter(
      r => r.date.startsWith(input.month) && r.date <= today
    ),
    daily,
    observations: input.observations,
    business,
  };
}
