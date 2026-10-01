import { describe, it, expect, vi, beforeEach } from "vitest";
vi.mock("./db", () => ({ getDb: vi.fn(), listConversionEvents: vi.fn() }));
import { getDb } from "./db";
import {
  getReport,
  updateReport,
  reportTransitionAllowed,
} from "./reportStore";
import { buildReportData } from "./reportBuilder";
import { emptyReportConfig } from "@shared/monthlyReport";
import { templateNarrative } from "./reportNarrative";
const data = buildReportData({
  accountId: 1,
  accountName: "A",
  month: "2026-09",
  timezone: "Asia/Tokyo",
  config: emptyReportConfig(),
  previousConfig: emptyReportConfig(),
  posts: [],
  followers: [],
  events: [],
  previousEvents: [],
  observations: [],
  now: new Date("2026-10-02"),
});
const row = {
  id: "report-id",
  accountId: 1,
  status: "reviewed",
  revision: 2,
  generatedAt: new Date(),
  reviewedAt: new Date(),
  sentAt: null,
  narrativeSource: "template",
  dataJson: JSON.stringify(data),
  narrativeJson: JSON.stringify(templateNarrative(data)),
};
const mockDb = (rows: unknown[], affectedRows = 0) => ({
  select: () => ({ from: () => ({ where: vi.fn().mockResolvedValue(rows) }) }),
  update: vi.fn(() => ({
    set: () => ({ where: vi.fn().mockResolvedValue([{ affectedRows }]) }),
  })),
});
beforeEach(() => vi.clearAllMocks());
describe("report lifecycle", () => {
  it("requires review before sent and prevents reopening sent reports", () => {
    expect(reportTransitionAllowed("draft", "sent")).toBe(false);
    expect(reportTransitionAllowed("draft", "reviewed")).toBe(true);
    expect(reportTransitionAllowed("reviewed", "sent")).toBe(true);
    expect(reportTransitionAllowed("sent", "draft")).toBe(false);
  });
  it("does not return a report when the account-scoped lookup is empty", async () => {
    vi.mocked(getDb).mockResolvedValue(mockDb([]) as never);
    await expect(getReport(2, "report-id")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
  it("refuses to edit frozen reviewed content", async () => {
    const db = mockDb([row]);
    vi.mocked(getDb).mockResolvedValue(db as never);
    await expect(
      updateReport(1, row.id, 2, { narrative: templateNarrative(data) })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(db.update).not.toHaveBeenCalled();
  });
  it("rejects stale concurrent writes", async () => {
    vi.mocked(getDb).mockResolvedValue(
      mockDb([{ ...row, status: "draft" }], 0) as never
    );
    await expect(
      updateReport(1, row.id, 1, { status: "reviewed" })
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});
