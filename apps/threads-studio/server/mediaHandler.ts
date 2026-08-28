import type { Request, Response } from "express";
import { getMediaByToken } from "./db";

/**
 * アップロード画像の公開配信。
 * Threads は投稿時に画像を「公開URLから取得」する仕様のため、この経路には
 * 認証を掛けられない。代わりにランダムなtokenをURLに使い、推測を防いでいる。
 */
export async function mediaHandler(req: Request, res: Response) {
  const token = String(req.params.token ?? "");
  if (!/^[0-9a-f]{32}$/.test(token)) {
    res.status(404).end();
    return;
  }
  try {
    const row = await getMediaByToken(token);
    if (!row) {
      res.status(404).end();
      return;
    }
    const buf = Buffer.from(row.data, "base64");
    res.setHeader("Content-Type", row.mimeType);
    res.setHeader("Content-Length", String(buf.length));
    // 内容は不変なので長期キャッシュしてよい
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.end(buf);
  } catch (e) {
    console.error("[media] failed to serve", token, e);
    res.status(500).end();
  }
}
