import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Account } from "../drizzle/schema";

vi.mock("./db", () => ({ listAccounts: vi.fn() }));

import * as db from "./db";
import { primaryAccountId, resolveRequestAccount, scopeOf } from "./accountScope";

function account(id: number, name: string, threadsUserId: string, active = true): Account {
  return {
    id,
    name,
    threadsUserId,
    threadsAccessToken: `token-${id}`,
    tokenRefreshedAt: null,
    tokenExpiresAt: null,
    morningHour: 8,
    morningMinute: 0,
    eveningHour: 18,
    eveningMinute: 0,
    timezone: "LA",
    active,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
  };
}

const SCSU = account(1, "SCSU.Japan", "28207384535618732");
const CREAW = account(2, "creaw.usa", "39203306012602270");

describe("primaryAccountId", () => {
  it("最も古い（IDが小さい）アカウントを旧データの持ち主とする", () => {
    expect(primaryAccountId([CREAW, SCSU])).toBe(1);
  });

  it("無効化されたアカウントでも基準はずれない", () => {
    expect(primaryAccountId([account(1, "SCSU.Japan", "x", false), CREAW])).toBe(1);
  });

  it("アカウントが無ければ null", () => {
    expect(primaryAccountId([])).toBeNull();
  });
});

describe("scopeOf", () => {
  it("最古アカウントだけが accountId 未設定の旧データを読める", () => {
    expect(scopeOf(SCSU, 1)).toEqual({ accountId: 1, includeLegacy: true });
  });

  it("2番目以降のアカウントは旧データを一切読まない", () => {
    expect(scopeOf(CREAW, 1)).toEqual({ accountId: 2, includeLegacy: false });
  });
});

describe("resolveRequestAccount", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.listAccounts).mockResolvedValue([SCSU, CREAW]);
  });

  it("ヘッダで指定されたアカウントを検証して返す", async () => {
    const { account: a, scope } = await resolveRequestAccount("2");
    expect(a.id).toBe(2);
    expect(scope).toEqual({ accountId: 2, includeLegacy: false });
  });

  it("ヘッダ未指定なら既定（有効なうち最小ID）にフォールバックする", async () => {
    const { account: a, scope } = await resolveRequestAccount(undefined);
    expect(a.id).toBe(1);
    expect(scope.includeLegacy).toBe(true);
  });

  it("実在しないアカウントIDは拒否する（他アカウントに倒さない）", async () => {
    await expect(resolveRequestAccount("999")).rejects.toThrow(/操作できません/);
  });

  it("無効化されたアカウントは拒否する", async () => {
    vi.mocked(db.listAccounts).mockResolvedValue([SCSU, account(2, "creaw.usa", "x", false)]);
    await expect(resolveRequestAccount("2")).rejects.toThrow(/無効化/);
  });

  it("数値でないアカウントIDは拒否する", async () => {
    await expect(resolveRequestAccount("1 OR 1=1")).rejects.toThrow(/不正/);
    await expect(resolveRequestAccount("-1")).rejects.toThrow(/不正/);
  });

  it("アカウントが1件も無ければ操作させない", async () => {
    vi.mocked(db.listAccounts).mockResolvedValue([]);
    await expect(resolveRequestAccount(undefined)).rejects.toThrow(/登録されていません/);
  });

  it("すべて無効化されている場合も操作させない", async () => {
    vi.mocked(db.listAccounts).mockResolvedValue([account(1, "a", "x", false)]);
    await expect(resolveRequestAccount(undefined)).rejects.toThrow(/有効なThreadsアカウントがありません/);
  });
});
