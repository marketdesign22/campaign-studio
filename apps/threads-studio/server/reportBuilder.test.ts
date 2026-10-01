import { describe, it, expect } from "vitest";
import { emptyReportConfig, type ReportPost } from "@shared/monthlyReport";
import {
  buildReportData,
  followerGrowth,
  localReportParts,
  reportBusiness,
  reportMonthRange,
  reportTotals,
} from "./reportBuilder";
import { templateNarrative, validateAiNarrative } from "./reportNarrative";

const post = (
  id: number,
  views: number | null,
  likes: number | null,
  date = "2026-09-15"
): ReportPost => ({
  id,
  postId: id,
  content: "検証用投稿",
  postedAt: `${date}T12:00:00Z`,
  date,
  weekday: 2,
  hour: 5,
  category: "案内",
  campaign: "未分類",
  purpose: "認知",
  imageUrl: null,
  views,
  likes,
  replies: likes === null ? null : 0,
  reposts: likes === null ? null : 0,
  fetchedAt: views === null ? null : "2026-10-01T09:00:00Z",
  rate: views && likes !== null ? (likes / views) * 100 : null,
});
const input = () => ({
  accountId: 1,
  accountName: "Example",
  month: "2026-09",
  timezone: "America/Los_Angeles",
  config: emptyReportConfig(),
  previousConfig: emptyReportConfig(),
  posts: [post(1, 100, 10), post(2, 900, 9), post(3, 500, 10, "2026-08-10")],
  followers: [],
  events: [],
  previousEvents: [],
  observations: [],
  now: new Date("2026-10-01T10:00:00Z"),
});
describe("monthly report measurement contract", () => {
  it("resolves calendar boundaries in LA and JST including DST month offsets", () => {
    expect(reportMonthRange("2026-03", "America/Los_Angeles")).toEqual({
      from: new Date("2026-03-01T08:00:00Z"),
      to: new Date("2026-04-01T07:00:00Z"),
    });
    expect(reportMonthRange("2026-11", "America/Los_Angeles")).toEqual({
      from: new Date("2026-11-01T07:00:00Z"),
      to: new Date("2026-12-01T08:00:00Z"),
    });
    expect(reportMonthRange("2026-09", "Asia/Tokyo").from.toISOString()).toBe(
      "2026-08-31T15:00:00.000Z"
    );
    expect(
      localReportParts(new Date("2026-09-01T06:59:59Z"), "America/Los_Angeles")
        .date
    ).toBe("2026-08-31");
  });
  it("uses weighted ER, never the mean of individual rates", () => {
    expect(reportTotals(input().posts.slice(0, 2)).engagementRate).toBeCloseTo(
      1.9
    );
  });
  it("does not turn unmeasured metrics or zero-view rates into zero", () => {
    expect(reportTotals([post(1, null, null)]).views).toBeNull();
    expect(reportTotals([post(1, 0, 0)]).engagementRate).toBeNull();
  });
  it("requires exact baseline and closing records for follower growth", () => {
    const rows = [
      { date: "2026-08-30", count: 100 },
      { date: "2026-09-30", count: 120 },
    ];
    expect(followerGrowth(rows, "2026-09", "2026-09-30")).toBeNull();
    expect(
      followerGrowth(
        [...rows, { date: "2026-08-31", count: 110 }],
        "2026-09",
        "2026-09-30"
      )
    ).toBe(10);
  });
  it("does not count profile visits and follows as inquiries or sales", () => {
    expect(
      reportBusiness(
        [
          { eventType: "profile_visit", quantity: 50, campaign: null },
          { eventType: "follow", quantity: 10, campaign: null },
        ],
        false
      ).conversions
    ).toBeNull();
    expect(reportBusiness([], true).conversions).toBe(0);
    expect(reportBusiness([], false).clicks).toBeNull();
  });
  it("keeps prior totals but suppresses incomplete current-month comparisons", () => {
    const x = input();
    x.now = new Date("2026-09-30T20:00:00Z");
    const r = buildReportData(x);
    expect(r.provisional).toBe(true);
    expect(r.kpis.find(k => k.key === "views")).toMatchObject({
      current: 1000,
      previous: 500,
      change: null,
      delta: null,
    });
  });
  it("does not award target achievement for partial measured data", () => {
    const x = input();
    x.posts.push(post(4, null, null));
    x.config.targets.views = 500;
    expect(
      buildReportData(x).kpis.find(k => k.key === "views")?.achievement
    ).toBeNull();
  });
  it("reports zero previous month as delta without division by zero", () => {
    const x = input();
    x.posts = [post(1, 100, 2), post(2, 0, 0, "2026-08-01")];
    expect(buildReportData(x).kpis.find(k => k.key === "views")).toMatchObject({
      delta: 100,
      change: null,
    });
  });
  it("makes TOP/BOTTOM disjoint and excludes tiny denominators", () => {
    const x = input();
    x.posts = Array.from({ length: 12 }, (_, i) => post(i, 100, i));
    x.posts.push(post(99, 1, 1));
    const r = buildReportData(x);
    expect(r.top[0].id).toBe(11);
    expect(r.top.some(p => p.id === 99)).toBe(false);
    expect(r.bottom.some(p => r.top.some(t => t.id === p.id))).toBe(false);
  });
  it("uses client-owned reporting context without inventing absent targets", () => {
    const r = buildReportData(input());
    expect(r.kpis.every(k => k.target === null && k.achievement === null)).toBe(
      true
    );
    expect(r.business.conversions).toBeNull();
  });
  it("rejects invented numeric AI claims and invalid evidence ids", () => {
    const data = buildReportData(input());
    const n = templateNarrative(data);
    n.summary = "認知の成果を次の検証につなげます。";
    expect(() => validateAiNarrative(n, data)).not.toThrow();
    expect(() =>
      validateAiNarrative(
        { ...n, summary: "問い合わせが100件増えました。" },
        data
      )
    ).toThrow("Numeric");
    expect(() =>
      validateAiNarrative(
        {
          ...n,
          insights: [{ title: "結論", body: "内容", evidence: ["post:9999"] }],
        },
        data
      )
    ).toThrow("evidence");
  });
});
