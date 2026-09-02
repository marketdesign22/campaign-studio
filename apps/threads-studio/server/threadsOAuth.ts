/**
 * Threads OAuth（クライアント自身によるアカウント連携）。
 *
 * 運用者がクライアントごとに「連携リンク」を発行し、クライアントがそれを開いて
 * Threadsで許可すると、アクセストークンがこのアプリに直接届く。
 * これによりクライアントのパスワードを預からずに済む。
 *
 * state には有効期限つきの署名済みJWTを使う（DBに一時レコードを持たない）。
 */
import { SignJWT, jwtVerify } from "jose";
import { ENV } from "./_core/env";

const AUTHORIZE_URL = "https://threads.net/oauth/authorize";
const TOKEN_URL = "https://graph.threads.net/oauth/access_token";
const LONG_LIVED_URL = "https://graph.threads.net/access_token";

/** 投稿・分析に必要な権限 */
export const THREADS_SCOPES = [
  "threads_basic",
  "threads_content_publish",
  "threads_manage_insights",
].join(",");

const STATE_PURPOSE = "threads-connect";

function secretKey(): Uint8Array {
  if (!ENV.cookieSecret) throw new Error("JWT_SECRET is not configured");
  return new TextEncoder().encode(ENV.cookieSecret);
}

export function connectRedirectUri(): string {
  const base = ENV.appUrl.replace(/\/$/, "");
  if (!base) {
    throw new Error(
      "APP_URL が未設定です。Renderの環境変数にAPP_URLを設定してください。"
    );
  }
  return `${base}/api/threads/callback`;
}

/** 連携リンクに埋め込む state（誰のための連携かを署名付きで持たせる） */
export async function signConnectState(
  accountName: string,
  expiresInSec = 60 * 60 * 24 * 7
): Promise<string> {
  return new SignJWT({ purpose: STATE_PURPOSE, accountName })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setExpirationTime(Math.floor(Date.now() / 1000) + expiresInSec)
    .sign(secretKey());
}

export async function verifyConnectState(state: string): Promise<{ accountName: string }> {
  const { payload } = await jwtVerify(state, secretKey(), { algorithms: ["HS256"] });
  if (payload.purpose !== STATE_PURPOSE || typeof payload.accountName !== "string") {
    throw new Error("invalid state");
  }
  return { accountName: payload.accountName };
}

/** クライアントに渡す認可URL */
export function buildAuthorizeUrl(state: string): string {
  if (!ENV.threadsAppId) {
    throw new Error(
      "THREADS_APP_ID が未設定です。Renderの環境変数に設定してください。"
    );
  }
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("client_id", ENV.threadsAppId);
  url.searchParams.set("redirect_uri", connectRedirectUri());
  url.searchParams.set("scope", THREADS_SCOPES);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", state);
  return url.toString();
}

/**
 * トークン応答から Threads User ID を取り出す。
 *
 * Threads は user_id を JSON の「数値」で返すが、IDは17桁あり JavaScript の
 * 安全整数（2^53-1 = 9007199254740991）を超える。JSON.parse を通すと末尾が
 * 丸められ、実在しないIDになってしまう（例: ...276 が ...270 になる）。
 * 数値化される前の生テキストから桁をそのまま取り出すこと。
 */
export function extractUserId(rawJson: string): string | null {
  const m = /"user_id"\s*:\s*"?(\d+)"?/.exec(rawJson);
  return m ? m[1] : null;
}

/** 認可コード → 短期トークン */
export async function exchangeCodeForToken(
  code: string
): Promise<{ accessToken: string; userId: string }> {
  if (!ENV.threadsAppSecret) {
    throw new Error("THREADS_APP_SECRET が未設定です。");
  }
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: ENV.threadsAppId,
      client_secret: ENV.threadsAppSecret,
      grant_type: "authorization_code",
      redirect_uri: connectRedirectUri(),
      code,
    }).toString(),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Threads token exchange failed (${res.status}): ${text}`);
  }
  const data = JSON.parse(text) as { access_token: string; user_id: string | number };
  // String(data.user_id) だと丸められた値になるため、生テキストから取り出す
  const userId = extractUserId(text) ?? String(data.user_id);
  return { accessToken: data.access_token, userId };
}

/** 短期トークン → 長期トークン（60日・自動更新の対象になる） */
export async function exchangeForLongLivedToken(
  shortLivedToken: string
): Promise<{ accessToken: string; expiresIn: number }> {
  const url = new URL(LONG_LIVED_URL);
  url.searchParams.set("grant_type", "th_exchange_token");
  url.searchParams.set("client_secret", ENV.threadsAppSecret);
  url.searchParams.set("access_token", shortLivedToken);
  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`Threads long-lived exchange failed (${res.status}): ${await res.text()}`);
  }
  const data = (await res.json()) as { access_token: string; expires_in: number };
  return { accessToken: data.access_token, expiresIn: data.expires_in };
}
