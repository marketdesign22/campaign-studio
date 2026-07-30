import { runTick } from "./scheduler";

/**
 * 内蔵スケジューラ。外部cronサービスなしで、プロセス内で15分ごとに
 * runTick を実行する（Railway のような常駐サービス向け）。
 *
 * runTick は post_logs ベースの冪等設計（アカウント×スロット×ローカル日付で
 * 1回だけ投稿）なので、再起動やタイミングのずれで多重投稿にはならない。
 * サーバーが止まっていた間のスロットも、復帰後最初のtickで遅れて投稿される。
 */
const TICK_INTERVAL_MS = 15 * 60 * 1000;
const STARTUP_DELAY_MS = 20 * 1000;

let started = false;

async function tick() {
  try {
    const result = await runTick(new Date());
    const fired = Array.isArray((result as { fired?: unknown[] }).fired)
      ? (result as { fired: unknown[] }).fired.length
      : 0;
    if (fired > 0) {
      console.log(`[Scheduler] tick fired ${fired} slot(s)`, JSON.stringify(result));
    }
  } catch (error) {
    console.error("[Scheduler] tick failed:", error);
  }
}

export function startInternalScheduler() {
  if (started) return;
  started = true;
  console.log(
    `[Scheduler] Built-in scheduler enabled (every ${TICK_INTERVAL_MS / 60000} min)`
  );
  // 起動直後に一度実行（停止中に到来したスロットの追い付き投稿）
  setTimeout(tick, STARTUP_DELAY_MS);
  setInterval(tick, TICK_INTERVAL_MS);
}
