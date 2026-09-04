import { describe, expect, it } from "vitest";
import { deterministicQualityCheck, shouldBlockPosting } from "./qualityCheck";

describe("投稿直前の決定的品質チェック", () => {
  it.each([
    ["", "empty"], ["あ".repeat(501), "too_long"], ["公開禁止の話", "forbidden"],
    [`キー sk-${"a".repeat(24)}`, "secret"], ["連絡先 test@example.com", "personal_info"], ["詳細 https://", "invalid_url"], ["ftp://example.com/file", "invalid_url"],
  ])("停止条件を検出する", (content, code) => {
    const findings = deterministicQualityCheck(content, ["公開禁止"]);
    expect(findings.some((finding) => finding.code === code && finding.status === "block" && finding.deterministic)).toBe(true);
    expect(shouldBlockPosting(findings)).toBe(true);
  });

  it("AI由来の曖昧なblockだけでは投稿を停止しない", () => {
    expect(shouldBlockPosting([{ code: "tone", status: "block", message: "", reason: "", evidence: "", severity: 4, suggestion: "", autoFixable: false, humanReview: true, deterministic: false }])).toBe(false);
  });

  it("読みやすさの推奨だけでは停止しない", () => {
    const findings = deterministicQualityCheck("本文\n\n\n\n続き");
    expect(findings[0]?.status).toBe("recommend");
    expect(shouldBlockPosting(findings)).toBe(false);
  });
});
