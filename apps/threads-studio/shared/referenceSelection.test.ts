import { describe, expect, it } from "vitest";
import { selectReferencePosts } from "./referenceSelection";

describe("成果連動型の過去投稿選択", () => {
  it("文体3・成果3・テーマ2を最大8件、重複なしで選ぶ", () => {
    const now = Date.UTC(2026, 8, 4);
    const rows = Array.from({ length: 12 }, (_, i) => ({ id: i + 1, content: i === 9 ? "留学相談の選び方" : `投稿${i}`, postedAt: new Date(now - i * 86_400_000), views: 100, likes: i, replies: 0, reposts: 0, clicks: i, conversions: i === 8 ? 2 : 0 }));
    const selected = selectReferencePosts(rows, "留学相談", now);
    expect(selected).toHaveLength(8); expect(new Set(selected.map((x) => x.id)).size).toBe(8);
    expect(selected.filter((x) => x.reason === "style")).toHaveLength(3);
    expect(selected.some((x) => x.reason === "performance")).toBe(true);
    expect(selected.some((x) => x.reason === "theme" && x.id === 10)).toBe(true);
  });
  it("データ不足時は安全に存在件数だけ返す", () => {
    const now = Date.UTC(2026, 8, 4); const row = { id: 1, content: "一件", postedAt: new Date(now), views: null, likes: null, replies: null, reposts: null, clicks: 0, conversions: 0 };
    expect(selectReferencePosts([row], "", now)).toHaveLength(1);
  });
});
