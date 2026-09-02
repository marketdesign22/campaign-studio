/**
 * 移行の前後で突き合わせるための件数レポート。
 *
 *   pnpm db:counts
 *
 * 何も書き込まない読み取り専用スクリプト。
 * マイグレーション前に一度、適用後にもう一度実行して差分が無いことを確認する。
 */
import "dotenv/config";
import mysql from "mysql2/promise";
import { buildDbConfig, describeDbTarget } from "../dbConfig";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  const dbName = new URL(url).pathname.replace(/^\//, "");
  console.log(`接続先: ${describeDbTarget(url)}\n`);
  const conn = await mysql.createConnection(buildDbConfig(url));

  const [tableRows] = await conn.query(
    "SELECT table_name AS t FROM information_schema.tables WHERE table_schema = ?",
    [dbName]
  );
  const present = new Set((tableRows as { t: string }[]).map((r) => r.t));

  async function count(sql: string, params: unknown[] = []): Promise<number> {
    const [rows] = await conn.query(sql, params);
    return Number((rows as { c: number }[])[0]?.c ?? 0);
  }

  console.log("== テーブル別 総件数 ==");
  for (const table of ["users", "settings", "accounts", "account_settings", "categories", "media", "posts", "post_logs", "post_analytics"]) {
    if (!present.has(table)) { console.log(`${table.padEnd(18)} (テーブル無し)`); continue; }
    console.log(`${table.padEnd(18)} ${await count(`SELECT COUNT(*) AS c FROM \`${table}\``)}`);
  }

  if (!present.has("accounts")) {
    console.log("\naccounts テーブルがまだありません。");
    await conn.end();
    return;
  }

  const [accountRows] = await conn.query(
    "SELECT id, name, threadsUserId, active FROM `accounts` ORDER BY id"
  );
  const accounts = accountRows as { id: number; name: string; threadsUserId: string; active: number }[];

  console.log("\n== アカウント別 件数 ==");
  for (const a of accounts) {
    const posts = await count("SELECT COUNT(*) AS c FROM `posts` WHERE accountId = ?", [a.id]);
    const logs = await count("SELECT COUNT(*) AS c FROM `post_logs` WHERE accountId = ?", [a.id]);
    const cats = present.has("categories")
      ? await count("SELECT COUNT(*) AS c FROM `categories` WHERE accountId = ?", [a.id])
      : 0;
    console.log(
      `#${a.id} ${a.name} (threadsUserId=${a.threadsUserId}, ${a.active ? "有効" : "停止中"})\n` +
      `    posts=${posts}  post_logs=${logs}  categories=${cats}`
    );
  }

  const orphanPosts = await count("SELECT COUNT(*) AS c FROM `posts` WHERE accountId IS NULL");
  const orphanLogs = await count("SELECT COUNT(*) AS c FROM `post_logs` WHERE accountId IS NULL");
  const orphanCats = present.has("categories")
    ? await count("SELECT COUNT(*) AS c FROM `categories` WHERE accountId IS NULL")
    : 0;

  console.log("\n== accountId 未設定（アカウント分離前の旧データ） ==");
  console.log(`posts       ${orphanPosts}`);
  console.log(`post_logs   ${orphanLogs}`);
  console.log(`categories  ${orphanCats}`);
  if (orphanPosts > 0 || orphanLogs > 0) {
    const primary = accounts[0];
    console.log(
      `\nこれらは現在、最初に作られたアカウント（#${primary?.id} ${primary?.name}）の\n` +
      "データとして読み出されます。DBは書き換わっていません。\n" +
      "所属を確定させるには:  pnpm db:backfill -- --account-id " + (primary?.id ?? "<id>")
    );
  }

  // 所属の判断材料: 未設定の投稿ログが、どのThreadsアカウントに実際に投稿されたか
  if (orphanLogs > 0) {
    const [sample] = await conn.query(
      "SELECT id, postedAt, threadsPostId, LEFT(content, 40) AS head FROM `post_logs` WHERE accountId IS NULL ORDER BY postedAt LIMIT 5"
    );
    console.log("\n未設定ログの先頭5件（所属の判断材料。threadsPostId から実投稿先を照合できます）:");
    console.table(sample);
  }

  await conn.end();
}

main().catch((e) => {
  console.error("失敗:", e);
  process.exit(1);
});
