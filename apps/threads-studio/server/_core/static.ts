import express, { type Express, type Response } from "express";
import fs from "fs";
import path from "path";

/**
 * 本番配信。ここには vite を import しないこと。
 * dist/index.js が起動時に vite（devDependency）を読み込むと、
 * 本番環境で開発用パッケージが無い場合にプロセスが起動できなくなる。
 *
 * キャッシュの方針:
 * - /assets/ 配下はファイル名にハッシュが入るので1年間 immutable
 * - index.html などそれ以外は no-store。デプロイで assets のファイル名が変わったあと、
 *   端末（特にiOS Safari・ホーム画面に追加したアプリ）が古い index.html を使い続けると
 *   存在しないJSを読みに行って真っ白になるため、HTMLは毎回サーバーから取らせる
 */
export const ASSET_CACHE_CONTROL = "public, max-age=31536000, immutable";
export const HTML_CACHE_CONTROL = "no-store";

export function cacheControlFor(filePath: string): string {
  return /[\\/]assets[\\/]/.test(filePath) ? ASSET_CACHE_CONTROL : HTML_CACHE_CONTROL;
}

function defaultDistPath(): string {
  return process.env.NODE_ENV === "development"
    ? path.resolve(import.meta.dirname, "../..", "dist", "public")
    : path.resolve(import.meta.dirname, "public");
}

export function serveStatic(app: Express, distPath: string = defaultDistPath()) {
  if (!fs.existsSync(distPath)) {
    console.error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`
    );
  }

  app.use(express.static(distPath, {
    setHeaders(res: Response, filePath: string) {
      res.setHeader("Cache-Control", cacheControlFor(filePath));
    },
  }));

  // fall through to index.html if the file doesn't exist
  app.use("*", (_req, res) => {
    res.sendFile(path.resolve(distPath, "index.html"), { headers: { "Cache-Control": HTML_CACHE_CONTROL } });
  });
}
