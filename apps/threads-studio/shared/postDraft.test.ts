/** 原稿編集のバリデーション。空本文・500文字境界・予約の警告を確かめる */
import { describe, expect, it } from "vitest";
import {
  canSave, countChars, isBlank, isBlocking, isDirty, isValidDate, lengthState,
  MAX_POST_LENGTH, validateDraft,
} from "./postDraft";

const draft = (content: string, over: Partial<Parameters<typeof validateDraft>[0]> = {}) => ({
  content, scheduledDate: "", slotIndex: 0, editingId: null, ...over,
});

describe("文字数", () => {
  it("絵文字を1文字として数える（サロゲートペアで2文字にしない）", () => {
    expect(countChars("👍")).toBe(1);
    expect("👍".length).toBe(2); // 素の length ではズレる
    expect(countChars("🇯🇵")).toBe(2); // 地域指示子2つ。Threads側の数え方に合わせる
  });

  it("日本語・英語・改行を同じ基準で数える", () => {
    expect(countChars("あいう")).toBe(3);
    expect(countChars("abc")).toBe(3);
    expect(countChars("a\nb")).toBe(3);
  });

  it("450文字で警告、500文字でエラーになる", () => {
    expect(lengthState("あ".repeat(449))).toBe("ok");
    expect(lengthState("あ".repeat(450))).toBe("warn");
    expect(lengthState("あ".repeat(499))).toBe("warn");
    expect(lengthState("あ".repeat(500))).toBe("error");
  });
});

describe("保存可否", () => {
  it("空白・改行だけの本文は保存できない", () => {
    for (const blank of ["", "   ", "\n\n", "  \n \t "]) {
      expect(isBlank(blank)).toBe(true);
      expect(canSave(blank)).toBe(false);
      expect(isBlocking(validateDraft(draft(blank), [], "2026-09-02"))).toBe(true);
    }
  });

  it("ちょうど500文字は保存でき、501文字は保存できない", () => {
    expect(canSave("あ".repeat(MAX_POST_LENGTH))).toBe(true);
    expect(canSave("あ".repeat(MAX_POST_LENGTH + 1))).toBe(false);
  });

  it("絵文字だけの本文でも境界は文字数で判定する", () => {
    expect(canSave("👍".repeat(500))).toBe(true);
    expect(canSave("👍".repeat(501))).toBe(false);
  });
});

describe("投稿日", () => {
  it("形式と実在を検証する", () => {
    expect(isValidDate("2026-09-02")).toBe(true);
    expect(isValidDate("2026-9-2")).toBe(false);
    expect(isValidDate("2026-02-30")).toBe(false); // 存在しない日
    expect(isValidDate("")).toBe(false);
  });

  it("過去日は警告するが保存は止めない", () => {
    const issues = validateDraft(draft("本文", { scheduledDate: "2026-09-01" }), [], "2026-09-02");
    expect(issues).toContainEqual({ kind: "past_date" });
    expect(isBlocking(issues)).toBe(false);
  });

  it("不正な日付は保存を止める", () => {
    const issues = validateDraft(draft("本文", { scheduledDate: "2026-13-40" }), [], "2026-09-02");
    expect(isBlocking(issues)).toBe(true);
  });
});

describe("同一日時・同一スロットの重複", () => {
  const existing = [
    { id: 1, status: "pending", scheduledDate: "2026-09-05", slotIndex: 0 },
    { id: 2, status: "posted", scheduledDate: "2026-09-05", slotIndex: 1 },
  ];

  it("未投稿の原稿と枠がぶつかったら警告する", () => {
    const issues = validateDraft(
      draft("本文", { scheduledDate: "2026-09-05", slotIndex: 0 }), existing, "2026-09-02");
    expect(issues).toContainEqual({ kind: "slot_taken", postId: 1 });
    expect(isBlocking(issues)).toBe(false); // 意図的に重ねることもあるので止めない
  });

  it("投稿済みの原稿とは重複扱いにしない", () => {
    const issues = validateDraft(
      draft("本文", { scheduledDate: "2026-09-05", slotIndex: 1 }), existing, "2026-09-02");
    expect(issues.some((i) => i.kind === "slot_taken")).toBe(false);
  });

  it("編集中の原稿は自分自身と重複しない", () => {
    const issues = validateDraft(
      draft("本文", { scheduledDate: "2026-09-05", slotIndex: 0, editingId: 1 }), existing, "2026-09-02");
    expect(issues.some((i) => i.kind === "slot_taken")).toBe(false);
  });
});

describe("未保存の変更", () => {
  const base = { content: "a", scheduledDate: "", slotIndex: 0, imageUrl: null };

  it("何も変えていなければ false", () => {
    expect(isDirty({ ...base }, base)).toBe(false);
  });

  it("本文・日付・枠・画像のいずれかが変われば true", () => {
    expect(isDirty({ ...base, content: "b" }, base)).toBe(true);
    expect(isDirty({ ...base, scheduledDate: "2026-09-05" }, base)).toBe(true);
    expect(isDirty({ ...base, slotIndex: 1 }, base)).toBe(true);
    expect(isDirty({ ...base, imageUrl: "/api/media/x" }, base)).toBe(true);
  });
});
