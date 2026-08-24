import { describe, expect, it } from "vitest";
import { addDays, planSchedule, slotKey, summarizeRunway } from "./schedulePlanner";

describe("addDays", () => {
  it("crosses month and year boundaries", () => {
    expect(addDays("2026-08-31", 1)).toBe("2026-09-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
});

describe("planSchedule", () => {
  it("fills two slots per day in order", () => {
    const plan = planSchedule({ ids: [1, 2, 3], occupied: [], startDate: "2026-08-10", postsPerDay: 2 });
    expect(plan).toEqual([
      { id: 1, scheduledDate: "2026-08-10", slotIndex: 0 },
      { id: 2, scheduledDate: "2026-08-10", slotIndex: 1 },
      { id: 3, scheduledDate: "2026-08-11", slotIndex: 0 },
    ]);
  });

  it("skips slots that are already taken instead of double-booking", () => {
    const plan = planSchedule({
      ids: [10, 11],
      occupied: [slotKey("2026-08-10", 0), slotKey("2026-08-10", 1), slotKey("2026-08-11", 0)],
      startDate: "2026-08-10",
      postsPerDay: 2,
    });
    expect(plan).toEqual([
      { id: 10, scheduledDate: "2026-08-11", slotIndex: 1 },
      { id: 11, scheduledDate: "2026-08-12", slotIndex: 0 },
    ]);
  });

  it("is idempotent: re-running with the produced plan as occupied assigns nothing to the same slot", () => {
    const first = planSchedule({ ids: [1, 2], occupied: [], startDate: "2026-08-10", postsPerDay: 2 });
    const occupied = first.map(a => slotKey(a.scheduledDate, a.slotIndex));
    const second = planSchedule({ ids: [3], occupied, startDate: "2026-08-10", postsPerDay: 2 });
    expect(second).toEqual([{ id: 3, scheduledDate: "2026-08-11", slotIndex: 0 }]);
  });
});

describe("summarizeRunway", () => {
  const today = "2026-08-10";

  it("counts only future pending posts", () => {
    const r = summarizeRunway(
      [
        { scheduledDate: "2026-08-09", status: "pending" }, // 過去
        { scheduledDate: "2026-08-10", status: "posted" }, // 投稿済み
        { scheduledDate: "2026-08-10", status: "pending" },
        { scheduledDate: "2026-08-11", status: "pending" },
        { scheduledDate: null, status: "pending" }, // 日付未定
      ],
      today
    );
    expect(r.days).toBe(2);
    expect(r.lastDate).toBe("2026-08-11");
  });

  it("reports days where nothing is scheduled before the runway ends", () => {
    const r = summarizeRunway(
      [
        { scheduledDate: "2026-08-10", status: "pending" },
        { scheduledDate: "2026-08-13", status: "pending" },
      ],
      today
    );
    expect(r.gapDates).toEqual(["2026-08-11", "2026-08-12"]);
  });

  it("returns an empty runway when nothing is scheduled", () => {
    expect(summarizeRunway([], today)).toEqual({ days: 0, lastDate: null, gapDates: [] });
  });
});
