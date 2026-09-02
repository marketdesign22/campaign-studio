/**
 * Threads User ID の取り扱い。
 *
 * Threads は user_id を JSON の数値で返すが、IDは17桁あり JavaScript の
 * 安全整数を超える。JSON.parse を通すと末尾が丸められ、実在しないIDになる。
 * 実際に creaw.usa が「存在しないIDに投稿しようとして失敗し続ける」障害を
 * 起こしたので、その再発防止。
 */
import { describe, expect, it } from "vitest";
import { extractUserId } from "./threadsOAuth";

/** 実際に障害を起こしたID。JSON.parse を通すと ...270 に化ける */
const REAL_ID = "39203306012602276";

describe("extractUserId", () => {
  it("17桁のIDを1桁も落とさずに取り出す", () => {
    const raw = `{"access_token":"THAAxxx","user_id":${REAL_ID}}`;
    expect(extractUserId(raw)).toBe(REAL_ID);
  });

  it("JSON.parse 経由だと値が変わってしまうことを示す（これが障害の原因）", () => {
    const raw = `{"user_id":${REAL_ID}}`;
    const viaJsonParse = String((JSON.parse(raw) as { user_id: number }).user_id);
    expect(viaJsonParse).toBe("39203306012602270");
    expect(viaJsonParse).not.toBe(REAL_ID);
    // 生テキストから取り出せば正しい
    expect(extractUserId(raw)).toBe(REAL_ID);
  });

  it("文字列で返ってきた場合も同じ値を取り出す", () => {
    expect(extractUserId(`{"user_id":"${REAL_ID}"}`)).toBe(REAL_ID);
  });

  it("安全整数の範囲を超えていることを確認する（丸めが起きる条件）", () => {
    expect(Number(REAL_ID) > Number.MAX_SAFE_INTEGER).toBe(true);
  });

  it("キーの順序や空白に左右されない", () => {
    expect(extractUserId(`{ "user_id" : ${REAL_ID} , "access_token":"x" }`)).toBe(REAL_ID);
  });

  it("user_id が無ければ null（呼び出し側でフォールバックする）", () => {
    expect(extractUserId(`{"access_token":"THAAxxx"}`)).toBeNull();
  });
});
