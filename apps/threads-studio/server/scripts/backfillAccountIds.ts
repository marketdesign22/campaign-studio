/**
 * accountId が未設定の旧データに、所属アカウントを明示的に書き込む。
 *
 *   pnpm db:backfill                          → 対象件数を出すだけ（何も書かない）
 *   pnpm db:backfill -- --account-id 1        → 対象と移行先を表示（まだ書かない）
 *   pnpm db:backfill -- --account-id 1 --apply → 実際に書き込む
 *
 * 安全のための決めごと:
 * - 既に accountId が入っている行には一切触れない（他アカウントへ混ざらない）
 * - 内容・ID・日時・トークンは変更しない。埋めるのは accountId だけ
 * - --apply はトランザクションで実行し、途中で失敗したら全部戻す
 * - 移行先は必ず人間が --account-id で指定する。スクリプトが推測することはない
 *
 * 実行前に必ず pnpm db:export でバックアップを取り、pnpm db:counts で
 * 件数を控えておくこと。適用後にもう一度 db:counts を実行して突き合わせる。
 */
import "dotenv/config";
import mysql from "mysql2/promise";
import { buildDbConfig, describeDbTarget } from "../dbConfig";

/** accountId を埋める対象テーブル */
const TARGETS = ["posts", "post_logs", "categories"] as const;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  const dbName = new URL(url).pathname.replace(/^\//, "");
  console.log(`[backfill] 接続先: ${describeDbTarget(url)}\n`);
  const conn = await mysql.createConnection(buildDbConfig(url));

  async function count(table: string): Promise<number> {
    const [rows] = await conn.query(
      `SELECT COUNT(*) AS c FROM \`${table}\` WHERE accountId IS NULL`
    );
    return Number((rows as { c: number }[])[0]?.c ?? 0);
  }

  async function hasColumn(table: string): Promise<boolean> {
    const [rows] = await conn.query(
      "SELECT 1 FROM information_schema.columns WHERE table_schema = ? AND table_name = ? AND column_name = 'accountId'",
      [dbName, table]
    );
    return (rows as unknown[]).length > 0;
  }

  const pending: { table: string; rows: number }[] = [];
  for (const table of TARGETS) {
    if (!(await hasColumn(table))) {
      console.log(`[backfill] ${table}.accountId がありません。先に pnpm db:upgrade を実行してください。`);
      continue;
    }
    const c = await count(table);
    pending.push({ table, rows: c });
    console.log(`[backfill] ${table}: accountId 未設定 ${c} 件`);
  }

  const total = pending.reduce((s, p) => s + p.rows, 0);
  if (total === 0) {
    console.log("\n[backfill] 未設定の行はありません。何もしません。");
    await conn.end();
    return;
  }

  const raw = arg("account-id");
  if (!raw) {
    const [accounts] = await conn.query("SELECT id, name, threadsUserId FROM `accounts` ORDER BY id");
    console.log("\n[backfill] 移行先アカウントが未指定です。以下から選んで --account-id を付けてください:");
    console.table(accounts);
    console.log(
      "\n未設定の行がどのアカウントのものか確信が持てない場合は、実行しないでください。\n" +
      "post_logs.threadsPostId を Threads 側の投稿と照合すると所属を確認できます。"
    );
    await conn.end();
    return;
  }

  if (!/^\d+$/.test(raw)) throw new Error("--account-id には数値を指定してください");
  const accountId = Number(raw);
  const [accountRows] = await conn.query(
    "SELECT id, name, threadsUserId FROM `accounts` WHERE id = ?",
    [accountId]
  );
  const account = (accountRows as { id: number; name: string; threadsUserId: string }[])[0];
  if (!account) throw new Error(`アカウント #${accountId} が見つかりません`);

  console.log(
    `\n[backfill] 移行先: #${account.id} ${account.name} (threadsUserId=${account.threadsUserId})`
  );
  console.log(`[backfill] 対象合計: ${total} 件`);

  if (!process.argv.includes("--apply")) {
    console.log("\n[backfill] 予行のみで終了しました。実際に書き込むには --apply を付けてください。");
    await conn.end();
    return;
  }

  await conn.beginTransaction();
  try {
    const applied: Record<string, number> = {};
    for (const { table } of pending) {
      const [res] = await conn.query(
        `UPDATE \`${table}\` SET accountId = ? WHERE accountId IS NULL`,
        [accountId]
      );
      const affected = (res as mysql.ResultSetHeader).affectedRows;
      applied[table] = affected;
      console.log(`[backfill] ${table}: ${affected} 件を更新`);
    }
    await conn.commit();
    console.log("\n[backfill] 完了。pnpm db:counts で件数を突き合わせてください。");
    console.log(JSON.stringify(applied, null, 2));
  } catch (e) {
    await conn.rollback();
    console.error("[backfill] 失敗したためロールバックしました（DBは実行前のままです）:", e);
    process.exitCode = 1;
  } finally {
    await conn.end();
  }
}

main().catch((e) => {
  console.error("[backfill] 失敗:", e);
  process.exit(1);
});
