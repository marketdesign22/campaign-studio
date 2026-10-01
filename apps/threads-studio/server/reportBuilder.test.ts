/**
 * 月次レポートの集計。DB はモックし、計算と「無いものは null」のルールを検証する。
 *
 * - 日付はアカウントのタイムゾーン（JP）で切る（UTC の月末深夜の投稿は翌月扱い）
 * - データが無い指標は 0 ではなく null。注記が正しく付く
 * - TOP5 / 改善余地のしきい値（閲覧50以上・対象10件以上）
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Account } from "../drizzle/schema";

vi.mock("./db", () => ({
  getAccountSettings: vi.fn(),
  listAccountInsightsDaily: vi.fn(),
  listCampaignsForAccount: vi.fn(),
  listCategories: vi.fn(),
  listConversionEvents: vi.fn(),
  listConversionGoals: vi.fn(),
  listFollowerSnapshots: vi.fn(),
  listKpiTargets: vi.fn(),
  listReportPosts: vi.fn(),
}));

import * as db from "./db";
import { buildReportData, followerNetForMonth, monthUtcRange } from "./reportBuilder";

const account = {
  id: 7, name: "SCSU.Japan", threadsUserId: "u7", threadsAccessToken: "TOKEN-NEVER-LEAK",
  tokenRefreshedAt: null, tokenExpiresAt: null, morningHour: 8, morningMinute: 0, eveningHour: 18, eveningMinute: 0,
  timezone: "JP", slots: null, active: true, lastReplyFetchAt: null, lastReplyFetchError: null, threadsUsername: null,
  createdAt: new Date(), updatedAt: new Date(),
} as Account;
const scope = { accountId: 7, includeLegacy: false };

type Analytics = { likes: number; replies: number; reposts: number; quotes: number; shares: number; views: number };
function post(logId: number, postedAt: string, analytics: Analytics | null, extra: Partial<{ categoryId: number | null; campaignId: number | null; content: string }> = {}) {
  return { logId, content: extra.content ?? `投稿${logId} `.repeat(20), postedAt: new Date(postedAt), categoryId: extra.categoryId ?? null, campaignId: extra.campaignId ?? null, analytics };
}
const a = (views: number, likes = 10): Analytics => ({ likes, replies: 2, reposts: 1, quotes: 1, shares: 1, views });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(db.getAccountSettings).mockResolvedValue({ conversionTrackingEnabled: true } as never);
  vi.mocked(db.listAccountInsightsDaily).mockResolvedValue([]);
  vi.mocked(db.listCampaignsForAccount).mockResolvedValue([]);
  vi.mocked(db.listCategories).mockResolvedValue([]);
  vi.mocked(db.listConversionEvents).mockResolvedValue([]);
  vi.mocked(db.listConversionGoals).mockResolvedValue([]);
  vi.mocked(db.listFollowerSnapshots).mockResolvedValue([]);
  vi.mocked(db.listKpiTargets).mockResolvedValue([]);
  vi.mocked(db.listReportPosts).mockResolvedValue([]);
});

describe("monthUtcRange / followerNetForMonth", () => {
  it("月の境界はアカウントのタイムゾーンで切る（JST の 9/1 0:00 = 8/31 15:00Z）", () => {
    const r = monthUtcRange("2026-09", "JP");
    expect(r.start.toISOString()).toBe("2026-08-31T15:00:00.000Z");
    expect(r.end.toISOString()).toBe("2026-09-30T15:00:00.000Z");
  });

  it("フォロワー純増は月末の値 − 前月末以前の直近値。基準が無ければ月内の最初との差、1点なら null", () => {
    const snaps = [
      { capturedDate: "2026-08-30", followerCount: 100 },
      { capturedDate: "2026-09-05", followerCount: 110 },
      { capturedDate: "2026-09-29", followerCount: 125 },
    ];
    expect(followerNetForMonth(snaps, "2026-09")).toBe(25);
    expect(followerNetForMonth(snaps.slice(1), "2026-09")).toBe(15);
    expect(followerNetForMonth(snaps.slice(2), "2026-09")).toBeNull();
    expect(followerNetForMonth(snaps, "2026-10")).toBeNull();
  });
});

describe("buildReportData", () => {
  it("データが何も無い月は全指標 null、注記がそろい、投稿一覧は空", async () => {
    const data = await buildReportData(account, scope, 2026, 9, new Date("2026-10-01T00:00:00Z"));
    expect(data.yearMonth).toBe("2026-09");
    expect(data.period).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(data.timezone).toBe("Asia/Tokyo");
    const byKey = Object.fromEntries(data.kpis.map((k) => [k.key, k]));
    expect(byKey.posts.current).toBe(0);
    expect(byKey.views.current).toBeNull();
    expect(byKey.engagementRate.current).toBeNull();
    expect(byKey.followerNet.current).toBeNull();
    // CV計測は有効なので件数は 0（計測していて 0 件）
    expect(byKey.linkClicks.current).toBe(0);
    expect(byKey.views.pctChange).toBeNull();
    expect(byKey.views.achievement).toBeNull();
    expect(data.daily).toHaveLength(30);
    expect(data.daily[0]).toEqual({ date: "2026-09-01", posts: 0, views: null, followers: null, clicks: null });
    expect(data.monthly).toHaveLength(12);
    expect(data.monthly[0].yearMonth).toBe("2025-10");
    expect(data.topPosts).toEqual([]);
    expect(data.bottomPosts).toEqual([]);
    expect(data.notes.join("\n")).toContain("フォロワー数の履歴");
    expect(data.notes.join("\n")).toContain("日次インサイト");
    expect(data.notes.join("\n")).toContain("前月のデータが無い");
    expect(data.notes.join("\n")).toContain("投稿が0件");
    expect(data.notes.join("\n")).toContain("目標値が未設定");
    expect(JSON.stringify(data)).not.toContain("TOKEN-NEVER-LEAK");
  });

  it("投稿・反応・目標・前月がそろえば KPI と前月比・達成率を計算し、JST で月を切る", async () => {
    const sept = Array.from({ length: 11 }, (_, i) => post(100 + i, `2026-09-${String(i + 2).padStart(2, "0")}T03:00:00Z`, a(100 + i * 50, 10 + i), { categoryId: i % 2 ? 1 : 2 }));
    vi.mocked(db.listReportPosts).mockResolvedValue([
      ...sept,
      post(120, "2026-09-10T03:00:00Z", null), // 反応データ未取得
      post(121, "2026-09-30T23:30:00Z", a(999)), // 10/1 08:30 JST → 10月扱い
      post(90, "2026-08-15T03:00:00Z", a(1000)), // 前月
      post(91, "2026-08-20T03:00:00Z", a(1000)),
    ] as never);
    vi.mocked(db.listCategories).mockResolvedValue([{ id: 1, name: "お知らせ" }, { id: 2, name: "体験談" }] as never);
    vi.mocked(db.listKpiTargets).mockResolvedValue([{ yearMonth: "2026-09", metric: "views", target: 4000 }, { yearMonth: "2026-08", metric: "views", target: 1500 }] as never);
    vi.mocked(db.listFollowerSnapshots).mockResolvedValue([
      { capturedDate: "2026-08-31", followerCount: 200 }, { capturedDate: "2026-09-15", followerCount: 210 }, { capturedDate: "2026-09-30", followerCount: 230 },
    ] as never);
    vi.mocked(db.listAccountInsightsDaily).mockResolvedValue([{ date: "2026-09-03", views: 400, clicks: 5 }, { date: "2026-09-04", views: 380, clicks: null }] as never);
    vi.mocked(db.listConversionEvents).mockResolvedValue([
      { eventType: "link_click", eventTime: new Date("2026-09-05T00:00:00Z"), quantity: 3, valueCents: null, conversionGoalId: null, campaignId: null, campaign: "autumn" },
      { eventType: "inquiry", eventTime: new Date("2026-09-06T00:00:00Z"), quantity: 1, valueCents: 500000, conversionGoalId: 9, campaignId: null, campaign: "autumn" },
      { eventType: "inquiry", eventTime: new Date("2026-08-06T00:00:00Z"), quantity: 1, valueCents: null, conversionGoalId: 9, campaignId: null, campaign: null },
    ] as never);
    vi.mocked(db.listConversionGoals).mockResolvedValue([{ id: 9, name: "無料相談" }] as never);

    const data = await buildReportData(account, scope, 2026, 9, new Date("2026-10-01T00:00:00Z"));
    const byKey = Object.fromEntries(data.kpis.map((k) => [k.key, k]));
    // 投稿数: 11 件 + 未取得1件 = 12（10/1 JST の投稿は含まない）
    expect(byKey.posts.current).toBe(12);
    expect(byKey.posts.previous).toBe(2);
    const expectedViews = sept.reduce((n, p) => n + p.analytics!.views, 0);
    expect(byKey.views.current).toBe(expectedViews);
    expect(byKey.views.previous).toBe(2000);
    expect(byKey.views.target).toBe(4000);
    expect(byKey.views.pctChange).toBeCloseTo(((expectedViews - 2000) / 2000) * 100);
    expect(byKey.views.achievement).toBeCloseTo((expectedViews / 4000) * 100);
    const expectedEng = sept.reduce((n, p) => n + p.analytics!.likes + 5, 0);
    expect(byKey.engagements.current).toBe(expectedEng);
    expect(byKey.engagementRate.current).toBeCloseTo((expectedEng / expectedViews) * 100);
    expect(byKey.followerNet.current).toBe(30);
    expect(byKey.linkClicks.current).toBe(3);
    expect(byKey.conversions.current).toBe(1);
    expect(byKey.conversions.previous).toBe(1);

    // 月別: 対象月と前月に値、それ以前は投稿 0 で views null。目標は月ごと
    const sep = data.monthly.find((m) => m.yearMonth === "2026-09")!;
    const aug = data.monthly.find((m) => m.yearMonth === "2026-08")!;
    const jul = data.monthly.find((m) => m.yearMonth === "2026-07")!;
    expect(sep.viewsTarget).toBe(4000); expect(aug.viewsTarget).toBe(1500); expect(jul.viewsTarget).toBeNull();
    expect(jul.posts).toBe(0); expect(jul.views).toBeNull();

    // 日次: JST の日付で投稿を数え、インサイトとフォロワーは取れた日だけ値、他は null
    const d2 = data.daily.find((d) => d.date === "2026-09-02")!;
    expect(d2.posts).toBe(1);
    const d3 = data.daily.find((d) => d.date === "2026-09-03")!;
    expect(d3).toEqual({ date: "2026-09-03", posts: 1, views: 400, followers: null, clicks: 5 });
    expect(data.daily.find((d) => d.date === "2026-09-04")!.clicks).toBeNull();
    expect(data.daily.find((d) => d.date === "2026-09-15")!.followers).toBe(210);

    // TOP5 / 改善余地: 対象 11 件（≥10）なので両方出る。反応率順
    expect(data.topPosts).toHaveLength(5);
    expect(data.bottomPosts).toHaveLength(5);
    expect(data.topPosts[0].engagementRate!).toBeGreaterThanOrEqual(data.topPosts[4].engagementRate!);
    expect(data.bottomPosts[0].engagementRate!).toBeLessThanOrEqual(data.bottomPosts[4].engagementRate!);
    expect(data.topPosts[0].excerpt.length).toBeLessThanOrEqual(61);
    expect(data.topPosts.map((p) => p.logId)).not.toContain(120);

    // カテゴリー別: 名前を解決し、未分類は「未分類」
    expect(data.byCategory.map((g) => g.name).sort()).toEqual(["お知らせ", "体験談", "未分類"]);
    const uncategorized = data.byCategory.find((g) => g.name === "未分類")!;
    expect(uncategorized.posts).toBe(1);
    expect(uncategorized.views).toBeNull(); // 反応データ未取得なので null
    expect(data.byCampaign).toEqual([]); // 投稿にキャンペーンが無ければ出さない

    // 曜日×時間帯: JST 12:00 の投稿
    expect(data.heatmap.every((c) => c.hour === 12)).toBe(true);
    expect(data.heatmap.reduce((n, c) => n + c.posts, 0)).toBe(12);

    // 成果
    expect(data.conversions).toMatchObject({ trackingEnabled: true, linkClicks: 3, conversions: 1, valueCents: 500000 });
    expect(data.conversions.byGoal).toEqual([{ name: "無料相談", linkClicks: 0, conversions: 1, valueCents: 500000 }]);
    expect(data.conversions.byCampaign).toEqual([{ name: "autumn", linkClicks: 3, conversions: 1, valueCents: 500000 }]);

    // 注記: 未取得が1件、目標あり・前月あり・フォロワーあり・投稿十分
    expect(data.notes).toEqual(["反応データが未取得の投稿が1件あります（閲覧数・反応数には含まれていません）。"]);
  });

  it("改善余地は対象が10件未満なら空。閲覧50未満の投稿はランキングに入れない", async () => {
    vi.mocked(db.listReportPosts).mockResolvedValue([
      ...Array.from({ length: 6 }, (_, i) => post(i + 1, `2026-09-0${i + 1}T03:00:00Z`, a(100))),
      post(99, "2026-09-10T03:00:00Z", a(49)),
    ] as never);
    const data = await buildReportData(account, scope, 2026, 9);
    expect(data.topPosts).toHaveLength(5);
    expect(data.topPosts.map((p) => p.logId)).not.toContain(99);
    expect(data.bottomPosts).toEqual([]);
  });

  it("CV計測が無効ならリンククリック・コンバージョンは null で、注記を付ける", async () => {
    vi.mocked(db.getAccountSettings).mockResolvedValue({ conversionTrackingEnabled: false } as never);
    vi.mocked(db.listConversionEvents).mockResolvedValue([
      { eventType: "link_click", eventTime: new Date("2026-09-05T00:00:00Z"), quantity: 3, valueCents: null, conversionGoalId: null, campaignId: null, campaign: null },
    ] as never);
    const data = await buildReportData(account, scope, 2026, 9);
    const byKey = Object.fromEntries(data.kpis.map((k) => [k.key, k]));
    expect(byKey.linkClicks.current).toBeNull();
    expect(byKey.conversions.current).toBeNull();
    expect(data.conversions).toMatchObject({ trackingEnabled: false, linkClicks: null, conversions: null, valueCents: null, byGoal: [], byCampaign: [] });
    expect(data.notes.join("\n")).toContain("コンバージョン計測が無効");
  });

  it("投稿にキャンペーンがあればキャンペーン別を名前で出す", async () => {
    vi.mocked(db.listCampaignsForAccount).mockResolvedValue([{ id: 3, name: "秋の説明会" }] as never);
    vi.mocked(db.listReportPosts).mockResolvedValue([
      post(1, "2026-09-01T03:00:00Z", a(200), { campaignId: 3 }),
      post(2, "2026-09-02T03:00:00Z", a(100), { campaignId: null }),
    ] as never);
    const data = await buildReportData(account, scope, 2026, 9);
    expect(data.byCampaign.map((g) => [g.name, g.posts, g.avgViews])).toEqual([["秋の説明会", 1, 200], ["キャンペーンなし", 1, 100]]);
  });

  it("集計の読み取りは選択中アカウントのスコープ・IDだけで行う", async () => {
    await buildReportData(account, scope, 2026, 9);
    expect(db.listReportPosts).toHaveBeenCalledWith(scope, expect.any(Date), expect.any(Date));
    for (const fn of [db.listFollowerSnapshots, db.listKpiTargets, db.listConversionEvents, db.listCampaignsForAccount, db.listConversionGoals, db.listAccountInsightsDaily]) {
      expect(vi.mocked(fn).mock.calls[0][0]).toBe(7);
    }
  });
});
