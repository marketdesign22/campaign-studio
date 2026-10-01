/**
 * 月次レポートの集計（AIを使わない決定論的処理）。
 *
 * - 日付はすべてアカウントのタイムゾーンで切る（月の境界・日次・曜日×時間帯）
 * - 「データが無い」は 0 ではなく null。画面では「—」になる
 * - 閲覧数・反応数は「その月に公開した投稿」の最新値を合計する（投稿ベース）。
 *   日次推移の閲覧数だけはアカウント全体の日次インサイト（別ソース）を使う
 * - 投稿本文は冒頭だけ持つ（印刷と AI 入力用。全文は保存しない）
 */
import type { Account } from "../drizzle/schema";
import type { AccountScope } from "./accountScope";
import {
  getAccountSettings, listAccountInsightsDaily, listCampaignsForAccount, listCategories, listConversionEvents,
  listConversionGoals, listFollowerSnapshots, listKpiTargets, listReportPosts, type ReportPostRow,
} from "./db";
import { getLocalParts, localDayUtcRange, TZ_NAMES, type Tz } from "./localTime";
import { primaryTimezone } from "@shared/postingSlots";
import { netChange } from "@shared/followerStats";
import {
  achievementRate, average, datesOfMonth, engagementRate, KPI_KEYS, pctChange, shiftYearMonth, sumEngagements,
  yearMonthOf, type ConversionGroup, type DailyRow, type GroupRow, type HeatmapCell, type KpiKey, type KpiRow,
  type MonthlyRow, type ReportData, type ReportPost,
} from "@shared/report";

/** 投稿ランキングの対象にする最低閲覧数（少数の閲覧で率が跳ねるのを避ける） */
export const RANKING_MIN_VIEWS = 50;
/** 改善余地の一覧を出す最低対象件数 */
export const BOTTOM_MIN_POSTS = 10;
export const RANKING_SIZE = 5;
export const MONTHS_IN_TREND = 12;
export const EXCERPT_LENGTH = 60;
export const NOTE_MIN_POSTS = 5;

type ConversionEventRow = { eventType: string; eventTime: Date; quantity: number; valueCents: number | null; conversionGoalId: number | null; campaignId: number | null; campaign: string | null };

type MonthStats = {
  posts: number;
  views: number | null;
  engagements: number | null;
  engagementRate: number | null;
  followerNet: number | null;
  linkClicks: number | null;
  conversions: number | null;
  /** 反応データが無い投稿の数（注記用） */
  postsWithoutAnalytics: number;
};

const excerpt = (content: string) => {
  const flat = content.replace(/\s+/g, " ").trim();
  const chars = Array.from(flat);
  return chars.length > EXCERPT_LENGTH ? chars.slice(0, EXCERPT_LENGTH).join("") + "…" : flat;
};

/** 投稿群の閲覧・反応の合計。反応データのある投稿が1件も無ければ null */
function totals(rows: ReportPostRow[]): { views: number | null; engagements: number | null; measured: number } {
  const measured = rows.filter((r) => r.analytics !== null);
  if (measured.length === 0) return { views: null, engagements: null, measured: 0 };
  let views = 0, engagements = 0;
  for (const r of measured) {
    views += r.analytics!.views;
    engagements += sumEngagements(r.analytics!);
  }
  return { views, engagements, measured: measured.length };
}

function groupRow(name: string, rows: ReportPostRow[]): GroupRow {
  const t = totals(rows);
  return {
    name, posts: rows.length, views: t.views, engagements: t.engagements,
    engagementRate: engagementRate(t.engagements, t.views),
    avgViews: t.measured > 0 && t.views !== null ? t.views / t.measured : null,
  };
}

function toReportPost(r: ReportPostRow): ReportPost {
  const a = r.analytics!;
  const engagements = sumEngagements(a);
  return {
    logId: r.logId, excerpt: excerpt(r.content), postedAt: r.postedAt.toISOString(),
    views: a.views, engagements, engagementRate: engagementRate(engagements, a.views),
    likes: a.likes, replies: a.replies, reposts: a.reposts, quotes: a.quotes, shares: a.shares,
  };
}

/** 月の UTC 範囲（アカウントのタイムゾーンで 1日 0:00 〜 翌月 1日 0:00） */
export function monthUtcRange(yearMonth: string, tz: Tz): { start: Date; end: Date } {
  return {
    start: localDayUtcRange(`${yearMonth}-01`, tz).start,
    end: localDayUtcRange(`${shiftYearMonth(yearMonth, 1)}-01`, tz).start,
  };
}

/** フォロワー純増: 月末の最新値 − 月初以前で最も近い値。基準が無ければ月内の最初との差（1点なら null） */
export function followerNetForMonth(snapshots: { capturedDate: string; followerCount: number }[], yearMonth: string): number | null {
  const inMonth = snapshots.filter((s) => s.capturedDate.startsWith(yearMonth));
  const before = [...snapshots].filter((s) => s.capturedDate < `${yearMonth}-01`).sort((a, b) => a.capturedDate.localeCompare(b.capturedDate));
  const baseline = before[before.length - 1] ?? null;
  return netChange(inMonth, baseline).change;
}

export async function buildReportData(account: Account, scope: AccountScope, year: number, month: number, now: Date = new Date()): Promise<ReportData> {
  const tz = primaryTimezone(account) as Tz;
  const target = yearMonthOf(year, month);
  const months = Array.from({ length: MONTHS_IN_TREND }, (_, i) => shiftYearMonth(target, i - (MONTHS_IN_TREND - 1)));
  const earliest = months[0];
  const range = { start: monthUtcRange(earliest, tz).start, end: monthUtcRange(target, tz).end };
  const dates = datesOfMonth(target);

  const [rows, snapshots, insights, events, targetRows, cfg, categories, campaignRows, goals] = await Promise.all([
    listReportPosts(scope, range.start, range.end),
    listFollowerSnapshots(account.id),
    listAccountInsightsDaily(account.id, dates[0], dates[dates.length - 1]),
    listConversionEvents(account.id, range.start, range.end) as Promise<ConversionEventRow[]>,
    listKpiTargets(account.id, earliest, target),
    getAccountSettings(account.id),
    listCategories(scope),
    listCampaignsForAccount(account.id),
    listConversionGoals(account.id),
  ]);

  const localDate = (d: Date) => getLocalParts(d, tz).dateStr;
  const byMonth = new Map<string, ReportPostRow[]>();
  for (const r of rows) {
    const ym = localDate(r.postedAt).slice(0, 7);
    byMonth.set(ym, [...(byMonth.get(ym) ?? []), r]);
  }
  const eventsByMonth = new Map<string, ConversionEventRow[]>();
  for (const e of events) {
    const ym = localDate(e.eventTime).slice(0, 7);
    eventsByMonth.set(ym, [...(eventsByMonth.get(ym) ?? []), e]);
  }
  const targetsByMonth = new Map<string, Partial<Record<KpiKey, number>>>();
  for (const t of targetRows) {
    targetsByMonth.set(t.yearMonth, { ...(targetsByMonth.get(t.yearMonth) ?? {}), [t.metric]: t.target });
  }
  const tracking = cfg.conversionTrackingEnabled;

  const monthStats = (ym: string): MonthStats => {
    const posts = byMonth.get(ym) ?? [];
    const t = totals(posts);
    const evs = eventsByMonth.get(ym) ?? [];
    return {
      posts: posts.length,
      views: t.views,
      engagements: t.engagements,
      engagementRate: engagementRate(t.engagements, t.views),
      followerNet: followerNetForMonth(snapshots, ym),
      linkClicks: tracking ? evs.filter((e) => e.eventType === "link_click").reduce((n, e) => n + e.quantity, 0) : null,
      conversions: tracking ? evs.filter((e) => e.eventType !== "link_click").reduce((n, e) => n + e.quantity, 0) : null,
      postsWithoutAnalytics: posts.length - t.measured,
    };
  };

  const current = monthStats(target);
  const previousYm = shiftYearMonth(target, -1);
  const previous = monthStats(previousYm);
  const targets = targetsByMonth.get(target) ?? {};
  const hasPreviousData = (byMonth.get(previousYm)?.length ?? 0) > 0 || snapshots.some((s) => s.capturedDate.startsWith(previousYm));

  const kpiValue = (s: MonthStats, key: KpiKey): number | null => (key === "posts" ? s.posts : s[key]);
  const kpis: KpiRow[] = KPI_KEYS.map((key) => {
    const cur = kpiValue(current, key);
    const prev = hasPreviousData ? kpiValue(previous, key) : null;
    const tgt = targets[key] ?? null;
    return { key, current: cur, previous: prev, target: tgt, pctChange: pctChange(cur, prev), achievement: achievementRate(cur, tgt) };
  });

  const monthly: MonthlyRow[] = months.map((ym) => {
    const s = monthStats(ym);
    return {
      yearMonth: ym, posts: s.posts, views: s.views, engagements: s.engagements, engagementRate: s.engagementRate,
      followerNet: s.followerNet, linkClicks: s.linkClicks, conversions: s.conversions,
      viewsTarget: targetsByMonth.get(ym)?.views ?? null,
    };
  });

  const monthPosts = byMonth.get(target) ?? [];
  const postsByDate = new Map<string, number>();
  for (const r of monthPosts) {
    const d = localDate(r.postedAt);
    postsByDate.set(d, (postsByDate.get(d) ?? 0) + 1);
  }
  const insightByDate = new Map(insights.map((i) => [i.date, i]));
  const followerByDate = new Map(snapshots.map((s) => [s.capturedDate, s.followerCount]));
  const daily: DailyRow[] = dates.map((date) => ({
    date,
    posts: postsByDate.get(date) ?? 0,
    views: insightByDate.get(date)?.views ?? null,
    followers: followerByDate.get(date) ?? null,
    clicks: insightByDate.get(date)?.clicks ?? null,
  }));

  const ranked = monthPosts
    .filter((r) => r.analytics !== null && r.analytics.views >= RANKING_MIN_VIEWS)
    .map(toReportPost)
    .sort((a, b) => (b.engagementRate ?? 0) - (a.engagementRate ?? 0) || b.views - a.views);
  const topPosts = ranked.slice(0, RANKING_SIZE);
  const bottomPosts = ranked.length >= BOTTOM_MIN_POSTS ? [...ranked].reverse().slice(0, RANKING_SIZE) : [];

  const categoryName = new Map(categories.map((c) => [c.id, c.name]));
  const groupBy = (keyOf: (r: ReportPostRow) => string) => {
    const groups = new Map<string, ReportPostRow[]>();
    for (const r of monthPosts) { const k = keyOf(r); groups.set(k, [...(groups.get(k) ?? []), r]); }
    return Array.from(groups.entries()).map(([name, rs]) => groupRow(name, rs)).sort((a, b) => (b.views ?? -1) - (a.views ?? -1) || b.posts - a.posts);
  };
  const byCategory = groupBy((r) => (r.categoryId !== null ? categoryName.get(r.categoryId) ?? "その他" : "未分類"));
  const campaignName = new Map(campaignRows.map((c) => [c.id, c.name]));
  const byCampaign = monthPosts.some((r) => r.campaignId !== null)
    ? groupBy((r) => (r.campaignId !== null ? campaignName.get(r.campaignId) ?? "その他" : "キャンペーンなし"))
    : [];

  const cells = new Map<string, ReportPostRow[]>();
  for (const r of monthPosts) {
    const local = getLocalParts(r.postedAt, tz);
    const weekday = new Date(`${local.dateStr}T00:00:00Z`).getUTCDay();
    const k = `${weekday}-${local.hour}`;
    cells.set(k, [...(cells.get(k) ?? []), r]);
  }
  const heatmap: HeatmapCell[] = Array.from(cells.entries()).map(([k, rs]) => {
    const [weekday, hour] = k.split("-").map(Number);
    const t = totals(rs);
    return {
      weekday, hour, posts: rs.length,
      avgViews: average(rs.filter((r) => r.analytics).map((r) => r.analytics!.views)),
      engagementRate: engagementRate(t.engagements, t.views),
    };
  }).sort((a, b) => a.weekday - b.weekday || a.hour - b.hour);

  const monthEvents = eventsByMonth.get(target) ?? [];
  const conversionGroup = (name: string, evs: ConversionEventRow[]): ConversionGroup => ({
    name,
    linkClicks: evs.filter((e) => e.eventType === "link_click").reduce((n, e) => n + e.quantity, 0),
    conversions: evs.filter((e) => e.eventType !== "link_click").reduce((n, e) => n + e.quantity, 0),
    valueCents: evs.reduce((n, e) => n + (e.valueCents ?? 0), 0),
  });
  const goalName = new Map(goals.map((g) => [g.id, g.name]));
  const byGoal = tracking
    ? Array.from(new Set(monthEvents.map((e) => e.conversionGoalId).filter((id): id is number => id !== null)))
        .map((id) => conversionGroup(goalName.get(id) ?? "その他", monthEvents.filter((e) => e.conversionGoalId === id)))
    : [];
  const eventCampaign = (e: ConversionEventRow) => (e.campaignId !== null ? campaignName.get(e.campaignId) ?? null : null) ?? e.campaign;
  const byEventCampaign = tracking
    ? Array.from(new Set(monthEvents.map(eventCampaign).filter((c): c is string => !!c)))
        .map((c) => conversionGroup(c, monthEvents.filter((e) => eventCampaign(e) === c)))
    : [];

  const notes: string[] = [];
  if (snapshots.length === 0) notes.push("フォロワー数の履歴がまだありません。フォロワー純増は算出していません。");
  if (insights.length === 0) notes.push("アカウント全体の日次インサイト（閲覧・クリック）が未取得です。日次推移の閲覧数は表示していません。");
  if (!hasPreviousData) notes.push("前月のデータが無いため、前月比は算出していません。");
  if (current.posts < NOTE_MIN_POSTS) notes.push(`当月の投稿が${current.posts}件と少ないため、傾向の断定は避けてください。`);
  if (Object.keys(targets).length === 0) notes.push("目標値が未設定です。達成率は算出していません。");
  if (current.postsWithoutAnalytics > 0) notes.push(`反応データが未取得の投稿が${current.postsWithoutAnalytics}件あります（閲覧数・反応数には含まれていません）。`);
  if (!tracking) notes.push("コンバージョン計測が無効のため、リンククリック・コンバージョンは算出していません。");

  return {
    accountName: account.name,
    yearMonth: target,
    period: { from: dates[0], to: dates[dates.length - 1] },
    timezone: TZ_NAMES[tz],
    generatedAt: now.toISOString(),
    kpis, monthly, daily, topPosts, bottomPosts, byCategory, byCampaign, heatmap,
    conversions: {
      trackingEnabled: tracking,
      linkClicks: current.linkClicks,
      conversions: current.conversions,
      valueCents: tracking ? monthEvents.reduce((n, e) => n + (e.valueCents ?? 0), 0) : null,
      byGoal, byCampaign: byEventCampaign,
    },
    notes,
  };
}
