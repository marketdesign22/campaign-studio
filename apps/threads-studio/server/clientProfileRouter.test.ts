import { beforeEach, describe, expect, it, vi } from "vitest";
import { emptyProfile } from "@shared/clientProfile";

vi.mock("./db", () => ({
  listAccounts: vi.fn(), getClientProfile: vi.fn(), getLatestClientProfileDraft: vi.fn(),
  getOwnedClientProfileDraft: vi.fn(), getTrendSettings: vi.fn(), createClientProfileDraft: vi.fn(),
  approveClientProfileDraft: vi.fn(), upsertTrendSettings: vi.fn(), listTrendPosts: vi.fn(),
}));
vi.mock("./clientProfile", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./clientProfile")>();
  return { ...actual, collectProfileSources: vi.fn(), extractClientProfile: vi.fn(), suggestKeywordImprovements: vi.fn() };
});

import * as db from "./db";
import * as service from "./clientProfile";

const ACCOUNT = { id: 1, name: "A", threadsUserId: "1", threadsAccessToken: "THREADS-TOKEN-SECRET", tokenRefreshedAt: null, tokenExpiresAt: null, morningHour: 8, morningMinute: 0, eveningHour: 18, eveningMinute: 0, timezone: "JP", slots: null, active: true, createdAt: new Date(), updatedAt: new Date() };
const OTHER = { ...ACCOUNT, id: 2, name: "B", threadsUserId: "2" };
const inputs = { homepageUrl: "https://example.com" };
const profile = emptyProfile();
profile.brandName = { value: "Example", status: "verified", confidence: 1, sources: [{ url: "https://example.com/", pageTitle: "Home", excerpt: "Example" }], conflict: null };
const keywords = [{ keyword: "Example", category: "industry" as const, reason: "official", targetCustomer: null, region: null, priority: 5, enabled: true, sources: ["https://example.com/"] }];
const draft = { id: 9, accountId: 1, status: "pending", inputs: JSON.stringify(inputs), profile: JSON.stringify(profile), keywords: JSON.stringify(keywords), warnings: "[]", createdAt: new Date(), reviewedAt: null };

function ctx(accountId = 1, role: "admin" | "user" = "admin") {
  return { req: { headers: { "x-account-id": String(accountId) } }, res: {}, user: { id: 1, role } } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(db.listAccounts).mockResolvedValue([ACCOUNT, OTHER] as never);
  vi.mocked(db.getClientProfile).mockResolvedValue(undefined);
  vi.mocked(db.getLatestClientProfileDraft).mockResolvedValue(undefined);
  vi.mocked(db.getTrendSettings).mockResolvedValue({ keywords: [], excludeKeywords: [], refAccounts: [], language: "ja", region: "JP", industry: null } as never);
  vi.mocked(db.createClientProfileDraft).mockResolvedValue(9);
  vi.mocked(db.listTrendPosts).mockResolvedValue([] as never);
  vi.mocked(service.collectProfileSources).mockResolvedValue({ website: [], threads: null, instagram: null });
  vi.mocked(service.extractClientProfile).mockResolvedValue({ extraction: { profile, keywords, warnings: [] }, diff: [] });
  vi.mocked(service.suggestKeywordImprovements).mockResolvedValue({ keywords, reason: "少ない結果を具体化" });
});

describe("クライアントプロフィールAPI", () => {
  it("読み取りは候補だけ保存し、承認前に現行設定を上書きしない", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    vi.resetModules();
    const { clientProfileRouter } = await import("./routers/clientProfile");
    const result = await clientProfileRouter.createCaller(ctx()).scan(inputs);
    expect(result.id).toBe(9);
    const d = await import("./db");
    expect(d.createClientProfileDraft).toHaveBeenCalledWith(1, inputs, profile, keywords, []);
    expect(d.approveClientProfileDraft).not.toHaveBeenCalled();
    expect(d.upsertTrendSettings).not.toHaveBeenCalled();
  });

  it("別アカウントの候補IDを承認できない", async () => {
    vi.mocked(db.getOwnedClientProfileDraft).mockResolvedValue(undefined);
    const { clientProfileRouter } = await import("./routers/clientProfile");
    await expect(clientProfileRouter.createCaller(ctx(2)).approve({ draftId: 9, selectedFields: [], edits: {}, keywords: [] })).rejects.toThrow(/見つかりません/);
    expect(db.approveClientProfileDraft).not.toHaveBeenCalled();
  });

  it("利用者承認後にだけプロフィールと有効キーワードを反映する", async () => {
    vi.mocked(db.getOwnedClientProfileDraft).mockResolvedValue(draft as never);
    const { clientProfileRouter } = await import("./routers/clientProfile");
    await clientProfileRouter.createCaller(ctx()).approve({ draftId: 9, selectedFields: ["brandName"], edits: {}, keywords });
    expect(db.approveClientProfileDraft).toHaveBeenCalledWith(9, 1, expect.objectContaining({ brandName: expect.objectContaining({ value: "Example" }) }), inputs, keywords);
    expect(db.upsertTrendSettings).toHaveBeenCalledWith(1, expect.objectContaining({ keywords: ["Example"] }));
  });

  it("検索成果から改善案を作っても確認待ち候補だけを保存する", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    vi.resetModules();
    const d = await import("./db");
    const s = await import("./clientProfile");
    vi.mocked(d.getClientProfile).mockResolvedValue({ profile: JSON.stringify(profile), sourceInputs: JSON.stringify(inputs) } as never);
    vi.mocked(d.getTrendSettings).mockResolvedValue({ keywords: ["Example"], excludeKeywords: [], refAccounts: [], language: "ja", region: "JP", industry: null } as never);
    vi.mocked(d.listTrendPosts).mockResolvedValue([{ keyword: "Example", status: "excluded" }] as never);
    vi.mocked(s.suggestKeywordImprovements).mockResolvedValue({ keywords, reason: "除外率を下げる" });
    const { clientProfileRouter } = await import("./routers/clientProfile");
    await clientProfileRouter.createCaller(ctx()).improveKeywords();
    expect(s.suggestKeywordImprovements).toHaveBeenCalledWith(profile, ["Example"], [{ keyword: "Example", results: 1, excluded: 1 }]);
    expect(d.createClientProfileDraft).toHaveBeenCalledWith(1, inputs, profile, keywords, [expect.stringContaining("除外率")]);
    expect(d.upsertTrendSettings).not.toHaveBeenCalled();
  });

  it("AI未設定時はサイトやThreadsの取得を開始しない", async () => {
    delete process.env.OPENAI_API_KEY;
    vi.resetModules();
    const s = await import("./clientProfile");
    const { clientProfileRouter } = await import("./routers/clientProfile");
    await expect(clientProfileRouter.createCaller(ctx()).scan(inputs)).rejects.toThrow(/OPENAI_API_KEY/);
    expect(s.collectProfileSources).not.toHaveBeenCalled();
  });
});
