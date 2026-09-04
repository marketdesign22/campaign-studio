/**
 * Threads APIの一時的な失敗（通信エラー・レート制限）だけを、間を空けて1回再試行する。
 * 認証・権限エラーは再試行しても無駄なので対象にしない。
 */

const RETRIES = 1;

/** 再試行までの待ち時間。テストから差し替えられるようにしておく */
export const RETRY_DELAY_MS: Record<"network" | "rate_limited", number> = { network: 1000, rate_limited: 5000 };
export const _test = { sleep: (ms: number) => new Promise<void>((r) => setTimeout(r, ms)) };

/**
 * `classify` が "network" | "rate_limited" を返した例外だけ、間隔を空けて1回再試行する。
 * "other" を返した例外はそのまま投げる。
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  classify: (e: unknown) => "network" | "rate_limited" | "other"
): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      const kind = classify(e);
      if (kind === "other") break;
      if (attempt < RETRIES) await _test.sleep(RETRY_DELAY_MS[kind] * (attempt + 1));
    }
  }
  throw last;
}
