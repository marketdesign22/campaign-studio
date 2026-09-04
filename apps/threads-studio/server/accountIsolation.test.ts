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

describe("トレンドリサーチ", () => {
  it("収集投稿の一覧は accountId で絞り、旧データ（NULL）を含めない", async () => {
    const { listTrendPosts } = await import("./db");
    await listTrendPosts(2, { since: new Date("2026-09-01T00:00:00Z") });
    scopedTo(2);
    expect(includesLegacy()).toBe(false);
  });

  it("投稿の取得・状態変更・AI結果の書き込みは id と accountId の両方で絞る", async () => {
    const { getOwnedTrendPost, setTrendPostStatus, setTrendPostAi } = await import("./db");
    await getOwnedTrendPost(9, 2);
    expect(lastQuery().sql).toMatch(/`id` = \?/);
    scopedTo(2);
    await setTrendPostStatus(9, 2, "saved");
    expect(lastQuery().sql).toMatch(/^update `trend_posts`/);
    scopedTo(2);
    await setTrendPostAi(9, 2, "reason", ["idea"]);
    scopedTo(2);
  });

  it("設定と分析結果もアカウント単位", async () => {
    const { getTrendSettings, getLatestTrendAnalysis, getOwnedTrendAnalysis, countTrendAnalysesToday } = await import("./db");
    await getTrendSettings(2);
    scopedTo(2);
    await getLatestTrendAnalysis(2, "7d");
    scopedTo(2);
    await getOwnedTrendAnalysis(5, 2);
    scopedTo(2);
    expect(lastQuery().sql).toMatch(/`id` = \?/);
    await countTrendAnalysesToday(2, new Date());
    scopedTo(2);
  });

  it("保存期間の整理は自アカウントの行だけを消し、「保存済み」は残す", async () => {
    const { pruneTrendPosts } = await import("./db");
    await pruneTrendPosts(2, 30);
    const { sql, params } = lastQuery();
    expect(sql).toMatch(/^delete from `trend_posts`/);
    scopedTo(2);
    expect(params).not.toContain("saved");
    expect(params).toContain("active");
  });

  it("同じ投稿の再取得は行を増やさず、利用者の状態を上書きしない", async () => {
    const { upsertTrendPost } = await import("./db");
    await upsertTrendPost({
      accountId: 2, platform: "threads", source: "keyword", keyword: "kw", externalId: "ext",
      permalink: null, username: null, postedAt: null, mediaType: null, summary: "s", hasReplies: null,
      likes: null, replies: null, reposts: null, views: null, saves: null, score: 10, scoreBreakdown: "[]", isRising: false,
    });
    const { sql } = lastQuery();
    expect(sql).toMatch(/^insert into `trend_posts`/);
    expect(sql).toMatch(/on duplicate key update/);
    expect(sql.split("on duplicate key update")[1]).not.toMatch(/`status`/);
    expect(sql.split("on duplicate key update")[1]).not.toMatch(/`aiReason`/);
  });

  it("学習サイクルの成果集計は post_logs のスコープで絞る", async () => {
    const { listPostOutcomes } = await import("./db");
    await listPostOutcomes(CREAW, new Date("2026-08-28T00:00:00Z"));
    scopedTo(2);
    expect(includesLegacy()).toBe(false);
  });
});

describe("受信箱（Threadsの返信管理）", () => {
  it("返信一覧は accountId で絞る", async () => {
    const { listThreadReplies } = await import("./db");
    await listThreadReplies(2, {});
    scopedTo(2);
  });

  it("自分自身の返信の除外もアカウントの絞り込みを崩さない", async () => {
    const { listThreadReplies } = await import("./db");
    await listThreadReplies(2, { excludeUsername: "creaw.usa" });
    scopedTo(2);
    expect(lastQuery().params).toContain("creaw.usa");
  });

  it("個別の返信の取得・状態変更は id と accountId の両方で絞る", async () => {
    const { getOwnedThreadReply, setThreadReplyStatus, markThreadReplyReplied } = await import("./db");
    await getOwnedThreadReply(9, 2);
    expect(lastQuery().sql).toMatch(/`id` = \?/);
    scopedTo(2);
    await setThreadReplyStatus(9, 2, "read");
    expect(lastQuery().sql).toMatch(/^update `thread_replies`/);
    scopedTo(2);
    await markThreadReplyReplied(9, 2, "ありがとうございます");
    expect(lastQuery().sql).toMatch(/^update `thread_replies`/);
    scopedTo(2);
  });

  it("未読件数は accountId で絞る", async () => {
    const { countUnreadThreadReplies } = await import("./db");
    await countUnreadThreadReplies(2);
    scopedTo(2);
  });

  it("同じ返信の再取得は行を増やさず、利用者の既読/返信済み状態を上書きしない", async () => {
    const { upsertThreadReply } = await import("./db");
    await upsertThreadReply({
      accountId: 2, externalId: "ext", rootMediaId: "root", rootPermalink: null,
      username: "fan", text: "いいですね", permalink: null, postedAt: null, hideStatus: null,
    });
    const { sql } = lastQuery();
    expect(sql).toMatch(/^insert into `thread_replies`/);
    expect(sql).toMatch(/on duplicate key update/);
    const updateClause = sql.split("on duplicate key update")[1];
    expect(updateClause).not.toMatch(/`status`/);
    expect(updateClause).not.toMatch(/`repliedContent`/);
    expect(updateClause).not.toMatch(/`repliedAt`/);
  });
});

describe("自動返信テンプレート", () => {
  it("一覧・個別取得・更新・削除はすべて accountId で絞る", async () => {
    const { listReplyTemplates, getOwnedReplyTemplate, updateReplyTemplate, deleteReplyTemplate } = await import("./db");
    await listReplyTemplates(2);
    scopedTo(2);
    await getOwnedReplyTemplate(9, 2);
    expect(lastQuery().sql).toMatch(/`id` = \?/);
    scopedTo(2);
    await updateReplyTemplate(9, 2, { enabled: false });
    expect(lastQuery().sql).toMatch(/^update `reply_templates`/);
    scopedTo(2);
    await deleteReplyTemplate(9, 2);
    expect(lastQuery().sql).toMatch(/^delete from `reply_templates`/);
    scopedTo(2);
  });

  it("作成は指定したアカウントの行として保存される", async () => {
    const { createReplyTemplate } = await import("./db");
    await createReplyTemplate(2, ["ビザ"], "案内文");
    const { sql, params } = lastQuery();
    expect(sql).toMatch(/^insert into `reply_templates`/);
    expect(params).toContain(2);
    expect(params).toContain("案内文");
  });
});
