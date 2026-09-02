/**
 * 選択中アカウントのストア。
 *
 * 「切り替えても画面が変わらない」不具合の再発防止。
 * 値の保存だけでなく、購読者への通知が動くことを確認する
 * （AccountContext は useSyncExternalStore でここを購読している）。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// node環境には localStorage が無いので最小限のものを用意する
const store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
});

const {
  accountHeaders, getSelectedAccountId, setSelectedAccountId, subscribeSelectedAccount,
} = await import("./accountStore");

beforeEach(() => {
  setSelectedAccountId(null);
});

describe("選択中アカウント", () => {
  it("未選択のうちはヘッダを付けない（サーバー側の既定アカウントに任せる）", () => {
    expect(getSelectedAccountId()).toBeNull();
    expect(accountHeaders()).toEqual({});
  });

  it("切り替えると値が変わり、ヘッダにも反映される", () => {
    setSelectedAccountId(30001);
    expect(getSelectedAccountId()).toBe(30001);
    expect(accountHeaders()).toEqual({ "x-account-id": "30001" });
  });

  it("切り替えを購読者に通知する（これが無いと画面が再描画されない）", () => {
    const seen: (number | null)[] = [];
    const unsubscribe = subscribeSelectedAccount(() => seen.push(getSelectedAccountId()));

    setSelectedAccountId(1);
    setSelectedAccountId(30001);

    expect(seen).toEqual([1, 30001]);
    unsubscribe();
  });

  it("購読解除したら通知が来ない", () => {
    let calls = 0;
    const unsubscribe = subscribeSelectedAccount(() => calls++);
    unsubscribe();
    setSelectedAccountId(1);
    expect(calls).toBe(0);
  });

  it("同じアカウントを選び直しても通知しない（無駄な再取得を避ける）", () => {
    setSelectedAccountId(1);
    let calls = 0;
    const unsubscribe = subscribeSelectedAccount(() => calls++);
    setSelectedAccountId(1);
    expect(calls).toBe(0);
    unsubscribe();
  });

  it("選択は localStorage に保存される（リロードしても維持される）", () => {
    setSelectedAccountId(30001);
    expect(localStorage.getItem("selected-account-id")).toBe("30001");
  });
});
