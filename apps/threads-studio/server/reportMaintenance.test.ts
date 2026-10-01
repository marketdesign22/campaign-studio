/**
 * 月次レポートの自動生成（日次メンテナンス）。
 *
 * - 月が替わったあと最初の実行で前月分を draft で作り、通知する
 * - 既にその月のレポートがあれば（状態を問わず）触らない
 * - 文章の生成に失敗しても集計は保存する。1アカウントの失敗が他を止めない
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Account } from "../drizzle/schema";

vi.mock("./db", () => ({ listAccounts: vi.fn(), getReport: vi.fn(), upsertReport: vi.fn() }));
vi.mock("./reportBuilder", () => ({ buildReportData: vi.fn() }));
vi.mock("./reportNarrative", () => ({ generateReportNarrative: vi.fn() }));
vi.mock("./_core/notification", () => ({ notifyOwner: vi.fn() }));
vi.mock("./_core/env", () => ({ ENV: { openaiApiKey: "sk-test" } }));

import * as db from "./db";
import * as builder from "./reportBuilder";
import * as narrativeLib from "./reportNarrative";
import { notifyOwner } from "./_core/notification";
import { previousMonthFor, runMonthlyReportMaintenance } from "./reportMaintenance";

function account(id: number, name: string, timezone: "JP" | "LA"): Account {
  return {
    id, name, threadsUserId: `user-${id}`, threadsAccessToken: "TOKEN-NEVER-LEAK", tokenRefreshedAt: null, tokenExpiresAt: null,
    morningHour: 8, morningMinute: 0, eveningHour: 18, eveningMinute: 0, timezone, slots: null, active: true,
    lastReplyFetchAt: null, lastReplyFetchError: null, threadsUsername: null, createdAt: new Date(), updatedAt: new Date(),
  } as Account;
}
const JP = account(1, "SCSU.Japan", "JP");
const LA = account(2, "creaw.usa", "LA");
const DATA = { yearMonth: "2026-09", notes: ["注記A"] };
const NARRATIVE = { summary: "s", highlights: [], issues: [], actions: [] };

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.mocked(db.getReport).mockResolvedValue(undefined);
  vi.mocked(builder.buildReportData).mockResolvedValue(DATA as never);
  vi.mocked(narrativeLib.generateReportNarrative).mockResolvedValue(NARRATIVE);
  vi.mocked(notifyOwner).mockResolvedValue(true);
});

describe("previousMonthFor", () => {
  it("アカウントのローカル日付で前月を決める（JST の 10/1 0:30 は UTC ではまだ 9/30）", () => {
    const now = new Date("2026-09-30T15:30:00Z");
    expect(previousMonthFor(JP, now)).toBe("2026-09");
    expect(previousMonthFor(LA, now)).toBe("2026-08");
  });
});

describe("runMonthlyReportMaintenance", () => {
  it("前月分が無ければ集計・文章を保存して通知する", async () => {
    vi.mocked(db.listAccounts).mockResolvedValue([JP]);
    const now = new Date("2026-10-01T01:00:00Z");
    const out = await runMonthlyReportMaintenance(now);
    expect(out).toEqual([{ accountId: 1, yearMonth: "2026-09", action: "created" }]);
    expect(builder.buildReportData).toHaveBeenCalledWith(JP, { accountId: 1, includeLegacy: true }, 2026, 9, now);
    expect(db.upsertReport).toHaveBeenCalledWith(1, "2026-09", JSON.stringify(DATA), JSON.stringify(NARRATIVE), now);
    expect(notifyOwner).toHaveBeenCalledWith(expect.objectContaining({ title: expect.stringContaining("2026年9月の月次レポートの下書き") }));
    expect(JSON.stringify(vi.mocked(notifyOwner).mock.calls)).not.toContain("TOKEN-NEVER-LEAK");
  });

  it("既にその月のレポートがあれば（送付済でも下書きでも）触らない", async () => {
    vi.mocked(db.listAccounts).mockResolvedValue([JP]);
    vi.mocked(db.getReport).mockResolvedValue({ status: "draft" } as never);
    const out = await runMonthlyReportMaintenance(new Date("2026-10-05T01:00:00Z"));
    expect(out).toEqual([{ accountId: 1, yearMonth: "2026-09", action: "exists" }]);
    expect(builder.buildReportData).not.toHaveBeenCalled();
    expect(db.upsertReport).not.toHaveBeenCalled();
    expect(notifyOwner).not.toHaveBeenCalled();
  });

  it("文章の生成に失敗しても集計は保存し、通知文でその旨を伝える", async () => {
    vi.mocked(db.listAccounts).mockResolvedValue([JP]);
    vi.mocked(narrativeLib.generateReportNarrative).mockRejectedValue(new Error("OpenAI API request failed (500)"));
    const out = await runMonthlyReportMaintenance(new Date("2026-10-01T01:00:00Z"));
    expect(out[0].action).toBe("created");
    expect(db.upsertReport).toHaveBeenCalledWith(1, "2026-09", JSON.stringify(DATA), null, expect.any(Date));
    expect(vi.mocked(notifyOwner).mock.calls[0][0].content).toContain("文章を作り直す");
  });

  it("1アカウントの集計失敗が他アカウントを止めない。無効なアカウントは対象外", async () => {
    vi.mocked(db.listAccounts).mockResolvedValue([JP, LA, { ...LA, id: 3, active: false }]);
    vi.mocked(builder.buildReportData).mockImplementation(async (acc) => { if (acc.id === 1) throw new Error("db down"); return DATA as never; });
    const out = await runMonthlyReportMaintenance(new Date("2026-10-01T12:00:00Z"));
    expect(out).toEqual([
      { accountId: 1, yearMonth: "2026-09", action: "failed" },
      { accountId: 2, yearMonth: "2026-09", action: "created" },
    ]);
    expect(db.upsertReport).toHaveBeenCalledTimes(1);
  });
});
