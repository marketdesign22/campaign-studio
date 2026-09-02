/**
 * トークンがAPIレスポンスに出ないことの確認。
 * アクセストークンはサーバー内部（投稿・リフレッシュ）でしか使わず、
 * 画面へ返すのは「登録済みかどうか」だけ。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Account } from "../drizzle/schema";

vi.mock("./db", () => ({
  listAccounts: vi.fn(),
  getAccountById: vi.fn(),
  getSettings: vi.fn(),
  getAccountSettings: vi.fn(),
  upsertAccountSettings: vi.fn(),
  createAccount: vi.fn(),
  updateAccount: vi.fn(),
  deleteAccount: vi.fn(),
  deleteAccountSettings: vi.fn(),
}));
vi.mock("./threadsApi", () => ({
  getThreadsProfile: vi.fn(),
  refreshLongLivedToken: vi.fn(),
}));
vi.mock("./threadsOAuth", () => ({
  buildAuthorizeUrl: vi.fn(),
  signConnectState: vi.fn(),
}));

import * as db from "./db";
import { accountsRouter } from "./routers/accounts";
import { settingsRouter } from "./routers/settings";

const SECRET = "THIS-IS-A-REAL-LOOKING-LONG-LIVED-TOKEN";

const SCSU: Account = {
  id: 1, name: "SCSU.Japan", threadsUserId: "28207384535618732",
  threadsAccessToken: SECRET,
  tokenRefreshedAt: null, tokenExpiresAt: null,
  morningHour: 8, morningMinute: 0, eveningHour: 18, eveningMinute: 0,
  timezone: "LA", active: true,
  createdAt: new Date(), updatedAt: new Date(),
};

function ctx(accountId = 1) {
  return {
    req: { headers: { "x-account-id": String(accountId) } },
    res: {},
    user: { id: 1, role: "admin" },
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(db.listAccounts).mockResolvedValue([SCSU]);
  vi.mocked(db.getAccountSettings).mockResolvedValue({
    requireApproval: false, notifyOnError: true, autoFillEvergreen: false,
    recycleRewrite: true, recycleCooldownDays: 30, postsPerDay: 2,
    brandName: null, brandAccent: null,
  });
  vi.mocked(db.getSettings).mockResolvedValue({ brandName: "Studio", brandAccent: "#ff9800" } as never);
});

describe("accounts.list", () => {
  it("トークン本体を返さず、登録済みフラグだけを返す", async () => {
    const rows = await accountsRouter.createCaller(ctx()).list();
    expect(JSON.stringify(rows)).not.toContain(SECRET);
    expect(rows[0]).toMatchObject({ id: 1, hasToken: true });
    expect(rows[0]).not.toHaveProperty("threadsAccessToken");
  });
});

describe("accounts.current", () => {
  it("トークンを含まない", async () => {
    const current = await accountsRouter.createCaller(ctx()).current();
    expect(JSON.stringify(current)).not.toContain(SECRET);
    expect(current).not.toHaveProperty("threadsAccessToken");
  });
});

describe("settings.get", () => {
  it("トークン本体ではなく有無だけを返す", async () => {
    const s = await settingsRouter.createCaller(ctx()).get();
    expect(JSON.stringify(s)).not.toContain(SECRET);
    expect(s.hasToken).toBe(true);
    expect(s).not.toHaveProperty("threadsAccessToken");
  });
});

describe("settings.brand（未ログインでも読める公開情報）", () => {
  it("ブランド名と色以外は返さない", async () => {
    const brand = await settingsRouter.createCaller(ctx()).brand();
    expect(Object.keys(brand).sort()).toEqual(["brandAccent", "brandName"]);
  });
});
