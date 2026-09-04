import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

describe("クライアントプロフィールDBアップグレード", () => {
  it("既存の存在確認付きcreateTable/addIndexを使い、追加実行で冪等になる", async () => {
    const source = await readFile(new URL("./scripts/upgradeDb.ts", import.meta.url), "utf8");
    for (const table of ["client_profile_drafts", "client_profiles", "client_trend_keywords"]) {
      expect(source).toContain(`await createTable("${table}"`);
    }
    expect(source).toContain('await addIndex("client_profile_drafts"');
    expect(source).toContain('await addIndex("client_trend_keywords"');
    expect(source).not.toContain("DROP TABLE `client_profile");
  });
});
