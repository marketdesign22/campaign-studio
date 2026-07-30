/**
 * Idempotent DB upgrade script.
 *
 * The historical drizzle migration chain is out of sync with the deployed
 * database (columns were added outside drizzle), so this script inspects
 * information_schema and applies only what is missing. Safe to run any
 * number of times.
 *
 *   pnpm db:upgrade   (requires DATABASE_URL)
 */
import "dotenv/config";
import mysql from "mysql2/promise";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  const conn = await mysql.createConnection(url);
  const dbName = new URL(url).pathname.replace(/^\//, "");

  async function hasTable(table: string): Promise<boolean> {
    const [rows] = await conn.query(
      "SELECT 1 FROM information_schema.tables WHERE table_schema = ? AND table_name = ?",
      [dbName, table]
    );
    return (rows as unknown[]).length > 0;
  }

  async function hasColumn(table: string, column: string): Promise<boolean> {
    const [rows] = await conn.query(
      "SELECT 1 FROM information_schema.columns WHERE table_schema = ? AND table_name = ? AND column_name = ?",
      [dbName, table, column]
    );
    return (rows as unknown[]).length > 0;
  }

  async function addColumn(table: string, column: string, ddl: string) {
    if (await hasColumn(table, column)) return;
    console.log(`[upgrade] ${table}.${column} を追加`);
    await conn.query(`ALTER TABLE \`${table}\` ADD COLUMN ${ddl}`);
  }

  // ── accounts table ──────────────────────────────────────────────────────────
  if (!(await hasTable("accounts"))) {
    console.log("[upgrade] accounts テーブルを作成");
    await conn.query(`
      CREATE TABLE \`accounts\` (
        \`id\` int AUTO_INCREMENT PRIMARY KEY,
        \`name\` varchar(64) NOT NULL,
        \`threadsUserId\` varchar(64) NOT NULL,
        \`threadsAccessToken\` text NOT NULL,
        \`tokenRefreshedAt\` timestamp NULL,
        \`tokenExpiresAt\` timestamp NULL,
        \`morningHour\` int NOT NULL DEFAULT 8,
        \`morningMinute\` int NOT NULL DEFAULT 0,
        \`eveningHour\` int NOT NULL DEFAULT 18,
        \`eveningMinute\` int NOT NULL DEFAULT 0,
        \`timezone\` enum('LA','JP','ET','CT','MT') NOT NULL DEFAULT 'LA',
        \`active\` boolean NOT NULL DEFAULT true,
        \`createdAt\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updatedAt\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);
  }

  // ── posts ───────────────────────────────────────────────────────────────────
  await addColumn("posts", "approvalStatus", "`approvalStatus` enum('draft','approved') NOT NULL DEFAULT 'approved'");
  await addColumn("posts", "accountId", "`accountId` int NULL");

  // ── post_logs ───────────────────────────────────────────────────────────────
  await addColumn("post_logs", "accountId", "`accountId` int NULL");

  // ── settings ────────────────────────────────────────────────────────────────
  await addColumn("settings", "requireApproval", "`requireApproval` boolean NOT NULL DEFAULT false");
  await addColumn("settings", "notifyOnError", "`notifyOnError` boolean NOT NULL DEFAULT true");
  await addColumn("settings", "brandName", "`brandName` varchar(64) NULL");
  await addColumn("settings", "brandAccent", "`brandAccent` varchar(16) NULL");
  await addColumn("settings", "lastMaintenanceDate", "`lastMaintenanceDate` varchar(10) NULL");

  // ── timezone enum拡張（米国タイムゾーン ET/CT/MT を追加） ────────────────────
  async function widenTimezoneEnum(table: string) {
    const [rows] = await conn.query(
      "SELECT COLUMN_TYPE AS t FROM information_schema.columns WHERE table_schema = ? AND table_name = ? AND column_name = 'timezone'",
      [dbName, table]
    );
    const colType = (rows as { t: string }[])[0]?.t ?? "";
    if (colType && !colType.includes("'ET'")) {
      console.log(`[upgrade] ${table}.timezone enum を拡張 (ET/CT/MT)`);
      await conn.query(
        `ALTER TABLE \`${table}\` MODIFY COLUMN \`timezone\` enum('LA','JP','ET','CT','MT') NOT NULL DEFAULT 'LA'`
      );
    }
  }
  await widenTimezoneEnum("settings");
  await widenTimezoneEnum("accounts");

  // ── data migration: settings 単一トークン → accounts ────────────────────────
  const [accountRows] = await conn.query("SELECT COUNT(*) AS c FROM `accounts`");
  const accountCount = (accountRows as { c: number }[])[0]?.c ?? 0;
  if (accountCount === 0) {
    const [settingRows] = await conn.query(
      "SELECT threadsAccessToken, threadsUserId, morningHour, morningMinute, eveningHour, eveningMinute, timezone FROM `settings` LIMIT 1"
    );
    const s = (settingRows as Record<string, unknown>[])[0];
    if (s?.threadsAccessToken && s?.threadsUserId) {
      console.log("[upgrade] 既存のsettingsトークンをaccountsへ移行");
      await conn.query(
        `INSERT INTO \`accounts\`
          (name, threadsUserId, threadsAccessToken, morningHour, morningMinute, eveningHour, eveningMinute, timezone)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          "メインアカウント",
          s.threadsUserId,
          s.threadsAccessToken,
          s.morningHour ?? 8,
          s.morningMinute ?? 0,
          s.eveningHour ?? 18,
          s.eveningMinute ?? 0,
          s.timezone ?? "LA",
        ]
      );
    }
  }

  console.log("[upgrade] 完了");
  await conn.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
