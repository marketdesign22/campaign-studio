import type { PoolOptions } from "mysql2";

/**
 * DATABASE_URL を mysql2 の接続オプションに変換する。
 *
 * 接続文字列の `?ssl={...}` に頼らないのが要点。TiDB Cloud / PlanetScale など
 * マネージドMySQLはTLS必須で、URLのクエリ文字列は環境変数の入力時に壊れやすい
 * （途中で切れる・エスケープされる）ため、ホスト名を見てTLSを既定で有効にする。
 *
 * - localhost / 127.0.0.1 / 内部ホスト → TLSなし
 * - それ以外 → TLS有効（TLSv1.2以上・証明書検証あり）
 * - `DB_SSL=off` で明示的に無効化、`DB_SSL=insecure` で証明書検証のみ無効化
 */
export function buildDbConfig(url: string): PoolOptions {
  const parsed = new URL(url);
  const host = parsed.hostname;

  const config: PoolOptions = {
    host,
    port: parsed.port ? Number(parsed.port) : 3306,
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: parsed.pathname.replace(/^\//, "") || undefined,
  };

  const mode = (process.env.DB_SSL ?? "").toLowerCase();
  const isLocal =
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host.endsWith(".internal") ||
    host.endsWith(".local");

  if (mode === "off" || (mode === "" && isLocal)) {
    return config;
  }

  config.ssl =
    mode === "insecure"
      ? { rejectUnauthorized: false }
      : { minVersion: "TLSv1.2", rejectUnauthorized: true };

  return config;
}

/** ログに出しても安全な接続先の説明（パスワードを含まない） */
export function describeDbTarget(url: string): string {
  try {
    const parsed = new URL(url);
    const db = parsed.pathname.replace(/^\//, "") || "(none)";
    return `${parsed.hostname}:${parsed.port || 3306}/${db} as ${decodeURIComponent(parsed.username)}`;
  } catch {
    return "(unparsable DATABASE_URL)";
  }
}
