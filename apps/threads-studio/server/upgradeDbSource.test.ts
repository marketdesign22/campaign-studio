import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

describe("追加型DBアップグレード", () => {
  it("既存の存在確認付きcreateTable/addIndexを使い、追加実行で冪等になる", async () => {
    const source = await readFile(new URL("./scripts/upgradeDb.ts", import.meta.url), "utf8");
    for (const table of ["client_profile_drafts", "client_profiles", "client_trend_keywords"]) {
      expect(source).toContain(`await createTable("${table}"`);
    }
    expect(source).toContain('await addIndex("client_profile_drafts"');
    expect(source).toContain('await addIndex("client_trend_keywords"');
    expect(source).not.toContain("DROP TABLE `client_profile");
  });

  it("成果・戦略・品質テーブルと索引を存在確認付きで追加する", async () => {
    const source = await readFile(new URL("./scripts/upgradeDb.ts", import.meta.url), "utf8");
    for (const table of ["conversion_goals", "conversion_events", "conversion_event_revisions", "content_strategies", "content_strategy_items", "weekly_reviews", "post_quality_checks", "post_quality_findings"]) {
      expect(source).toContain(`await createTable("${table}"`);
    }
    expect(source).toContain("uniq_conversion_external");
    expect(source).toContain('await addColumn("posts", "qualityCheckStatus"');
    expect(source).not.toMatch(/DROP\s+(TABLE|COLUMN)/i);
  });
});
