/**
 * 月次レポート（クライアント提出用）の型と純粋な計算。
 *
 * サーバーの集計（server/reportBuilder.ts）と画面（client/src/pages/Report.tsx）の両方が
 * この型を使う。「データが無い」は 0 ではなく null で表し、画面では「—」で出す。
 */
import { z } from "zod";

export const KPI_KEYS = ["posts", "views", "engagements", "engagementRate", "followerNet", "linkClicks", "conversions"] as const;
export type KpiKey = (typeof KPI_KEYS)[number];

export const KPI_LABELS: Record<KpiKey, string> = {
  posts: "投稿数",
  views: "閲覧数",
  engagements: "反応数",
  engagementRate: "反応率",
  followerNet: "フォロワー純増",
  linkClicks: "リンククリック",
  conversions: "コンバージョン",
};

/** 比率で表す指標（画面で % を付ける） */
export const PERCENT_KPIS: ReadonlySet<KpiKey> = new Set<KpiKey>(["engagementRate"]);

export type KpiRow = {
  key: KpiKey;
  current: number | null;
  previous: number | null;
  target: number | null;
  /** 前月比 %。前月が無い・0 なら null */
  pctChange: number | null;
  /** 目標達成率 %。目標が無い・0 なら null */
  achievement: number | null;
};

export type MonthlyRow = {
  yearMonth: string;
  posts: number;
  views: number | null;
  engagements: number | null;
  engagementRate: number | null;
  followerNet: number | null;
  linkClicks: number | null;
  conversions: number | null;
  viewsTarget: number | null;
};

export type DailyRow = {
  date: string;
  posts: number;
  /** アカウント全体のその日の閲覧数（Threads アカウントインサイト）。未取得は null */
  views: number | null;
  followers: number | null;
  clicks: number | null;
};

export type ReportPost = {
  logId: number;
  /** 本文の冒頭（印刷と AI 入力用。全文は持たない） */
  excerpt: string;
  postedAt: string;
  views: number;
  engagements: number;
  engagementRate: number | null;
  likes: number;
  replies: number;
  reposts: number;
  quotes: number;
  shares: number;
};

export type GroupRow = {
  name: string;
  posts: number;
  views: number | null;
  engagements: number | null;
  engagementRate: number | null;
  avgViews: number | null;
};

export type HeatmapCell = {
  /** 0=日曜 … 6=土曜（アカウントのタイムゾーン） */
  weekday: number;
  hour: number;
  posts: number;
  avgViews: number | null;
  engagementRate: number | null;
};

export type ConversionGroup = { name: string; linkClicks: number; conversions: number; valueCents: number };

export type ConversionSummary = {
  /** CV計測が無効なアカウントでは false。このとき件数は null */
  trackingEnabled: boolean;
  linkClicks: number | null;
  conversions: number | null;
  valueCents: number | null;
  byGoal: ConversionGroup[];
  byCampaign: ConversionGroup[];
};

export type ReportData = {
  accountName: string;
  yearMonth: string;
  /** アカウントのタイムゾーンでの対象期間（両端含む、YYYY-MM-DD） */
  period: { from: string; to: string };
  timezone: string;
  generatedAt: string;
  kpis: KpiRow[];
  monthly: MonthlyRow[];
  daily: DailyRow[];
  topPosts: ReportPost[];
  bottomPosts: ReportPost[];
  byCategory: GroupRow[];
  byCampaign: GroupRow[];
  heatmap: HeatmapCell[];
  conversions: ConversionSummary;
  /** 解釈上の注意（日本語）。空なら注記なし */
  notes: string[];
};

export const REPORT_STATUSES = ["draft", "reviewed", "sent"] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export const narrativeSchema = z.object({
  summary: z.string().trim().min(1).max(2000),
  highlights: z.array(z.string().trim().min(1).max(500)).max(10),
  issues: z.array(z.string().trim().min(1).max(500)).max(10),
  actions: z.array(z.object({
    title: z.string().trim().min(1).max(120),
    detail: z.string().trim().min(1).max(800),
  })).max(8),
});
export type ReportNarrative = z.infer<typeof narrativeSchema>;

// ── 計算（純粋関数） ──────────────────────────────────────────────────────────

export type EngagementParts = { likes: number; replies: number; reposts: number; quotes: number; shares: number };

/** 反応数 = いいね + 返信 + 再投稿 + 引用 + シェア */
export function sumEngagements(v: EngagementParts): number {
  return v.likes + v.replies + v.reposts + v.quotes + v.shares;
}

/** 反応率（%）= 反応数 ÷ 閲覧数。閲覧数が 0 または不明なら null（0% とは区別する） */
export function engagementRate(engagements: number | null, views: number | null): number | null {
  if (engagements === null || views === null || views <= 0) return null;
  return (engagements / views) * 100;
}

/** 前月比（%）。前月が不明または 0 なら比較できないので null */
export function pctChange(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

/** 目標達成率（%）。目標が未設定または 0 なら null */
export function achievementRate(current: number | null, target: number | null): number | null {
  if (current === null || target === null || target <= 0) return null;
  return (current / target) * 100;
}

/** 平均。件数 0 なら null */
export function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function yearMonthOf(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

export function parseYearMonth(ym: string): { year: number; month: number } {
  const m = /^(\d{4})-(\d{2})$/.exec(ym);
  if (!m) throw new Error(`invalid yearMonth: ${ym}`);
  return { year: Number(m[1]), month: Number(m[2]) };
}

/** n か月前（n=1 で前月）。 */
export function shiftYearMonth(ym: string, deltaMonths: number): string {
  const { year, month } = parseYearMonth(ym);
  const index = year * 12 + (month - 1) + deltaMonths;
  return yearMonthOf(Math.floor(index / 12), (index % 12 + 12) % 12 + 1);
}

/** 月の日数 */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** YYYY-MM の各日（YYYY-MM-DD）の配列 */
export function datesOfMonth(ym: string): string[] {
  const { year, month } = parseYearMonth(ym);
  return Array.from({ length: daysInMonth(year, month) }, (_, i) => `${ym}-${String(i + 1).padStart(2, "0")}`);
}
