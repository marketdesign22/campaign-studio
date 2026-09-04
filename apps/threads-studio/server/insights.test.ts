/**
 * Threads Insights の解析。
 * views は values[0].value、followers_count は total_value.value で返るため、
 * どちらの形でも取れることを確かめる。
 */
import { describe, expect, it } from "vitest";
import { readInsightMetric } from "./threadsApi";
import { engagementRate } from "./db";

describe("readInsightMetric", () => {
  it("values[0].value 形式を読む（views の日次）", () => {
    const payload = { data: [{ name: "views", values: [{ value: 8120 }] }] };
    expect(readInsightMetric(payload, "views")).toBe(8120);
  });

  it("total_value.value 形式を読む（followers_count の生涯合計）", () => {
    const payload = { data: [{ name: "followers_count", total_value: { value: 1250 } }] };
    expect(readInsightMetric(payload, "followers_count")).toBe(1250);
  });

  it("両方ある場合は values を優先する", () => {
    const payload = { data: [{ name: "views", values: [{ value: 10 }], total_value: { value: 99 } }] };
    expect(readInsightMetric(payload, "views")).toBe(10);
  });

  it("0 をそのまま 0 として返す（未取得と区別する）", () => {
    expect(readInsightMetric({ data: [{ name: "views", total_value: { value: 0 } }] }, "views")).toBe(0);
  });

  it("メトリクスが無ければ null（0にしない）", () => {
    expect(readInsightMetric({ data: [{ name: "likes", values: [{ value: 3 }] }] }, "views")).toBeNull();
    expect(readInsightMetric({}, "views")).toBeNull();
    expect(readInsightMetric({ data: [] }, "followers_count")).toBeNull();
  });

  it("値が数値でなければ null", () => {
    const payload = { data: [{ name: "views", values: [{}] }] } as never;
    expect(readInsightMetric(payload, "views")).toBeNull();
  });
});

describe("エンゲージメント率", () => {
  it("(いいね + 返信 + リポスト) / インプレッション × 100", () => {
    expect(engagementRate({ totalLikes: 30, totalReplies: 10, totalReposts: 10, totalViews: 1000 }))
      .toBeCloseTo(5);
  });

  it("インプレッションが0でも壊れない（NaN/Infinityにしない）", () => {
    const rate = engagementRate({ totalLikes: 5, totalReplies: 0, totalReposts: 0, totalViews: 0 });
    expect(rate).toBe(0);
    expect(Number.isFinite(rate)).toBe(true);
    expect(rate.toFixed(2)).toBe("0.00");
  });

  it("エンゲージメントが0なら0%", () => {
    expect(engagementRate({ totalLikes: 0, totalReplies: 0, totalReposts: 0, totalViews: 500 })).toBe(0);
  });
});
