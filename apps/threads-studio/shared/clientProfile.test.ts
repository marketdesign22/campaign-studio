import { describe, expect, it } from "vitest";
import { diffProfiles, emptyProfile, profileExtractionSchema, protectUserEdits } from "./clientProfile";

describe("クライアントプロフィール", () => {
  it("推定・確認済み・未取得を別の状態で保持する", () => {
    const profile = emptyProfile();
    profile.brandName = { value: "Example", status: "verified", confidence: 0.98, sources: [{ url: "https://example.com/", pageTitle: "Home", excerpt: "Example" }], conflict: null };
    profile.targetCustomers = { value: ["学生"], status: "inferred", confidence: 0.55, sources: [], conflict: null };
    const parsed = profileExtractionSchema.safeParse({ profile, keywords: [{ keyword: "留学", category: "industry", reason: "業界の中心語", targetCustomer: "学生", region: "日本", priority: 5, enabled: true, sources: ["https://example.com/"] }], warnings: [] });
    expect(parsed.success).toBe(true);
    expect(profile.priceRange.status).toBe("missing");
  });

  it("ユーザー修正済み項目はAI再読み取りで上書きしない", () => {
    const current = emptyProfile();
    current.brandName = { value: "Human Name", status: "user_edited", confidence: 1, sources: [], conflict: null };
    const candidate = emptyProfile();
    candidate.brandName = { value: "AI Name", status: "verified", confidence: 1, sources: [], conflict: null };
    expect(protectUserEdits(current, candidate).brandName.value).toBe("Human Name");
  });

  it("再読み取りを全件上書きせず差分と保護状態を返す", () => {
    const current = emptyProfile();
    current.priceRange = { value: "$100", status: "user_edited", confidence: 1, sources: [], conflict: null };
    const candidate = emptyProfile();
    candidate.priceRange = { value: "$120", status: "verified", confidence: 0.9, sources: [], conflict: "料金ページとFAQが不一致" };
    expect(diffProfiles(current, candidate)).toContainEqual(expect.objectContaining({ key: "priceRange", protected: true }));
  });
});
