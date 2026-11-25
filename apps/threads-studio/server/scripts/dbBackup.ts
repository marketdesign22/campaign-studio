/**
 * DBのバックアップ（エクスポート）と復元（インポート）。
 *
 *   pnpm db:export                  → backups/threads-studio-<UTC時刻>.json を作成
 *   pnpm db:export -- --out path    → 出力先を指定
 *   pnpm db:import -- --file path                  → 中身を確認するだけ（何も書かない）
 *   pnpm db:import -- --file path --confirm-restore → 実際に復元する
 *
 * 復元は「全テーブルを消してからファイルの内容を入れ直す」ため、
 * --confirm-restore を付けたときだけ実行される。
 * 本番の一次バックアップは mysqldump を推奨（docs/multi-account.md 参照）。
 * これはmysqldumpが使えない環境向けの代替と、移行前後の突き合わせ用。
 *
 * ⚠ 出力ファイルには accounts テーブルの Threads アクセストークンなど、
 *   全テーブルの生データがそのまま入る。このリポジトリは公開されているので:
 *   - 絶対にコミットしない（backups/ は .gitignore 済みだが、--out で別の場所に
 *     出した場合は守られない）
 *   - 作成後はリポジトリの外（暗号化されたストレージ等）へ移し、作業フォルダには残さない
 *   - チャット・Issue・PR などに貼らない
 */
import "dotenv/config";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import mysql from "mysql2/promise";
import { buildDbConfig, describeDbTarget } from "../dbConfig";

/** バックアップ対象。順序は外部キー的な依存の浅い順（復元時にこの順で入れる） */
const TABLES = [
  "users",
  "settings",
  "accounts",
  "account_settings",
  "categories",
  "media",
  "posts",
  "post_logs",
  "post_analytics",
] as const;

type Backup = {
  exportedAt: string;
  tables: Record<string, Record<string, unknown>[]>;
  counts: Record<string, number>;
};

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function connect() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  console.log(`[backup] 接続先: ${describeDbTarget(url)}`);
  return mysql.createConnection(buildDbConfig(url));
}

async function existingTables(conn: mysql.Connection, dbName: string): Promise<Set<string>> {
  const [rows] = await conn.query(
    "SELECT table_name AS t FROM information_schema.tables WHERE table_schema = ?",
    [dbName]
  );
  return new Set((rows as { t: string }[]).map((r) => r.t));
}

async function runExport() {
  const url = process.env.DATABASE_URL!;
  const dbName = new URL(url).pathname.replace(/^\//, "");
  const conn = await connect();
  const present = await existingTables(conn, dbName);

  const backup: Backup = { exportedAt: new Date().toISOString(), tables: {}, counts: {} };
  for (const table of TABLES) {
    if (!present.has(table)) {
      console.log(`[backup] ${table} は存在しないためスキップ`);
      continue;
    }
    const [rows] = await conn.query(`SELECT * FROM \`${table}\``);
    const list = rows as Record<string, unknown>[];
    backup.tables[table] = list;
    backup.counts[table] = list.length;
    console.log(`[backup] ${table}: ${list.length} 件`);
  }

  const stamp = backup.exportedAt.replace(/[:.]/g, "-");
  const out = resolve(arg("out") ?? `backups/threads-studio-${stamp}.json`);
  mkdirSync(dirname(out), { recursive: true });
  // トークンを含むため、新規作成時は本人だけが読める権限にする
  writeFileSync(out, JSON.stringify(backup, null, 2), { encoding: "utf8", mode: 0o600 });
  console.log(`\n[backup] 保存しました: ${out}`);
  console.log("[backup] ⚠ このファイルには Threads のアクセストークンが含まれます。コミットせず、リポジトリの外に保管してください。");
  console.log("[backup] 復元は  pnpm db:import -- --file <path> --confirm-restore");
  await conn.end();
}

async function runImport() {
  const file = arg("file");
  if (!file) throw new Error("--file <path> を指定してください");
  const backup = JSON.parse(readFileSync(resolve(file), "utf8")) as Backup;
  console.log(`[restore] ファイル: ${file}（取得時刻 ${backup.exportedAt}）`);
  for (const [table, rows] of Object.entries(backup.tables)) {
    console.log(`[restore] ${table}: ${rows.length} 件`);
  }

  if (!process.argv.includes("--confirm-restore")) {
    console.log("\n[restore] 確認のみで終了しました。実際に復元するには --confirm-restore を付けてください。");
    return;
  }

  const url = process.env.DATABASE_URL!;
  const dbName = new URL(url).pathname.replace(/^\//, "");
  const conn = await connect();
  const present = await existingTables(conn, dbName);

  await conn.beginTransaction();
  try {
    // 依存の深い順に消してから、浅い順に入れ直す
    for (const table of [...TABLES].reverse()) {
      if (!present.has(table) || !backup.tables[table]) continue;
      await conn.query(`DELETE FROM \`${table}\``);
    }
    for (const table of TABLES) {
      const rows = backup.tables[table];
      if (!present.has(table) || !rows || rows.length === 0) continue;
      const columns = Object.keys(rows[0]);
      const placeholders = `(${columns.map(() => "?").join(", ")})`;
      const sql =
        `INSERT INTO \`${table}\` (${columns.map((c) => `\`${c}\``).join(", ")}) VALUES ` +
        rows.map(() => placeholders).join(", ");
      await conn.query(sql, rows.flatMap((r) => columns.map((c) => r[c] ?? null)));
      console.log(`[restore] ${table}: ${rows.length} 件を復元`);
    }
    await conn.commit();
    console.log("\n[restore] 完了");
  } catch (e) {
    await conn.rollback();
    console.error("[restore] 失敗したためロールバックしました:", e);
    process.exitCode = 1;
  } finally {
    await conn.end();
  }
}

const mode = process.argv.includes("--import") ? runImport : runExport;
mode().catch((e) => {
  console.error("[backup] 失敗:", e);
  process.exit(1);
});
