import { COOKIE_NAME, ONE_YEAR_MS, OAUTH_STATE_COOKIE } from "@shared/const";
import { randomUUID } from "node:crypto";
import { parse as parseCookieHeader } from "cookie";
import type { Express, Request, Response } from "express";
import { createRemoteJWKSet, jwtVerify } from "jose";
import * as db from "../db";
import { getSessionCookieOptions } from "./cookies";
import { ENV } from "./env";
import { sdk } from "./sdk";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_JWKS = createRemoteJWKSet(
  new URL("https://www.googleapis.com/oauth2/v3/certs")
);

function getQueryParam(req: Request, key: string): string | undefined {
  const value = req.query[key];
  return typeof value === "string" ? value : undefined;
}

/** APP_URL があればそれを、なければリバースプロキシのヘッダーからオリジンを導出する */
function getBaseUrl(req: Request): string {
  if (ENV.appUrl) return ENV.appUrl.replace(/\/$/, "");
  const proto =
    (req.headers["x-forwarded-proto"] as string | undefined)?.split(",")[0]?.trim() ||
    req.protocol;
  const host = req.headers["x-forwarded-host"] ?? req.headers.host;
  return `${proto}://${host}`;
}

type GoogleIdClaims = {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
};

async function verifyGoogleIdToken(idToken: string): Promise<GoogleIdClaims> {
  const { payload } = await jwtVerify(idToken, GOOGLE_JWKS, {
    issuer: ["https://accounts.google.com", "accounts.google.com"],
    audience: ENV.googleClientId,
  });
  if (typeof payload.sub !== "string" || !payload.sub) {
    throw new Error("Google ID token missing sub");
  }
  return payload as GoogleIdClaims;
}

function denied(res: Response, message: string) {
  res
    .status(403)
    .send(
      `<!doctype html><meta charset="utf-8"><body style="font-family:sans-serif;padding:3rem;text-align:center">` +
        `<h1 style="font-size:1.2rem">アクセスが許可されていません / Access denied</h1>` +
        `<p style="color:#666">${message}</p><p><a href="/">戻る / Back</a></p></body>`
    );
}

export function registerOAuthRoutes(app: Express) {
  // Step 1: redirect the browser to Google's consent screen.
  app.get("/api/auth/google", (req: Request, res: Response) => {
    if (!ENV.googleClientId || !ENV.googleClientSecret) {
      res.status(500).json({
        error:
          "Google OAuth is not configured. Set GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET.",
      });
      return;
    }

    const nonce = randomUUID();
    const cookieOptions = getSessionCookieOptions(req);
    res.cookie(OAUTH_STATE_COOKIE, nonce, {
      ...cookieOptions,
      maxAge: 10 * 60 * 1000,
    });

    const url = new URL(GOOGLE_AUTH_URL);
    url.searchParams.set("client_id", ENV.googleClientId);
    url.searchParams.set("redirect_uri", `${getBaseUrl(req)}/api/oauth/callback`);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "openid email profile");
    url.searchParams.set("state", nonce);
    url.searchParams.set("prompt", "select_account");

    res.redirect(302, url.toString());
  });

  // Step 2: Google redirects back with ?code & ?state.
  app.get("/api/oauth/callback", async (req: Request, res: Response) => {
    const code = getQueryParam(req, "code");
    const state = getQueryParam(req, "state");

    if (!code || !state) {
      res.status(400).json({ error: "code and state are required" });
      return;
    }

    // CSRF guard: `state` must match the one-time cookie set by /api/auth/google
    // in the browser that started this login.
    const expectedNonce = parseCookieHeader(req.headers.cookie ?? "")[OAUTH_STATE_COOKIE];
    if (!expectedNonce || state !== expectedNonce) {
      res.status(403).json({ error: "invalid oauth state" });
      return;
    }
    res.clearCookie(OAUTH_STATE_COOKIE, { path: "/" });

    try {
      const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: ENV.googleClientId,
          client_secret: ENV.googleClientSecret,
          redirect_uri: `${getBaseUrl(req)}/api/oauth/callback`,
          grant_type: "authorization_code",
        }),
      });
      if (!tokenRes.ok) {
        const body = await tokenRes.text();
        throw new Error(`Google token exchange failed (${tokenRes.status}): ${body}`);
      }
      const tokenJson = (await tokenRes.json()) as { id_token?: string };
      if (!tokenJson.id_token) {
        throw new Error("Google token response missing id_token");
      }

      const claims = await verifyGoogleIdToken(tokenJson.id_token);
      const email = (claims.email ?? "").toLowerCase();
      if (!email || claims.email_verified === false) {
        denied(res, "確認済みのメールアドレスを持つGoogleアカウントが必要です。");
        return;
      }

      const openId = `google:${claims.sub}`;
      const existing = await db.getUserByOpenId(openId);
      let role: "user" | "admin" | undefined;

      if (!existing) {
        // 新規ユーザーの受け入れ判定:
        // - ALLOWED_EMAILS 設定時: リストに載っているメールのみ
        // - 未設定時: 最初の1人だけを受け入れ、管理者にする
        const userCount = await db.countUsers();
        const isFirstUser = userCount === 0;
        const isAllowed =
          ENV.allowedEmails.length > 0
            ? ENV.allowedEmails.includes(email)
            : isFirstUser;
        if (!isAllowed) {
          denied(
            res,
            "このアプリの利用は招待制です。管理者に ALLOWED_EMAILS への追加を依頼してください。"
          );
          return;
        }
        role = isFirstUser ? "admin" : "user";
      }

      await db.upsertUser({
        openId,
        name: claims.name || null,
        email: claims.email ?? null,
        loginMethod: "google",
        lastSignedIn: new Date(),
        ...(role ? { role } : {}),
      });

      const sessionToken = await sdk.createSessionToken(openId, {
        name: claims.name || "",
        expiresInMs: ONE_YEAR_MS,
      });

      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });

      res.redirect(302, "/");
    } catch (error) {
      console.error("[OAuth] Callback failed", error);
      res.status(500).json({ error: "OAuth callback failed" });
    }
  });
}
