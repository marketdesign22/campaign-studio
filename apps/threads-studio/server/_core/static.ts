import express, { type Express } from "express";
import fs from "fs";
import path from "path";

/**
 * 本番配信。ここには vite を import しないこと。
 * dist/index.js が起動時に vite（devDependency）を読み込むと、
 * 本番環境で開発用パッケージが無い場合にプロセスが起動できなくなる。
 */
export function serveStatic(app: Express) {
  const distPath =
    process.env.NODE_ENV === "development"
      ? path.resolve(import.meta.dirname, "../..", "dist", "public")
      : path.resolve(import.meta.dirname, "public");
  if (!fs.existsSync(distPath)) {
    console.error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`
    );
  }

  app.use(express.static(distPath));

  // fall through to index.html if the file doesn't exist
  app.use("*", (_req, res) => {
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
