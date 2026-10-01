/**
 * Threads Insights の解析。
 * views は values[0].value、followers_count は total_value.value で返るため、
 * どちらの形でも取れることを確かめる。
 */
import { describe, expect, it } from "vitest";
import { readDailyInsightSeries, readInsightMetric } from "./threadsApi";
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

describe("readDailyInsightSeries", () => {
  // Threads は太平洋時間の日付境界（07:00Z）を end_time に返す
  const payload = {
    data: [{
      name: "views",
      values: [
        { value: 120, end_time: "2026-09-02T07:00:00+0000" },
        { value: 95, end_time: "2026-09-03T07:00:00+0000" },
      ],
    }],
  };

  it("end_time の1秒前の日付をキーにする（UTC では end_time の日付と同じ）", () => {
    expect(readDailyInsightSeries(payload, "views")).toEqual([
      { date: "2026-09-02", value: 120 },
      { date: "2026-09-03", value: 95 },
    ]);
  });

  it("タイムゾーンを渡すとその地域の日付で切る（太平洋時間なら前日になる）", () => {
    expect(readDailyInsightSeries(payload, "views", "America/Los_Angeles")).toEqual([
      { date: "2026-09-01", value: 120 },
      { date: "2026-09-02", value: 95 },
    ]);
    // 日本時間では 16:00 なので end_time と同じ日付
    expect(readDailyInsightSeries(payload, "views", "Asia/Tokyo")[0].date).toBe("2026-09-02");
  });

  it("'+0000' 形式と ISO 形式の両方を解釈し、壊れた要素は捨てる", () => {
    const mixed = { data: [{ name: "clicks", values: [
      { value: 3, end_time: "2026-09-02T00:00:00Z" },
      { value: "x", end_time: "2026-09-03T00:00:00Z" },
      { value: 5 },
      { value: 7, end_time: "not a date" },
    ] }] };
    expect(readDailyInsightSeries(mixed, "clicks")).toEqual([{ date: "2026-09-01", value: 3 }]);
  });

  it("指標が無い・total_value しか無い応答は空配列（0 で埋めない）", () => {
    expect(readDailyInsightSeries(payload, "clicks")).toEqual([]);
    expect(readDailyInsightSeries({ data: [{ name: "views", total_value: { value: 10 } } as never] }, "views")).toEqual([]);
    expect(readDailyInsightSeries({}, "views")).toEqual([]);
  });

  it("同じ日付が重複したら後の値で上書きし、日付順に並べる", () => {
    const dup = { data: [{ name: "views", values: [
      { value: 9, end_time: "2026-09-03T00:00:00Z" },
      { value: 1, end_time: "2026-09-02T00:00:00Z" },
      { value: 2, end_time: "2026-09-02T00:00:00Z" },
    ] }] };
    expect(readDailyInsightSeries(dup, "views")).toEqual([{ date: "2026-09-01", value: 2 }, { date: "2026-09-02", value: 9 }]);
  });
});

