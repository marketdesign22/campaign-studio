import { describe, expect, it } from "vitest";
import { assertHttpUrl, buildUtmUrl, calculateConversionMetrics, safePercent } from "./conversion";

describe("コンバージョン計測の純粋ロジック", () => {
  it("既存クエリとフラグメントを保ち、重複UTMを置き換える", () => {
    const output = buildUtmUrl("https://example.com/商品?q=既存&utm_source=old#詳細", {
      source: "threads_account_2", medium: "organic_social", campaign: "秋 キャンペーン", content: "原稿案A",
    });
    const url = new URL(output);
    expect(url.origin).toBe("https://example.com");
    expect(decodeURIComponent(url.pathname)).toBe("/商品");
    expect(url.searchParams.get("q")).toBe("既存");
    expect(url.searchParams.getAll("utm_source")).toEqual(["threads_account_2"]);
    expect(url.searchParams.get("utm_campaign")).toBe("秋 キャンペーン");
    expect(url.hash).toBe("#%E8%A9%B3%E7%B4%B0");
  });

  it.each(["javascript:alert(1)", "https://user:pass@example.com", "not-a-url"])("危険または無効なURLを拒否する: %s", (value) => {
    expect(() => assertHttpUrl(value)).toThrow();
  });

  it("分母0と未取得をnullにし、実測0とは区別する", () => {
    expect(safePercent(0, 100)).toBe(0);
    expect(safePercent(1, 0)).toBeNull();
    expect(safePercent(1, null)).toBeNull();
    expect(calculateConversionMetrics({ views: 200, clicks: 20, conversions: 2, valueCents: 12_345 })).toEqual({
      views: 200, clicks: 20, conversions: 2, valueCents: 12_345,
      clickRate: 10, conversionRate: 10, postResultRate: 1,
    });
  });
});
