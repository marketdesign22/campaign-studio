/**
 * 自動返信テンプレートの一致判定。純粋関数なのでそのままテストできる。
 * 「一致すれば送信する」ではなく「一致すれば案として出す」だけを保証する。
 */
import { describe, expect, it } from "vitest";
import { matchReplyTemplate, parseTemplateKeywords, type ReplyTemplateRule } from "./replyTemplates";

function rule(id: number, keywords: string[], replyText = `reply-${id}`, enabled = true): ReplyTemplateRule {
  return { id, keywords, replyText, enabled };
}

describe("matchReplyTemplate", () => {
  it("キーワードを含む本文があれば、その定型文を返す", () => {
    const t = rule(1, ["ビザ", "在留資格"], "学生ビザのサポートも行っています。");
    expect(matchReplyTemplate("ビザについて教えてください", [t])).toEqual(t);
  });

  it("大文字小文字を区別しない", () => {
    const t = rule(1, ["VISA"]);
    expect(matchReplyTemplate("visa について", [t])).toEqual(t);
  });

  it("一致するキーワードが無ければ null", () => {
    const t = rule(1, ["ビザ"]);
    expect(matchReplyTemplate("学費について", [t])).toBeNull();
  });

  it("無効化されたテンプレートは無視する", () => {
    const t = rule(1, ["ビザ"], "案内", false);
    expect(matchReplyTemplate("ビザについて", [t])).toBeNull();
  });

  it("複数一致する場合は登録順（配列の先頭）で最初のものを返す", () => {
    const a = rule(1, ["費用"], "A");
    const b = rule(2, ["費用", "学費"], "B");
    expect(matchReplyTemplate("学費と費用について", [a, b])).toEqual(a);
  });

  it("空文字のキーワードは無視する（全文一致にならない）", () => {
    const t = rule(1, ["", "  "]);
    expect(matchReplyTemplate("何でもいい本文", [t])).toBeNull();
  });

  it("テンプレートが無ければ null", () => {
    expect(matchReplyTemplate("ビザについて", [])).toBeNull();
  });
});

describe("parseTemplateKeywords", () => {
  it("JSON配列を読み、空文字は除く", () => {
    expect(parseTemplateKeywords(JSON.stringify(["ビザ", "", "学費"]))).toEqual(["ビザ", "学費"]);
  });
  it("null・壊れたJSONは空配列", () => {
    expect(parseTemplateKeywords(null)).toEqual([]);
    expect(parseTemplateKeywords("{oops")).toEqual([]);
  });
});
