import { describe, expect, it } from "vitest";
import {
  achievementRate, average, datesOfMonth, engagementRate, pctChange, shiftYearMonth, sumEngagements,
} from "./report";

describe("月次レポートの計算", () => {
  it("反応数は5指標の合計", () => {
    expect(sumEngagements({ likes: 10, replies: 2, reposts: 3, quotes: 1, shares: 4 })).toBe(20);
  });

  it("反応率は 反応数 ÷ 閲覧数 の %。閲覧数 0・不明は null（0% とは区別）", () => {
    expect(engagementRate(20, 1000)).toBeCloseTo(2);
    expect(engagementRate(0, 1000)).toBe(0);
    expect(engagementRate(20, 0)).toBeNull();
    expect(engagementRate(20, null)).toBeNull();
    expect(engagementRate(null, 1000)).toBeNull();
  });

  it("前月比は前月が無い・0 なら null。減少は負、増加は正", () => {
    expect(pctChange(120, 100)).toBeCloseTo(20);
    expect(pctChange(80, 100)).toBeCloseTo(-20);
    expect(pctChange(-2, -4)).toBeCloseTo(50); // フォロワー純増がマイナス同士でも符号が意味を保つ
    expect(pctChange(100, 0)).toBeNull();
    expect(pctChange(100, null)).toBeNull();
    expect(pctChange(null, 100)).toBeNull();
  });

  it("達成率は目標未設定・0 なら null", () => {
    expect(achievementRate(1500, 1000)).toBeCloseTo(150);
    expect(achievementRate(0, 1000)).toBe(0);
    expect(achievementRate(1500, null)).toBeNull();
    expect(achievementRate(1500, 0)).toBeNull();
    expect(achievementRate(null, 1000)).toBeNull();
  });

  it("平均は件数 0 で null", () => {
    expect(average([])).toBeNull();
    expect(average([10, 20])).toBe(15);
  });

  it("年月の前後と日付列", () => {
    expect(shiftYearMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftYearMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftYearMonth("2026-09", -11)).toBe("2025-10");
    expect(datesOfMonth("2026-02")).toHaveLength(28);
    expect(datesOfMonth("2028-02")).toHaveLength(29);
    expect(datesOfMonth("2026-09")[0]).toBe("2026-09-01");
  });
});
