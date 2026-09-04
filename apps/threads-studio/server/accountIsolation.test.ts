/**
 * アカウント分離のSQLレベル検証。
 *
 * mysql2 のプールを差し替えて、db.ts が実際に発行するSQLと引数を捕まえる。
 * 「画面で絞っているだけ」ではなく、クエリそのものが他アカウントの行に
 * 到達できないことを確かめるのが目的。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const queries: { sql: string; params: unknown[] }[] = [];
let nextRows: unknown[] = [];

vi.mock("mysql2", () => ({
  createPool: () => {
    const fake: Record<string | symbol, unknown> = new Proxy(
      {},
      {
        get(_t, prop) {
          if (prop === "then") return undefined;
          if (prop === "query" || prop === "execute") {
            // drizzle は query({ sql, rowsAsArray }, params) の形で呼ぶ
            return (opts: { sql?: string } | string, params?: unknown[]) => {
              queries.push({
                sql: typeof opts === "string" ? opts : (opts.sql ?? ""),
                params: params ?? [],
              });
              return Promise.resolve([nextRows, []]);
            };
          }
          return () => fake;
        },
      }
    );
    return fake;
  },
}));

process.env.DATABASE_URL = "mysql://user:pass@127.0.0.1:1/threads_studio_test";

import {
  deletePostsByIds, getAnalyticsSummary, getEvergreenCandidate, getMonthlyReport,
  getNextPendingPost, getOwnedPost, getSnapshotBefore, hasSlotLogInRange, listCategories,
  listFollowerSnapshots, listPostLogs, listPosts, recordFollowerSnapshot,
} from "./db";
import type { AccountScope } from "./accountScope";

/** SCSU.Japan — 最初に作られたアカウント。accountId 未設定の旧データの持ち主 */
const SCSU: AccountScope = { accountId: 1, includeLegacy: true };
/** creaw.usa — 後から追加されたアカウント。旧データは一切見えない */
const CREAW: AccountScope = { accountId: 2, includeLegacy: false };

function lastQuery() {
  return queries[queries.length - 1];
}

/** 発行されたSQLが accountId で絞られているか */
function scopedTo(accountId: number) {
  const { sql, params } = lastQuery();
  expect(sql).toMatch(/`accountId` = \?/);
  expect(params).toContain(accountId);
}

/** 旧データ（accountId IS NULL）を含めているか */
function includesLegacy(): boolean {
  return /`accountId` is null/.test(lastQuery().sql);
}

beforeEach(() => {
  queries.length = 0;
  nextRows = [];
});

describe("投稿原稿 / カレンダー", () => {
  it("creaw.usa では accountId = 2 の原稿しか取得しない", async () => {
    await listPosts(CREAW);
    scopedTo(2);
    expect(includesLegacy()).toBe(false);
    expect(lastQuery().params).not.toContain(1);
  });

  it("SCSU では自分の原稿と、所属未設定の旧原稿を取得する", async () => {
    await listPosts(SCSU);
    scopedTo(1);
    expect(includesLegacy()).toBe(true);
  });

  it("他アカウントの原稿IDを渡しても取得条件にアカウントが入る", async () => {
    await getOwnedPost(123, CREAW);
    const { sql, params } = lastQuery();
    expect(sql).toMatch(/`id` = \?/);
    scopedTo(2);
    expect(params).toContain(123);
    expect(sql).not.toMatch(/`accountId` is null/);
  });
});

describe("投稿履歴", () => {
  it("creaw.usa の履歴に旧ログ（accountId 未設定）が混ざらない", async () => {
    await listPostLogs(50, CREAW);
    scopedTo(2);
    expect(includesLegacy()).toBe(false);
  });

  it("SCSU の履歴には旧ログが含まれる", async () => {
    await listPostLogs(50, SCSU);
    expect(includesLegacy()).toBe(true);
  });
});

describe("自動投稿の対象抽出", () => {
  it("creaw.usa のスロットは creaw.usa の原稿しか拾わない", async () => {
    await getNextPendingPost(0, "2026-09-01", CREAW);
    scopedTo(2);
    expect(includesLegacy()).toBe(false);
  });

  it("再投稿コンテンツもアカウントを跨がない", async () => {
    await getEvergreenCandidate(CREAW, 30);
    scopedTo(2);
    expect(includesLegacy()).toBe(false);
  });

  it("二重投稿ロックはアカウントごとに独立している", async () => {
    // 旧実装では accountId 未設定のログが全アカウントの枠を塞いでいた
    await hasSlotLogInRange(CREAW, 0, new Date(0), new Date(1));
    scopedTo(2);
    expect(includesLegacy()).toBe(false);
  });
});

describe("分析・月次レポート", () => {
  it("集計対象のログがアカウントで絞られる", async () => {
    await getAnalyticsSummary("month", CREAW);
    const logQuery = queries.find((q) => /from `post_logs`/.test(q.sql));
    expect(logQuery).toBeDefined();
    expect(logQuery!.sql).toMatch(/`accountId` = \?/);
    expect(logQuery!.params).toContain(2);
    expect(logQuery!.sql).not.toMatch(/`accountId` is null/);
  });

  it("月次レポートも同じスコープで集計する", async () => {
    await getMonthlyReport(2026, 9, CREAW);
    const logQuery = queries.find((q) => /from `post_logs`/.test(q.sql));
    expect(logQuery!.params).toContain(2);
    expect(logQuery!.sql).not.toMatch(/`accountId` is null/);
  });

  it("ログが0件なら分析テーブルへは問い合わせない（他アカウント分を拾わない）", async () => {
    nextRows = [];
    await getAnalyticsSummary("month", CREAW);
    expect(queries.some((q) => /from `post_analytics`/.test(q.sql))).toBe(false);
  });
});

describe("破壊的操作", () => {
  it("一括削除は自アカウントの行にしか当たらない", async () => {
    await deletePostsByIds([10, 11], CREAW);
    const { sql, params } = lastQuery();
    expect(sql).toMatch(/^delete from `posts`/);
    expect(sql).toMatch(/`accountId` = \?/);
    expect(params).toContain(2);
    expect(sql).not.toMatch(/`accountId` is null/);
  });

  it("削除対象が空なら一切SQLを発行しない", async () => {
    await deletePostsByIds([], CREAW);
    expect(queries).toHaveLength(0);
  });
});

describe("フォロワー履歴", () => {
  it("読み出しは指定アカウントのみ（他アカウントの履歴が混ざらない）", async () => {
    await listFollowerSnapshots(30001);
    const { sql, params } = lastQuery();
    expect(sql).toMatch(/from `follower_snapshots`/);
    expect(sql).toMatch(/`accountId` = \?/);
    expect(params).toContain(30001);
  });

  it("期間の基準点もアカウントで絞る", async () => {
    await getSnapshotBefore(30001, "2026-09-01");
    const { sql, params } = lastQuery();
    expect(sql).toMatch(/`accountId` = \?/);
    expect(params).toContain(30001);
    expect(params).toContain("2026-09-01");
  });

  it("同じ日に複数回取得しても行を増やさず更新する", async () => {
    await recordFollowerSnapshot(1, "2026-09-02", 1250);
    const { sql, params } = lastQuery();
    expect(sql).toMatch(/^insert into `follower_snapshots`/);
    expect(sql).toMatch(/on duplicate key update/);
    expect(params).toContain(1250);
  });

  it("負数は保存しない", async () => {
    await recordFollowerSnapshot(1, "2026-09-02", -5);
    expect(queries).toHaveLength(0);
  });
});

describe("カテゴリー", () => {
  it("自アカウントのものと、分離前からある共通カテゴリーだけ見える", async () => {
    await listCategories(CREAW);
    const { sql, params } = lastQuery();
    expect(sql).toMatch(/`accountId` is null or `categories`\.`accountId` = \?/);
    expect(params).toContain(2);
  });
});
