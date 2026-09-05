/**
 * 起動時マイグレーション（pnpm db:upgrade）の冪等性。
 *
 * mysql2 を差し替え、information_schema の問い合わせに「今あるもの」を答える
 * 偽DBを用意する。1回目でトレンド関連のテーブル・列・索引が作られ、
 * 2回目は DDL が1本も流れないこと、破壊的な文が一切無いことを確かめる。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type TableState = { columns: Set<string>; indexes: Set<string> };
const tables = new Map<string, TableState>();
const ddl: string[] = [];
let mainConnectionEnded: () => void = () => {};

function ensure(table: string): TableState {
  let t = tables.get(table);
  if (!t) {
    t = { columns: new Set(), indexes: new Set() };
    tables.set(table, t);
  }
  return t;
}

function applyDdl(sql: string) {
  // データベース自体の作成は IF NOT EXISTS で常に安全なので DDL として数えない
  if (/^\s*CREATE DATABASE/i.test(sql)) return;
  ddl.push(sql.trim());
  let m = sql.match(/CREATE TABLE `(\w+)`/);
  if (m) {
    const t = ensure(m[1]);
    for (const line of sql.split("\n")) {
      const col = line.match(/^\s*`(\w+)`/);
      if (col) t.columns.add(col[1]);
      const idx = line.match(/UNIQUE KEY `(\w+)`/);
      if (idx) t.indexes.add(idx[1]);
    }
    return;
  }
  m = sql.match(/ALTER TABLE `(\w+)` ADD COLUMN `(\w+)`/);
  if (m) { ensure(m[1]).columns.add(m[2]); return; }
  m = sql.match(/CREATE (?:UNIQUE )?INDEX `(\w+)` ON `(\w+)`/);
  if (m) { ensure(m[2]).indexes.add(m[1]); return; }
  throw new Error(`unexpected statement in test: ${sql.slice(0, 80)}`);
}

/** 以前からある初期行・引き継ぎ用の INSERT/UPDATE（このテストの対象外だが、流れは記録する） */
const dml: string[] = [];

function fakeQuery(sql: string, params?: unknown[]): Promise<[unknown[], unknown]> {
  const s = sql.trim();
  if (/information_schema\.tables/i.test(s)) {
    return Promise.resolve([tables.has(String(params?.[1])) ? [{ 1: 1 }] : [], []]);
  }
  // 列型の照会（timezone enum の拡張判定）は「既に拡張済み」として扱う
  if (/COLUMN_TYPE/i.test(s)) return Promise.resolve([[], []]);
  if (/^SELECT COUNT\(\*\)/i.test(s)) return Promise.resolve([[{ c: 1 }], []]);
  if (/^SELECT/i.test(s) && !/information_schema/i.test(s)) return Promise.resolve([[], []]);
  if (/^(INSERT|UPDATE)/i.test(s)) { dml.push(s); return Promise.resolve([[], []]); }
  if (/information_schema\.columns/i.test(s)) {
    const t = tables.get(String(params?.[1]));
    return Promise.resolve([t?.columns.has(String(params?.[2])) ? [{ 1: 1 }] : [], []]);
  }
  if (/information_schema\.statistics/i.test(s)) {
    const t = tables.get(String(params?.[1]));
    return Promise.resolve([t?.indexes.has(String(params?.[2])) ? [{ 1: 1 }] : [], []]);
  }
  applyDdl(s);
  return Promise.resolve([[], []]);
}

vi.mock("dotenv/config", () => ({}));
vi.mock("mysql2/promise", () => ({
  default: {
    createConnection: async (cfg: { database?: string }) => ({
      query: fakeQuery,
      end: async () => { if (cfg.database) mainConnectionEnded(); },
    }),
  },
}));

async function runUpgradeOnce() {
  vi.resetModules();
  const finished = new Promise<void>((resolve) => { mainConnectionEnded = resolve; });
  await import("./scripts/upgradeDb");
  await finished;
}

beforeEach(() => {
  tables.clear();
  ddl.length = 0;
  dml.length = 0;
  process.env.DATABASE_URL = "mysql://user:pass@127.0.0.1:3306/threads_studio_test";
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(process, "exit").mockImplementation((() => { throw new Error("exit called"); }) as never);
});

describe("db:upgrade", () => {
  it("空のDBにトレンド関連のテーブル・列・索引・ユニーク制約を作る", async () => {
    await runUpgradeOnce();
    for (const t of ["trend_settings", "trend_posts", "trend_analyses"]) expect(tables.has(t)).toBe(true);
    expect(tables.get("posts")!.columns.has("trendAnalysisId")).toBe(true);
    expect(tables.get("posts")!.columns.has("trendMeta")).toBe(true);
    expect(tables.get("trend_settings")!.columns.has("lastFetchError")).toBe(true);
    expect(tables.get("trend_posts")!.indexes.has("uniq_trend_post")).toBe(true);
    expect(tables.get("trend_posts")!.indexes.has("idx_trend_posts_account_fetched")).toBe(true);
    expect(tables.get("trend_posts")!.indexes.has("idx_trend_posts_account_status")).toBe(true);
    expect(tables.get("trend_analyses")!.indexes.has("idx_trend_analyses_account")).toBe(true);
    expect(tables.get("posts")!.indexes.has("idx_posts_trend")).toBe(true);
  });

  it("空のDBに受信箱（返信管理）関連のテーブル・列・索引・ユニーク制約を作る", async () => {
    await runUpgradeOnce();
    expect(tables.has("thread_replies")).toBe(true);
    expect(tables.get("accounts")!.columns.has("lastReplyFetchAt")).toBe(true);
    expect(tables.get("accounts")!.columns.has("lastReplyFetchError")).toBe(true);
    expect(tables.get("accounts")!.columns.has("threadsUsername")).toBe(true);
    expect(tables.get("thread_replies")!.indexes.has("uniq_thread_reply")).toBe(true);
    expect(tables.get("thread_replies")!.indexes.has("idx_thread_replies_account_status")).toBe(true);
    expect(tables.get("thread_replies")!.indexes.has("idx_thread_replies_account_posted")).toBe(true);
  });

  it("空のDBに自動返信テンプレートのテーブル・索引を作る", async () => {
    await runUpgradeOnce();
    expect(tables.has("reply_templates")).toBe(true);
    expect(tables.get("reply_templates")!.indexes.has("idx_reply_templates_account")).toBe(true);
  });

  it("空のDBにエンゲージメント（コメント送信履歴）のテーブル・索引を作る", async () => {
    await runUpgradeOnce();
    expect(tables.has("engagement_comments")).toBe(true);
    expect(tables.get("engagement_comments")!.indexes.has("idx_engagement_comments_account_sent")).toBe(true);
    expect(tables.get("engagement_comments")!.indexes.has("idx_engagement_comments_target")).toBe(true);
  });

  it("2回目以降はDDLを1本も流さない（冪等）", async () => {
    await runUpgradeOnce();
    const first = ddl.length;
    expect(first).toBeGreaterThan(0);
    ddl.length = 0;
    await runUpgradeOnce();
    expect(ddl).toEqual([]);
    await runUpgradeOnce();
    expect(ddl).toEqual([]);
  });

  it("既存テーブルだけがある環境（以前のデプロイ）には不足分だけ足す", async () => {
    // 以前のデプロイで作られた posts と、lastFetchError の無い trend_settings を再現
    ensure("posts").columns.add("id");
    const ts = ensure("trend_settings");
    for (const c of ["id", "accountId", "keywords", "lastFetchKey", "lastFetchAt"]) ts.columns.add(c);
    await runUpgradeOnce();
    expect(ddl.some((d) => /ALTER TABLE `posts` ADD COLUMN `trendAnalysisId`/.test(d))).toBe(true);
    expect(ddl.some((d) => /ALTER TABLE `trend_settings` ADD COLUMN `lastFetchError`/.test(d))).toBe(true);
    expect(ddl.some((d) => /CREATE TABLE `trend_settings`/.test(d))).toBe(false);
  });

  it("トレンド関連は既存データを変更・削除する文を含まず、行の書き込みもしない", async () => {
    await runUpgradeOnce();
    for (const d of ddl) {
      expect(d).not.toMatch(/\b(DROP|DELETE|TRUNCATE|MODIFY|CHANGE|RENAME)\b/i);
    }
    expect(dml.filter((d) => /trend/i.test(d))).toEqual([]);
  });
});
