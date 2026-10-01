/**
 * 本番の静的配信のキャッシュヘッダー。
 * index.html は毎回サーバーから取らせ（no-store）、ハッシュ付き assets は長期キャッシュにする。
 * デプロイ後に端末が古い index.html を使って存在しないJSを読みに行き、真っ白になる事故を防ぐ。
 */
import express from "express";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ASSET_CACHE_CONTROL, cacheControlFor, HTML_CACHE_CONTROL, serveStatic } from "./_core/static";

let server: Server;
let base = "";
let dist = "";

beforeAll(async () => {
  dist = fs.mkdtempSync(path.join(os.tmpdir(), "threads-studio-dist-"));
  fs.mkdirSync(path.join(dist, "assets"));
  fs.writeFileSync(path.join(dist, "index.html"), "<!doctype html><div id=root></div>");
  fs.writeFileSync(path.join(dist, "assets", "index-abc123.js"), "console.log(1)");
  const app = express();
  serveStatic(app, dist);
  await new Promise<void>((resolve) => { server = app.listen(0, resolve); });
  const address = server.address();
  base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
});
afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  fs.rmSync(dist, { recursive: true, force: true });
});

describe("serveStatic のキャッシュ制御", () => {
  it("index.html（トップ）は no-store", async () => {
    const res = await fetch(`${base}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe(HTML_CACHE_CONTROL);
  });

  it("SPA のフォールバック（任意のパス）も index.html を no-store で返す", async () => {
    const res = await fetch(`${base}/trends`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("id=root");
    expect(res.headers.get("cache-control")).toBe(HTML_CACHE_CONTROL);
  });

  it("ハッシュ付き assets は1年間 immutable", async () => {
    const res = await fetch(`${base}/assets/index-abc123.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe(ASSET_CACHE_CONTROL);
  });

  it("cacheControlFor はパス区切りに依らず assets を判定する", () => {
    expect(cacheControlFor("/srv/dist/public/assets/index-x.js")).toBe(ASSET_CACHE_CONTROL);
    expect(cacheControlFor("C:\\srv\\dist\\public\\assets\\index-x.js")).toBe(ASSET_CACHE_CONTROL);
    expect(cacheControlFor("/srv/dist/public/index.html")).toBe(HTML_CACHE_CONTROL);
    expect(cacheControlFor("/srv/dist/public/favicon.ico")).toBe(HTML_CACHE_CONTROL);
  });
});
