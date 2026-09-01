/**
 * 選択中アカウントの保持。
 *
 * 値は「サーバーへ送るヒント」でしかない。サーバーは受け取ったIDが実在し
 * 操作可能かを必ず検証し、通らなければ拒否する（server/accountScope.ts）。
 * ここに保存された値だけで他アカウントのデータに到達することはない。
 */
const STORAGE_KEY = "selected-account-id";

let selected: number | null = readStored();
const listeners = new Set<() => void>();

function readStored(): number | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw || !/^\d+$/.test(raw)) return null;
    return Number(raw);
  } catch {
    // プライベートウィンドウ等で localStorage が使えない場合は毎回既定アカウント
    return null;
  }
}

export function getSelectedAccountId(): number | null {
  return selected;
}

export function setSelectedAccountId(id: number | null) {
  if (selected === id) return;
  selected = id;
  try {
    if (id === null) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, String(id));
  } catch {
    // 保存できなくても、このタブの間は選択を維持する
  }
  listeners.forEach((fn) => fn());
}

export function subscribeSelectedAccount(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** tRPC リクエストに付ける選択中アカウントのヘッダ */
export function accountHeaders(): Record<string, string> {
  return selected === null ? {} : { "x-account-id": String(selected) };
}
