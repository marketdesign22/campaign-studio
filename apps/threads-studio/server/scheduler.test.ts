import { describe, expect, it } from "vitest";
import {
  getLocalParts,
  localDayUtcRange,
  slotIsDue,
  tokenNeedsRefresh,
} from "./scheduler";

describe("getLocalParts", () => {
  it("converts UTC to Los Angeles time (PDT, UTC-7)", () => {
    // 2026-07-29 15:30 UTC = 08:30 PDT same day
    const parts = getLocalParts(new Date("2026-07-29T15:30:00Z"), "LA");
    expect(parts).toEqual({ dateStr: "2026-07-29", hour: 8, minute: 30 });
  });

  it("converts UTC to Los Angeles time (PST, UTC-8, winter)", () => {
    // 2026-01-15 15:30 UTC = 07:30 PST
    const parts = getLocalParts(new Date("2026-01-15T15:30:00Z"), "LA");
    expect(parts).toEqual({ dateStr: "2026-01-15", hour: 7, minute: 30 });
  });

  it("converts UTC to New York time (EDT, UTC-4)", () => {
    // 2026-07-29 15:30 UTC = 11:30 EDT
    const parts = getLocalParts(new Date("2026-07-29T15:30:00Z"), "ET");
    expect(parts).toEqual({ dateStr: "2026-07-29", hour: 11, minute: 30 });
  });

  it("converts UTC to Chicago time (CST, UTC-6, winter)", () => {
    const parts = getLocalParts(new Date("2026-01-15T15:30:00Z"), "CT");
    expect(parts).toEqual({ dateStr: "2026-01-15", hour: 9, minute: 30 });
  });

  it("converts UTC to Japan time crossing the date line", () => {
    // 2026-07-29 20:00 UTC = 2026-07-30 05:00 JST
    const parts = getLocalParts(new Date("2026-07-29T20:00:00Z"), "JP");
    expect(parts).toEqual({ dateStr: "2026-07-30", hour: 5, minute: 0 });
  });
});

describe("localDayUtcRange", () => {
  it("covers a full LA day in summer (UTC-7)", () => {
    const { start, end } = localDayUtcRange("2026-07-29", "LA");
    expect(start.toISOString()).toBe("2026-07-29T07:00:00.000Z");
    expect(end.toISOString()).toBe("2026-07-30T07:00:00.000Z");
  });

  it("covers a full JST day (UTC+9)", () => {
    const { start, end } = localDayUtcRange("2026-07-30", "JP");
    expect(start.toISOString()).toBe("2026-07-29T15:00:00.000Z");
    expect(end.toISOString()).toBe("2026-07-30T15:00:00.000Z");
  });

  it("round-trips: any instant inside the range maps back to the same local date", () => {
    const { start, end } = localDayUtcRange("2026-11-01", "LA"); // DST fall-back day
    const justInside = new Date(start.getTime() + 1000);
    const nearEnd = new Date(end.getTime() - 1000);
    expect(getLocalParts(justInside, "LA").dateStr).toBe("2026-11-01");
    expect(getLocalParts(nearEnd, "LA").dateStr).toBe("2026-11-01");
  });
});

describe("slotIsDue", () => {
  it("fires once local time passes the slot time", () => {
    expect(slotIsDue({ dateStr: "2026-07-29", hour: 8, minute: 0 }, 8, 0)).toBe(true);
    expect(slotIsDue({ dateStr: "2026-07-29", hour: 8, minute: 14 }, 8, 0)).toBe(true);
    expect(slotIsDue({ dateStr: "2026-07-29", hour: 23, minute: 59 }, 8, 0)).toBe(true);
  });

  it("does not fire before the slot time", () => {
    expect(slotIsDue({ dateStr: "2026-07-29", hour: 7, minute: 59 }, 8, 0)).toBe(false);
    expect(slotIsDue({ dateStr: "2026-07-29", hour: 0, minute: 0 }, 8, 0)).toBe(false);
  });
});

describe("tokenNeedsRefresh", () => {
  const now = new Date("2026-07-29T00:00:00Z");
  it("refreshes when older than 7 days", () => {
    expect(tokenNeedsRefresh({ tokenRefreshedAt: new Date("2026-07-20T00:00:00Z"), createdAt: new Date() }, now)).toBe(true);
  });
  it("does not refresh a recent token", () => {
    expect(tokenNeedsRefresh({ tokenRefreshedAt: new Date("2026-07-25T00:00:00Z"), createdAt: new Date() }, now)).toBe(false);
  });
  it("falls back to createdAt when never refreshed", () => {
    expect(tokenNeedsRefresh({ tokenRefreshedAt: null, createdAt: new Date("2026-07-01T00:00:00Z") }, now)).toBe(true);
  });
});
