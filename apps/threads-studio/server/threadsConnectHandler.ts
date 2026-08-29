import type { Request, Response } from "express";
import { createAccount, getAccountByThreadsUserId, updateAccount } from "./db";
import { getThreadsProfile } from "./threadsApi";
import {
  exchangeCodeForToken,
  exchangeForLongLivedToken,
  verifyConnectState,
} from "./threadsOAuth";

/** クライアントに見せる完了/エラー画面（ログイン不要なのでHTMLを直接返す） */
function page(title: string, body: string, ok: boolean): string {
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>
  body{font-family:system-ui,-apple-system,"Hiragino Sans","Noto Sans JP",sans-serif;
       margin:0;min-height:100vh;display:grid;place-items:center;background:#f6f6f4;color:#1c1c1c}
  .card{background:#fff;border-radius:16px;padding:40px 32px;max-width:420px;width:calc(100% - 32px);
        box-shadow:0 1px 3px rgba(0,0,0,.08);text-align:center}
  .mark{width:56px;height:56px;border-radius:50%;display:grid;place-items:center;margin:0 auto 20px;
        font-size:28px;background:${ok ? "#e7f6ec" : "#fdecec"}}
  h1{font-size:19px;margin:0 0 10px}
  p{font-size:14px;line-height:1.7;color:#555;margin:0}
</style></head><body><div class="card">
<div class="mark">${ok ? "✓" : "!"}</div><h1>${title}</h1><p>${body}</p>
</div></body></html>`;
}

/**
 * Threads OAuth のコールバック。
 * クライアントがThreadsで許可した直後にここへ戻ってくる（未ログインで到達する）。
 * state（署名済みJWT）が正しい場合だけアカウントを登録・更新する。
 */
export async function threadsConnectHandler(req: Request, res: Response) {
  const code = typeof req.query.code === "string" ? req.query.code : undefined;
  const state = typeof req.query.state === "string" ? req.query.state : undefined;

  if (typeof req.query.error === "string") {
    res.status(400).send(
      page("連携がキャンセルされました", "もう一度お試しいただくか、担当者にご連絡ください。", false)
    );
    return;
  }
  if (!code || !state) {
    res.status(400).send(page("リンクが正しくありません", "担当者に新しい連携リンクの発行を依頼してください。", false));
    return;
  }

  try {
    const { accountName } = await verifyConnectState(state);
    const short = await exchangeCodeForToken(code);
    const long = await exchangeForLongLivedToken(short.accessToken);

    // 表示名の取得は失敗しても連携自体は成立させる
    let username: string | null = null;
    try {
      username = (await getThreadsProfile(long.accessToken)).username ?? null;
    } catch {
      /* ignore */
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + long.expiresIn * 1000);
    const existing = await getAccountByThreadsUserId(short.userId);

    if (existing) {
      // 再連携: トークンを差し替えるだけ（予約投稿や履歴はそのまま残る）
      await updateAccount(existing.id, {
        threadsAccessToken: long.accessToken,
        tokenRefreshedAt: now,
        tokenExpiresAt: expiresAt,
        active: true,
      });
    } else {
      await createAccount({
        name: accountName || username || "連携アカウント",
        threadsUserId: short.userId,
        threadsAccessToken: long.accessToken,
        tokenRefreshedAt: now,
        tokenExpiresAt: expiresAt,
      });
    }

    res.send(
      page(
        "連携が完了しました",
        `${username ? `@${username} の` : ""}Threadsアカウントを連携しました。この画面は閉じていただいて大丈夫です。`,
        true
      )
    );
  } catch (e) {
    console.error("[threads-connect] failed", e);
    res.status(400).send(
      page(
        "連携に失敗しました",
        "リンクの有効期限が切れている可能性があります。担当者に新しいリンクの発行を依頼してください。",
        false
      )
    );
  }
}
