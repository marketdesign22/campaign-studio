import { describe, expect, it } from "vitest";

describe("analytics configuration", () => {
  it("静的HTMLに未展開のViteプレースホルダーを残さない", async () => {
    const html = await import("node:fs/promises").then((fs) =>
      fs.readFile(new URL("../../index.html", import.meta.url), "utf8")
    );
    expect(html).not.toContain("%VITE_ANALYTICS_");
  });
});
