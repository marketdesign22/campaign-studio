/**
 * 投稿処理の多重起動防止ロック（プロセス内）。
 *
 * runSlotForAccount は「その枠の今日のログがあるか確認 → 投稿 → ログを書く」
 * という確認してから実行する作りなので、2つの実行が重なると両方が
 * 「まだ投稿していない」と判断して同じ枠を二重投稿しうる。
 * 実行の入口は複数ある:
 *   - 内蔵スケジューラ（server/cron.ts。15分ごと + 起動20秒後）
 *   - POST /api/scheduled/tick（GitHub Actions などの外部cron。curl のリトライで
 *     前回の実行がサーバー側でまだ続いている間に次の呼び出しが来ることもある）
 *   - 旧固定時刻エンドポイント（/api/scheduled/morning・evening）
 * これらはすべてこのロックを通し、同時には1つしか走らせない。
 *
 * 実行中に来た呼び出しは「待たずにスキップ」する。理由:
 *   - 実行中の処理が、到来済みの枠をすべて自分で判定・投稿する
 *   - 投稿済みかどうかはログで判定するので、取りこぼしがあっても次のtickで追い付く
 *   - 待たせると HTTP 呼び出し（curl --max-time）がタイムアウトし、
 *     リトライでさらに呼び出しが積み重なる
 *
 * 注意: これは1プロセス内でしか効かない（Render は numInstances 1 前提）。
 * インスタンスを2台以上に増やす場合は、DB側のロック（例: スロット×日付の一意制約）が必要。
 *
 * 判定とロック取得は await を挟まずに同期的に行うので、
 * Node.js のシングルスレッド上では2つの呼び出しが同時に取得することはない。
 */

/** 実行中のためスキップしたことを表す値（HTTP応答の skipped にもそのまま使う） */
export const ALREADY_RUNNING = "already_running" as const;

let current: { label: string; startedAt: number } | null = null;

export type ExclusiveResult<T> =
  | { ran: true; value: T }
  | { ran: false; heldBy: string; heldForMs: number };

/**
 * fn を排他的に実行する。すでに実行中なら fn を呼ばずに { ran: false } を返す。
 * fn が例外を投げてもロックは必ず解放する（例外はそのまま呼び出し元へ）。
 */
export async function runExclusive<T>(
  label: string,
  fn: () => Promise<T>
): Promise<ExclusiveResult<T>> {
  if (current) {
    return { ran: false, heldBy: current.label, heldForMs: Date.now() - current.startedAt };
  }
  current = { label, startedAt: Date.now() };
  try {
    return { ran: true, value: await fn() };
  } finally {
    current = null;
  }
}

/** 投稿処理が実行中かどうか（テスト・診断用） */
export function isSchedulerRunning(): boolean {
  return current !== null;
}

/** スキップしたことをログに残す（IDや本文は出さない） */
export function logSkipped(label: string, held: { heldBy: string; heldForMs: number }) {
  console.log(
    `[scheduler] ${label} skipped: ${held.heldBy} is already running (${Math.round(held.heldForMs / 1000)}s)`
  );
}
