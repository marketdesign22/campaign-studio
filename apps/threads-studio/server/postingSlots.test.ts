/**
 * 投稿枠の解決。
 *
 * 「日本時間の朝夕」と「太平洋時間の朝夕」を1アカウントで運用できるようにした
 * ときの中核。既存アカウント（枠未設定）が今まで通り動くことも確かめる。
 */
import { describe, expect, it } from "vitest";
import {
  formatSlot, MAX_SLOTS, parseSlots, primaryTimezone, resolveSlots, serializeSlots,
} from "@shared/postingSlots";

/** 枠を設定していない、従来からのアカウント */
const legacy = {
  slots: null,
  morningHour: 8, morningMinute: 0,
  eveningHour: 18, eveningMinute: 30,
  timezone: "LA" as const,
};

describe("resolveSlots", () => {
  it("枠未設定のアカウントは従来の朝夕2枠として扱う", () => {
    expect(resolveSlots(legacy)).toEqual([
      { hour: 8, minute: 0, timezone: "LA" },
      { hour: 18, minute: 30, timezone: "LA" },
    ]);
  });

  it("枠ごとに別のタイムゾーンを持てる（JSTの朝夕 + PTの朝夕）", () => {
    const slots = [
      { hour: 12, minute: 0, timezone: "JP" as const },
      { hour: 17, minute: 0, timezone: "JP" as const },
      { hour: 8, minute: 0, timezone: "LA" as const },
      { hour: 18, minute: 0, timezone: "LA" as const },
    ];
    expect(resolveSlots({ ...legacy, slots: serializeSlots(slots) })).toEqual(slots);
  });

  it("壊れたJSONでも投稿が止まらないよう従来設定に落とす", () => {
    expect(resolveSlots({ ...legacy, slots: "{ではない" })).toHaveLength(2);
    expect(resolveSlots({ ...legacy, slots: "[]" })).toHaveLength(2);
    expect(resolveSlots({ ...legacy, slots: '"文字列"' })).toHaveLength(2);
  });

  it("不正な枠は取り除く", () => {
    const raw = JSON.stringify([
      { hour: 9, minute: 0, timezone: "JP" },
      { hour: 99, minute: 0, timezone: "JP" }, // 時刻が範囲外
      { hour: 9, minute: 0, timezone: "MARS" }, // 未知のタイムゾーン
      { hour: 21, minute: 30, timezone: "LA" },
    ]);
    expect(parseSlots(raw)).toEqual([
      { hour: 9, minute: 0, timezone: "JP" },
      { hour: 21, minute: 30, timezone: "LA" },
    ]);
  });

  it("上限を超える枠は切り捨てる", () => {
    const many = Array.from({ length: 10 }, () => ({ hour: 9, minute: 0, timezone: "JP" as const }));
    expect(resolveSlots({ ...legacy, slots: serializeSlots(many) })).toHaveLength(MAX_SLOTS);
  });
});

describe("primaryTimezone", () => {
  it("最初の枠のタイムゾーンを基準にする", () => {
    const slots = serializeSlots([
      { hour: 12, minute: 0, timezone: "JP" },
      { hour: 8, minute: 0, timezone: "LA" },
    ]);
    expect(primaryTimezone({ ...legacy, slots })).toBe("JP");
  });

  it("枠未設定ならアカウントのタイムゾーン", () => {
    expect(primaryTimezone(legacy)).toBe("LA");
  });
});

describe("formatSlot", () => {
  it("時刻とタイムゾーンが一目で分かる形にする", () => {
    expect(formatSlot({ hour: 12, minute: 0, timezone: "JP" })).toBe("12:00 JST");
    expect(formatSlot({ hour: 8, minute: 5, timezone: "LA" })).toBe("08:05 PT");
  });
});
