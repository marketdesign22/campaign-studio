import { z } from "zod";

export const reportMonthSchema = z.string().regex(/^20\d{2}-(0[1-9]|1[0-2])$/);
export const metricKeys = [
  "posts",
  "views",
  "engagementRate",
  "followerGrowth",
  "conversions",
] as const;
export const metricLabels: Record<MetricKey, string> = {
  posts: "公開投稿数",
  views: "対象投稿の累計ビュー",
  engagementRate: "エンゲージメント率",
  followerGrowth: "フォロワー純増",
  conversions: "登録済み事業成果",
};
export type MetricKey = (typeof metricKeys)[number];
export const reportConfigSchema = z.object({
  clientName: z.string().trim().max(120).default(""),
  authorName: z.string().trim().max(120).default(""),
  objective: z.string().trim().max(600).default(""),
  notes: z.string().trim().max(3000).default(""),
  conversionComplete: z.boolean().default(false),
  autoGenerate: z.boolean().default(false),
  targets: z.object(
    Object.fromEntries(
      metricKeys.map(k => [
        k,
        z.number().finite().min(0).max(1e12).nullable().default(null),
      ])
    ) as Record<MetricKey, z.ZodDefault<z.ZodNullable<z.ZodNumber>>>
  ),
});
export type ReportConfig = z.infer<typeof reportConfigSchema>;
export const emptyReportConfig = (): ReportConfig =>
  reportConfigSchema.parse({ targets: {} });
export const narrativeSchema = z.object({
  summary: z.string().min(1).max(1800),
  insights: z
    .array(
      z.object({
        title: z.string().min(1).max(120),
        body: z.string().min(1).max(1000),
        evidence: z.array(z.string().max(100)).min(1).max(6),
      })
    )
    .min(1)
    .max(5),
  actions: z
    .array(
      z.object({
        title: z.string().min(1).max(120),
        action: z.string().min(1).max(1000),
        measurement: z.string().min(1).max(400),
      })
    )
    .length(3),
});
export type ReportNarrative = z.infer<typeof narrativeSchema>;
export type ReportPost = {
  id: number;
  postId: number | null;
  content: string;
  postedAt: string;
  date: string;
  weekday: number;
  hour: number;
  category: string;
  campaign: string;
  purpose: string;
  imageUrl: string | null;
  views: number | null;
  likes: number | null;
  replies: number | null;
  reposts: number | null;
  fetchedAt: string | null;
  rate: number | null;
};
export type Breakdown = {
  name: string;
  posts: number;
  measured: number;
  views: number | null;
  medianViews: number | null;
  rate: number | null;
};
export type ReportData = {
  version: 1;
  accountId: number;
  accountName: string;
  month: string;
  timezone: string;
  generatedAt: string;
  provisional: boolean;
  config: ReportConfig;
  kpis: Array<{
    key: MetricKey;
    label: string;
    current: number | null;
    previous: number | null;
    target: number | null;
    achievement: number | null;
    change: number | null;
    delta: number | null;
  }>;
  coverage: {
    posts: number;
    measured: number;
    stale: number;
    earliestFetch: string | null;
    latestFetch: string | null;
  };
  warnings: string[];
  posts: ReportPost[];
  top: ReportPost[];
  bottom: ReportPost[];
  categories: Breakdown[];
  campaigns: Breakdown[];
  purposes: Breakdown[];
  heatmap: Array<{
    weekday: number;
    hour: number;
    posts: number;
    rate: number | null;
  }>;
  followers: Array<{ date: string; count: number }>;
  daily: Array<{ date: string; posts: number }>;
  observations: Array<{
    date: string;
    measured: number;
    views: number | null;
    rate: number | null;
  }>;
  business: {
    complete: boolean;
    events: number;
    clicks: number | null;
    conversions: number | null;
    byType: Array<{ name: string; count: number }>;
    byCampaign: Array<{ name: string; count: number }>;
  };
};
export type SavedReport = {
  id: string;
  status: "draft" | "reviewed" | "sent";
  revision: number;
  generatedAt: string;
  reviewedAt: string | null;
  sentAt: string | null;
  narrativeSource: "template" | "ai" | "edited";
  data: ReportData;
  narrative: ReportNarrative;
};
export function formatReportValue(value: number | null, key?: MetricKey) {
  return value === null
    ? "未取得"
    : `${value.toLocaleString("ja-JP", { maximumFractionDigits: key === "engagementRate" ? 2 : 0 })}${key === "engagementRate" ? "%" : ""}`;
}
