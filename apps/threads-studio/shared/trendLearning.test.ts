/**
 * 学習サイクルの集計と、参考URLの解釈。
 */
import { describe, expect, it } from "vitest";
import { buildRecommendations, engagementOf, parseReferenceUrl, themesOf, type OutcomeInput } from "./trendLearning";

function o(p: Partial<OutcomeInput>): OutcomeInput {
  return {
    usedTrend: false, trendMeta: null, localHour: 9,
    likes: null, replies: null, reposts: null, views: null, hasAnalytics: false,
    ...p,
  };
}
const measured = (likes: number, extra: Partial<OutcomeInput> = {}) =>
  o({ likes, replies: 0, reposts: 0, views: likes * 10, hasAnalytics: true, ...extra });

describe("buildRecommendations", () => {
  it("3件未満なら比較せず、件数だけ知らせる", () => {
    const r = buildRecommendations([measured(10), measured(20)]);
    expect(r.suggestions).toEqual([{ kind: "not_enough_data", posts: 2 }]);
  });

  it("分析値の無い投稿は平均に含めない（0 として数えない）", () => {
    const r = buildRecommendations([measured(10), measured(20), o({ hasAnalytics: false })]);
    expect(r.other.posts).toBe(3);
    expect(r.other.measured).toBe(2);
    expect(r.other.avgEngagement).toBe(15);
    expect(r.other.avgViews).toBe(150);
  });

  it("全投稿の分析値が無ければ「未取得」だけを返す", () => {
    const r = buildRecommendations([o({}), o({}), o({})]);
    expect(r.other.avgEngagement).toBeNull();
    expect(r.suggestions).toEqual([{ kind: "no_analytics", posts: 3 }]);
  });

  it("トレンド反映と未反映を同じ指標で比べ、比率を数値で返す", () => {
    const meta = JSON.stringify({ referencedTrends: ["体験談"] });
    const items = [
      measured(30, { usedTrend: true, trendMeta: meta }), measured(30, { usedTrend: true, trendMeta: meta }),
      measured(30, { usedTrend: true, trendMeta: meta }),
      measured(10), measured(10), measured(10),
    ];
    const r = buildRecommendations(items);
    const cmp = r.suggestions.find((s) => s.kind === "trend_vs_other");
    expect(cmp).toEqual({ kind: "trend_vs_other", trendAvg: 30, otherAvg: 10, trendN: 3, otherN: 3, ratio: 3 });
    expect(r.byTheme[0]).toEqual({ theme: "体験談", posts: 3, avgEngagement: 30 });
    expect(r.suggestions.some((s) => s.kind === "next_theme")).toBe(true);
  });

  it("時間帯別は3件以上ある時間だけを推す", () => {
    const items = [
      measured(50, { localHour: 20 }), measured(1, { localHour: 9 }), measured(1, { localHour: 9 }), measured(1, { localHour: 9 }),
    ];
    const r = buildRecommendations(items);
    const best = r.suggestions.find((s) => s.kind === "best_hour");
    expect(best).toEqual({ kind: "best_hour", hour: 9, avg: 1, posts: 3 });
  });

  it("engagementOf は分析なしなら null", () => {
    expect(engagementOf({ likes: 5, replies: 1, reposts: 0, hasAnalytics: false })).toBeNull();
    expect(engagementOf({ likes: 5, replies: 1, reposts: null, hasAnalytics: true })).toBe(6);
  });

  it("themesOf は壊れたJSONでも空配列", () => {
    expect(themesOf("{oops")).toEqual([]);
    expect(themesOf(null)).toEqual([]);
  });
});

describe("parseReferenceUrl", () => {
  it("Threads の投稿URLを受け付ける", () => {
    const r = parseReferenceUrl("https://www.threads.net/@scsu.japan/post/C9abcDEfg12");
    expect(r).toEqual({
      platform: "threads", externalId: "shortcode:C9abcDEfg12", username: "scsu.japan",
      permalink: "https://www.threads.net/@scsu.japan/post/C9abcDEfg12",
    });
  });

  it("Instagram の投稿・リールURLを受け付ける（取得はしない）", () => {
    expect(parseReferenceUrl("https://www.instagram.com/p/C9abcDEfg12/")?.platform).toBe("instagram");
    expect(parseReferenceUrl("https://instagram.com/reel/C9abcDEfg12")?.platform).toBe("instagram");
    expect(parseReferenceUrl("https://www.instagram.com/someone/p/C9abcDEfg12/")?.username).toBe("someone");
  });

  it("それ以外のドメイン・http・不正な形式は拒否する", () => {
    expect(parseReferenceUrl("https://example.com/p/abc")).toBeNull();
    expect(parseReferenceUrl("http://www.threads.net/@a/post/C9abcDEfg12")).toBeNull();
    expect(parseReferenceUrl("https://www.threads.net/@a")).toBeNull();
    expect(parseReferenceUrl("not a url")).toBeNull();
  });
});
