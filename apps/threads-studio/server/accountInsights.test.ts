/**
 * アカウント全体の日次インサイト取得。Threads API はモックする。
 *
 * - 指標ごとに独立。clicks が権限不足でも views は保存する
 * - 1アカウントの失敗が他を止めない
 * - ログにトークン・レスポンス本文を出さない
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Account } from "../drizzle/schema";

vi.mock("./db", () => ({ listActiveAccounts: vi.fn(), upsertAccountInsightsDaily: vi.fn() }));
vi.mock("./threadsApi", () => ({ fetchAccountInsightDaily: vi.fn() }));

import * as db from "./db";
import * as api from "./threadsApi";
import { ACCOUNT_INSIGHTS_DAYS, fetchAccountInsights } from "./accountInsights";

const TOKEN_A = "TOKEN-A-NEVER-LEAK";
function account(id: number, name: string, token: string, timezone: "JP" | "LA" = "JP"): Account {
  return {
    id, name, threadsUserId: `user-${id}`, threadsAccessToken: token, tokenRefreshedAt: null, tokenExpiresAt: null,
    morningHour: 8, morningMinute: 0, eveningHour: 18, eveningMinute: 0, timezone, slots: null, active: true,
    lastReplyFetchAt: null, lastReplyFetchError: null, threadsUsername: null, createdAt: new Date(), updatedAt: new Date(),
  } as Account;
}
const NOW = new Date("2026-10-01T00:00:00Z");

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("fetchAccountInsights", () => {
  it("views と clicks を別々に取り、日付ごとに保存する（期間は直近30日、タイムゾーンはアカウントのもの）", async () => {
    vi.mocked(db.listActiveAccounts).mockResolvedValue([account(1, "A", TOKEN_A)]);
    vi.mocked(api.fetchAccountInsightDaily).mockImplementation(async (_t, _u, metric) =>
      metric === "views" ? [{ date: "2026-09-29", value: 120 }, { date: "2026-09-30", value: 80 }] : [{ date: "2026-09-30", value: 4 }]
    );
    const out = await fetchAccountInsights(NOW);
    expect(out).toEqual([{ accountId: 1, stored: 3, errors: [] }]);
    const [token, userId, metric, since, until, tz] = vi.mocked(api.fetchAccountInsightDaily).mock.calls[0];
    expect([token, userId, metric, tz]).toEqual([TOKEN_A, "user-1", "views", "Asia/Tokyo"]);
    expect((until.getTime() - since.getTime()) / 86_400_000).toBe(ACCOUNT_INSIGHTS_DAYS);
    expect(db.upsertAccountInsightsDaily).toHaveBeenCalledWith(1, "2026-09-29", { views: 120 });
    expect(db.upsertAccountInsightsDaily).toHaveBeenCalledWith(1, "2026-09-30", { clicks: 4 });
  });

  it("clicks が権限不足でも views は保存し、失敗は種別だけ記録する（本文・トークンは残さない）", async () => {
    vi.mocked(db.listActiveAccounts).mockResolvedValue([account(1, "A", TOKEN_A)]);
    vi.mocked(api.fetchAccountInsightDaily).mockImplementation(async (_t, _u, metric) => {
      if (metric === "clicks") throw new Error(`Threads account insights fetch failed (403): {"error":{"message":"(#10) permission","token":"${TOKEN_A}"}}`);
      return [{ date: "2026-09-30", value: 80 }];
    });
    const out = await fetchAccountInsights(NOW);
    expect(out[0]).toEqual({ accountId: 1, stored: 1, errors: [{ metric: "clicks", kind: "permission" }] });
    expect(db.upsertAccountInsightsDaily).toHaveBeenCalledTimes(1);
    const logged = vi.mocked(console.warn).mock.calls.flat().join(" ");
    expect(logged).toContain("permission");
    expect(logged).not.toContain(TOKEN_A);
    expect(logged).not.toContain("(#10)");
  });

  it("1アカウントの認証エラーが他アカウントを止めない", async () => {
    vi.mocked(db.listActiveAccounts).mockResolvedValue([account(1, "A", TOKEN_A), account(2, "B", "TOKEN-B", "LA")]);
    vi.mocked(api.fetchAccountInsightDaily).mockImplementation(async (token) => {
      if (token === TOKEN_A) throw new Error("Threads account insights fetch failed (401): OAuthException");
      return [{ date: "2026-09-30", value: 1 }];
    });
    const out = await fetchAccountInsights(NOW);
    expect(out.map((r) => r.accountId)).toEqual([1, 2]);
    expect(out[0].errors.map((e) => e.kind)).toEqual(["auth", "auth"]);
    expect(out[1]).toEqual({ accountId: 2, stored: 2, errors: [] });
    expect(vi.mocked(api.fetchAccountInsightDaily).mock.calls.find((c) => c[0] === "TOKEN-B")?.[5]).toBe("America/Los_Angeles");
  });
});
