/**
 * フォロワー増減の計算。
 * Threads は総数しか返さないので、増減はスナップショットの差分で出す。
 * 「未取得（null）」と「増減0」を混同しないことが要件の中心。
 */
import { describe, expect, it } from "vitest";
import { buildSeries, dedupeByDate, formatDelta, netChange } from "./followerStats";

const snap = (capturedDate: string, followerCount: number) => ({ capturedDate, followerCount });

describe("重複の排除", () => {
  it("同じ日付が複数あればその日の最後の値だけを使う（二重計上しない）", () => {
    const rows = dedupeByDate([snap("2026-09-01", 100), snap("2026-09-01", 108), snap("2026-09-02", 110)]);
    expect(rows).toEqual([snap("2026-09-01", 108), snap("2026-09-02", 110)]);
  });

  it("日付順に並べ直す", () => {
    expect(dedupeByDate([snap("2026-09-03", 3), snap("2026-09-01", 1)]).map(r => r.capturedDate))
      .toEqual(["2026-09-01", "2026-09-03"]);
  });
});

describe("期間中の純増減", () => {
  const inPeriod = [snap("2026-09-01", 1200), snap("2026-09-02", 1230), snap("2026-09-03", 1250)];

  it("期間開始以前の基準があればそれとの差を使う", () => {
    expect(netChange(inPeriod, snap("2026-08-31", 1208)))
      .toEqual({ change: 42, approximate: false });
  });

  it("基準が無ければ期間内の先頭との差を使い、参考値と分かるようにする", () => {
    expect(netChange(inPeriod, null)).toEqual({ change: 50, approximate: true });
  });

  it("履歴が1件だけなら増減は計算しない（0ではなく null）", () => {
    expect(netChange([snap("2026-09-03", 1250)], null)).toEqual({ change: null, approximate: false });
  });

  it("履歴が無ければ null", () => {
    expect(netChange([], null)).toEqual({ change: null, approximate: false });
  });

  it("減少も正しく出す", () => {
    expect(netChange([snap("2026-09-02", 1190)], snap("2026-09-01", 1200)).change).toBe(-10);
  });

  it("増減0は0として返す（未取得と区別する）", () => {
    expect(netChange([snap("2026-09-02", 1200)], snap("2026-09-01", 1200)).change).toBe(0);
  });
});

describe("グラフ用の系列", () => {
  it("総数・前日比・期間開始比を持つ", () => {
    const series = buildSeries(
      [snap("2026-09-01", 1210), snap("2026-09-02", 1218), snap("2026-09-03", 1250)],
      snap("2026-08-31", 1208)
    );
    expect(series).toEqual([
      { date: "2026-09-01", followers: 1210, dailyChange: 2, sinceStart: 2 },
      { date: "2026-09-02", followers: 1218, dailyChange: 8, sinceStart: 10 },
      { date: "2026-09-03", followers: 1250, dailyChange: 32, sinceStart: 42 },
    ]);
  });

  it("基準が無い先頭の前日比は null（0にしない）", () => {
    const series = buildSeries([snap("2026-09-01", 1210), snap("2026-09-02", 1218)], null);
    expect(series[0].dailyChange).toBeNull();
    expect(series[0].sinceStart).toBe(0);
    expect(series[1].dailyChange).toBe(8);
  });
});

describe("増減の表示", () => {
  it("符号で増減が分かる（色だけに頼らない）", () => {
    expect(formatDelta(8)).toBe("+8");
    expect(formatDelta(-3)).toBe("−3");
    expect(formatDelta(0)).toBe("±0");
  });

  it("データが無い場合は — （0とは書かない）", () => {
    expect(formatDelta(null)).toBe("—");
  });

  it("桁区切りを入れる", () => {
    expect(formatDelta(1250)).toBe("+1,250");
  });
});
