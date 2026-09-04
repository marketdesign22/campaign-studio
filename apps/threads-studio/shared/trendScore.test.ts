/**
 * 話題性スコアの検証。
 * 「取れない指標は 0 ではなく null」「スコアは 0〜100」「内訳は常に返る」が要点。
 */
import { describe, expect, it } from "vitest";
import { computeTrendScore, hoursSince, summarize, themeFitScore, tokenize } from "./trendScore";

const NOW = new Date("2026-09-04T12:00:00Z");
const base = {
  now: NOW,
  likes: null, replies: null, reposts: null, views: null, saves: null,
  hasReplies: null, keywordGrowth: null, themeFit: null,
};

describe("computeTrendScore", () => {
  it("すべて未取得でも落ちず、0〜100 の範囲で内訳を返す", () => {
    const r = computeTrendScore({ ...base, postedAt: null });
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(100);
    expect(r.breakdown.length).toBeGreaterThan(0);
    expect(r.breakdown.every((c) => c.available === false)).toBe(true);
  });

  it("スコアは常に 0〜100 に収まる（極端な値でも）", () => {
    const hot = computeTrendScore({
      ...base, postedAt: new Date(NOW.getTime() - 60_000),
      likes: 1e9, replies: 1e9, reposts: 1e9, views: 1e9,
      hasReplies: true, keywordGrowth: 1000, themeFit: 1,
    });
    expect(hot.score).toBeLessThanOrEqual(100);
    expect(hot.score).toBeGreaterThan(50);
    const cold = computeTrendScore({
      ...base, postedAt: new Date("2020-01-01T00:00:00Z"),
      likes: 0, replies: 0, reposts: 0, views: 0, hasReplies: false, keywordGrowth: 0, themeFit: 0,
    });
    expect(cold.score).toBeGreaterThanOrEqual(0);
  });

  it("取れない指標は内訳で available=false になり、0 と区別できる", () => {
    const missing = computeTrendScore({ ...base, postedAt: new Date(NOW.getTime() - 3_600_000) });
    const zero = computeTrendScore({
      ...base, postedAt: new Date(NOW.getTime() - 3_600_000),
      likes: 0, replies: 0, reposts: 0, views: 0,
    });
    const vel = (r: typeof missing) => r.breakdown.find((c) => c.key === "velocity")!;
    expect(vel(missing).available).toBe(false);
    expect(vel(zero).available).toBe(true);
    expect(vel(zero).points).toBe(0);
  });

  it("取れた指標だけで正規化するので、未取得が多くても新しい投稿は高く出る", () => {
    const fresh = computeTrendScore({ ...base, postedAt: new Date(NOW.getTime() - 30 * 60_000) });
    const old = computeTrendScore({ ...base, postedAt: new Date(NOW.getTime() - 5 * 86_400_000) });
    expect(fresh.score).toBeGreaterThan(old.score);
  });

  it("伸びの速さを重視する: 同じ反応数なら新しい方が高い", () => {
    const a = computeTrendScore({ ...base, postedAt: new Date(NOW.getTime() - 2 * 3_600_000), likes: 500, views: 10_000 });
    const b = computeTrendScore({ ...base, postedAt: new Date(NOW.getTime() - 48 * 3_600_000), likes: 500, views: 10_000 });
    expect(a.score).toBeGreaterThan(b.score);
    expect(a.isRising).toBe(true);
  });

  it("反応が取れなくても、キーワード出現が急増していれば急上昇と判定する", () => {
    const r = computeTrendScore({ ...base, postedAt: new Date(NOW.getTime() - 3_600_000), keywordGrowth: 3 });
    expect(r.isRising).toBe(true);
  });
});

describe("補助関数", () => {
  it("hoursSince は未来時刻でも負にならない", () => {
    expect(hoursSince(new Date(NOW.getTime() + 3_600_000), NOW)).toBe(0);
  });

  it("summarize は140文字で切る（コードポイント単位）", () => {
    expect(summarize("あ".repeat(300)).length).toBeLessThanOrEqual(141);
    expect(summarize("短い本文")).toBe("短い本文");
  });

  it("themeFitScore は過去投稿が無ければ null（0 ではない）", () => {
    expect(themeFitScore("留学の準備", [])).toBeNull();
    expect(themeFitScore("留学 準備 奨学金", ["留学 準備 費用"])).toBeGreaterThan(0);
  });

  it("tokenize は日本語と英語の両方から語を取り出す", () => {
    const set = tokenize("Study abroad 留学準備");
    expect(set.size).toBeGreaterThan(0);
  });
});
