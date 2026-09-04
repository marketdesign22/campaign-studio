import { and, desc, eq, gte, inArray, isNotNull, isNull, lt, lte, ne, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { createPool } from "mysql2";
import { buildDbConfig } from "./dbConfig";
import type { AnyMySqlColumn } from "drizzle-orm/mysql-core";
import {
  InsertAccount, InsertAccountSettings, InsertPost, InsertUser,
  accountSettings, accounts, categories, followerSnapshots, media, postAnalytics, postLogs, posts,
  settings, threadReplies, trendAnalyses, trendPosts, trendSettings, users,
} from "../drizzle/schema";
import type { AccountScope } from "./accountScope";
import { ENV } from "./_core/env";

/**
 * 「このスコープが所有する行だけ」に絞る条件。
 *
 * accountId が NULL の行はマルチアカウント化以前の旧データで、最初に作られた
 * アカウントのものである。そのアカウント（includeLegacy=true）から読むときだけ
 * 含め、2番目以降のアカウントからは絶対に見えない。
 * この関数を通さずに posts / post_logs を引かないこと。
 */
function ownedBy(col: AnyMySqlColumn, scope: AccountScope) {
  return scope.includeLegacy ? or(isNull(col), eq(col, scope.accountId)) : eq(col, scope.accountId);
}

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      // TLS設定はURLのクエリ文字列ではなくコード側で決める（server/dbConfig.ts）
      _db = drizzle(createPool(buildDbConfig(process.env.DATABASE_URL)));
    }
    catch (error) { console.warn("[Database] Failed to connect:", error); _db = null; }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) return;
  const values: InsertUser = { openId: user.openId };
  const updateSet: Record<string, unknown> = {};
  const textFields = ["name", "email", "loginMethod"] as const;
  for (const field of textFields) {
    const value = user[field];
    if (value === undefined) continue;
    const normalized = value ?? null;
    values[field] = normalized;
    updateSet[field] = normalized;
  }
  if (user.lastSignedIn !== undefined) { values.lastSignedIn = user.lastSignedIn; updateSet.lastSignedIn = user.lastSignedIn; }
  if (user.role !== undefined) { values.role = user.role; updateSet.role = user.role; }
  if (!values.lastSignedIn) values.lastSignedIn = new Date();
  if (Object.keys(updateSet).length === 0) updateSet.lastSignedIn = new Date();
  await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result[0];
}

export async function countUsers(): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const result = await db.select({ count: sql<number>`count(*)` }).from(users);
  return Number(result[0]?.count ?? 0);
}

// ── Settings ──────────────────────────────────────────────────────────────────

export async function getSettings() {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(settings).limit(1);
  return rows[0] ?? null;
}

export async function upsertSettings(data: {
  threadsAccessToken?: string | null;
  threadsUserId?: string | null;
  morningCronTaskUid?: string | null;
  eveningCronTaskUid?: string | null;
  morningHour?: number;
  morningMinute?: number;
  eveningHour?: number;
  eveningMinute?: number;
  timezone?: "LA" | "JP" | "ET" | "CT" | "MT";
  postsPerDay?: number;
  extraSlots?: string;
  requireApproval?: boolean;
  notifyOnError?: boolean;
  brandName?: string | null;
  brandAccent?: string | null;
  lastMaintenanceDate?: string | null;
  autoFillEvergreen?: boolean;
  recycleRewrite?: boolean;
  recycleCooldownDays?: number;
}) {
  const db = await getDb();
  if (!db) return;
  const existing = await getSettings();
  if (existing) {
    await db.update(settings).set(data).where(eq(settings.id, existing.id));
  } else {
    await db.insert(settings).values({ ...data, extraSlots: data.extraSlots ?? "[]" });
  }
}

// ── Accounts ──────────────────────────────────────────────────────────────────

export async function listAccounts() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(accounts).orderBy(accounts.id);
}

export async function listActiveAccounts() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(accounts).where(eq(accounts.active, true)).orderBy(accounts.id);
}

export async function getAccountById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.select().from(accounts).where(eq(accounts.id, id)).limit(1);
  return rows[0];
}

export async function getAccountByThreadsUserId(threadsUserId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db
    .select()
    .from(accounts)
    .where(eq(accounts.threadsUserId, threadsUserId))
    .limit(1);
  return rows[0];
}

export async function createAccount(data: InsertAccount) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.insert(accounts).values(data);
}

export async function updateAccount(id: number, data: Partial<InsertAccount>) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.update(accounts).set(data).where(eq(accounts.id, id));
}

export async function deleteAccount(id: number) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.delete(accounts).where(eq(accounts.id, id));
}

// ── Categories ────────────────────────────────────────────────────────────────

export async function listCategories(scope: AccountScope) {
  const db = await getDb();
  if (!db) return [];
  // accountId が NULL のカテゴリーは分離導入前からある共通カテゴリーなので全アカウントで見える
  return db
    .select()
    .from(categories)
    .where(or(isNull(categories.accountId), eq(categories.accountId, scope.accountId)))
    .orderBy(categories.id);
}

export async function createCategory(name: string, color: string, accountId: number) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.insert(categories).values({ name, color, accountId });
}

/** 自アカウントのカテゴリーだけ削除できる（共通カテゴリーは消させない） */
export async function deleteCategory(id: number, scope: AccountScope) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db
    .delete(categories)
    .where(and(eq(categories.id, id), eq(categories.accountId, scope.accountId)));
}

// ── Media ─────────────────────────────────────────────────────────────────────

export async function createMedia(data: {
  token: string;
  mimeType: string;
  byteSize: number;
  data: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.insert(media).values(data);
}

export async function getMediaByToken(token: string) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.select().from(media).where(eq(media.token, token)).limit(1);
  return rows[0];
}

// ── Posts ─────────────────────────────────────────────────────────────────────

export async function listPosts(scope: AccountScope) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(posts)
    .where(ownedBy(posts.accountId, scope))
    .orderBy(posts.scheduledDate, posts.slotIndex, posts.sortOrder, posts.createdAt);
}

/** アカウントを問わず1件取得する。スケジューラなどサーバー内部専用 */
export async function getPostById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.select().from(posts).where(eq(posts.id, id)).limit(1);
  return rows[0];
}

/**
 * スコープが所有する原稿を1件取得する。
 * 他アカウントの原稿IDを指定された場合は undefined を返すので、
 * 更新・削除系は必ずこれを通してから書き込むこと。
 */
export async function getOwnedPost(id: number, scope: AccountScope) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db
    .select()
    .from(posts)
    .where(and(eq(posts.id, id), ownedBy(posts.accountId, scope)))
    .limit(1);
  return rows[0];
}

/** スコープが所有するIDだけに絞り込む（一括操作の前段） */
export async function filterOwnedPostIds(ids: number[], scope: AccountScope): Promise<number[]> {
  if (ids.length === 0) return [];
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select({ id: posts.id })
    .from(posts)
    .where(and(inArray(posts.id, ids), ownedBy(posts.accountId, scope)));
  return rows.map((r) => r.id);
}

export async function createPost(data: InsertPost): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const [result] = await db.insert(posts).values(data);
  return result.insertId;
}

export async function bulkCreatePosts(items: InsertPost[]) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  if (items.length === 0) return;
  await db.insert(posts).values(items);
}

export async function updatePost(id: number, data: Partial<InsertPost>) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.update(posts).set(data).where(eq(posts.id, id));
}

export async function deletePost(id: number) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.delete(posts).where(eq(posts.id, id));
}

export async function deletePostsByIds(ids: number[], scope: AccountScope) {
  if (ids.length === 0) return;
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.delete(posts).where(and(inArray(posts.id, ids), ownedBy(posts.accountId, scope)));
}

/**
 * Eligibility conditions for auto/manual posting:
 * - pending & approved
 * - scheduledDate が未設定、または今日（アカウントのローカル日付）以前。
 *   予約日がまだ来ていない原稿は絶対に投稿しない。
 * - 対象アカウント宛て（accountId 一致 or 未指定原稿）
 */
function eligibleWhere(todayLocal: string, scope: AccountScope) {
  return and(
    eq(posts.status, "pending"),
    eq(posts.approvalStatus, "approved"),
    or(isNull(posts.scheduledDate), lte(posts.scheduledDate, todayLocal)),
    ownedBy(posts.accountId, scope),
  );
}

/** Get next eligible post for a given slotIndex (date-aware) */
export async function getNextPendingPost(slotIndex: number, todayLocal: string, scope: AccountScope) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db
    .select()
    .from(posts)
    .where(and(eq(posts.slotIndex, slotIndex), eligibleWhere(todayLocal, scope)))
    .orderBy(posts.scheduledDate, posts.sortOrder, posts.createdAt)
    .limit(1);
  return rows[0];
}

/** Get next eligible post of any slot (date-aware) */
export async function getNextPendingPostAny(todayLocal: string, scope: AccountScope) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db
    .select()
    .from(posts)
    .where(eligibleWhere(todayLocal, scope))
    .orderBy(posts.scheduledDate, posts.slotIndex, posts.sortOrder, posts.createdAt)
    .limit(1);
  return rows[0];
}

/**
 * 再投稿コンテンツの中から、次に使うものを1件選ぶ。
 * 「最後に使ったのが古い順（未使用が最優先）」で、クールダウン期間内のものは除外する。
 */
export async function getEvergreenCandidate(
  scope: AccountScope,
  cooldownDays: number,
  now: Date = new Date()
) {
  const db = await getDb();
  if (!db) return undefined;
  const cooldownBefore = new Date(now.getTime() - cooldownDays * 24 * 60 * 60 * 1000);
  const conds = [
    eq(posts.evergreen, true),
    eq(posts.approvalStatus, "approved"),
    or(isNull(posts.lastRecycledAt), lt(posts.lastRecycledAt, cooldownBefore)),
    ownedBy(posts.accountId, scope),
  ];
  const rows = await db
    .select()
    .from(posts)
    .where(and(...conds))
    // MySQLはASCでNULLが先に来るため、未使用の原稿が自然に最優先になる
    .orderBy(posts.lastRecycledAt, posts.recycleCount, posts.updatedAt)
    .limit(1);
  return rows[0];
}

/** 再投稿として配信したことを記録する */
export async function markPostRecycled(id: number, at: Date) {
  const db = await getDb();
  if (!db) return;
  await db
    .update(posts)
    .set({ lastRecycledAt: at, recycleCount: sql`${posts.recycleCount} + 1` })
    .where(eq(posts.id, id));
}

/** 履歴などから再投稿コンテンツを登録する（既存原稿があればフラグを立てるだけ） */
export async function saveAsEvergreen(
  content: string,
  postId: number | null | undefined,
  scope: AccountScope
): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  if (postId) {
    const existing = await getOwnedPost(postId, scope);
    if (existing) {
      await db.update(posts).set({ evergreen: true }).where(eq(posts.id, postId));
      return postId;
    }
  }
  // 元の原稿が消えている場合は、投稿済み扱いの原稿として復元する
  // （status="posted" なので通常の予約投稿には拾われず、再投稿プールにだけ入る）
  return createPost({
    content,
    status: "posted",
    approvalStatus: "approved",
    evergreen: true,
    accountId: scope.accountId,
    slotIndex: 0,
    sortOrder: 0,
  });
}

/**
 * このアカウント・スロットについて、ローカル日付の当日分ログ（成功/失敗問わず）が
 * 既にあるか。tick が15分ごとに走っても同じ枠を二重投稿しないためのロック。
 */
export async function hasSlotLogInRange(
  scope: AccountScope,
  slotIndex: number,
  startUtc: Date,
  endUtc: Date
) {
  const db = await getDb();
  if (!db) return false;
  const rows = await db
    .select({ id: postLogs.id })
    .from(postLogs)
    .where(and(
      ownedBy(postLogs.accountId, scope),
      eq(postLogs.slotIndex, slotIndex),
      gte(postLogs.postedAt, startUtc),
      lt(postLogs.postedAt, endUtc),
    ))
    .limit(1);
  return rows.length > 0;
}

/** 分析取得の対象: 直近N日の成功ログ（threadsPostId あり） */
export async function listLogsForAnalytics(days: number) {
  const db = await getDb();
  if (!db) return [];
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return db
    .select()
    .from(postLogs)
    .where(and(
      eq(postLogs.status, "posted"),
      isNotNull(postLogs.threadsPostId),
      gte(postLogs.postedAt, cutoff),
    ))
    .orderBy(desc(postLogs.postedAt));
}

// ── Post Logs ─────────────────────────────────────────────────────────────────

export async function listPostLogs(limit: number, scope: AccountScope) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(postLogs)
    .where(ownedBy(postLogs.accountId, scope))
    .orderBy(desc(postLogs.postedAt))
    .limit(limit);
}

export async function createPostLog(data: {
  postId?: number | null;
  accountId?: number | null;
  content: string;
  status: "posted" | "error";
  threadsPostId?: string | null;
  errorMessage?: string | null;
  slotIndex?: number;
  categoryId?: number | null;
  recycled?: boolean;
  imageUrl?: string | null;
}) {
  const db = await getDb();
  if (!db) return;
  await db.insert(postLogs).values({ ...data, slotIndex: data.slotIndex ?? 0 });
}

// ── Analytics ─────────────────────────────────────────────────────────────────

/**
 * 指定ログIDぶんの分析値を、ログID→最新1件 に畳んで返す。
 *
 * post_analytics には postLogId のユニーク制約が無く、日次取得のたびに
 * 行が増える運用実績があるため、単純に合計すると同じ投稿を二重計上してしまう。
 * ここで最新の fetchedAt だけを採用して重複を潰す。
 */
async function analyticsByLogId(logIds: number[]) {
  const map = new Map<number, typeof postAnalytics.$inferSelect>();
  if (logIds.length === 0) return map;
  const db = await getDb();
  if (!db) return map;
  const rows = await db
    .select()
    .from(postAnalytics)
    .where(inArray(postAnalytics.postLogId, logIds));
  for (const row of rows) {
    const current = map.get(row.postLogId);
    if (!current || row.fetchedAt > current.fetchedAt) map.set(row.postLogId, row);
  }
  return map;
}

export async function getAnalyticsSummary(period: "day" | "week" | "month", scope: AccountScope) {
  const empty = {
    totalPosts: 0, totalLikes: 0, totalReplies: 0, totalReposts: 0, totalViews: 0,
    engagementRate: 0, byCategory: [] as never[],
  };
  const db = await getDb();
  if (!db) return empty;

  const from = periodStart(period);

  const logs = await db
    .select()
    .from(postLogs)
    .where(and(
      eq(postLogs.status, "posted"),
      gte(postLogs.postedAt, from),
      ownedBy(postLogs.accountId, scope),
    ));

  // 分析値は「このアカウントの、この期間の投稿ログ」に紐づくものだけを合計する
  const byLog = await analyticsByLogId(logs.map((l) => l.id));
  let totalLikes = 0, totalReplies = 0, totalReposts = 0, totalViews = 0;
  for (const a of Array.from(byLog.values())) {
    totalLikes += a.likes;
    totalReplies += a.replies;
    totalReposts += a.reposts;
    totalViews += a.views;
  }

  return {
    totalPosts: logs.length,
    totalLikes, totalReplies, totalReposts, totalViews,
    engagementRate: engagementRate({ totalLikes, totalReplies, totalReposts, totalViews }),
    byCategory: [],
  };
}

/**
 * エンゲージメント率(%) = (いいね + 返信 + リポスト) / インプレッション × 100。
 * インプレッションが0のときは0を返す（0除算で NaN/Infinity を出さない）。
 */
export function engagementRate(v: {
  totalLikes: number; totalReplies: number; totalReposts: number; totalViews: number;
}): number {
  if (!v.totalViews) return 0;
  return ((v.totalLikes + v.totalReplies + v.totalReposts) / v.totalViews) * 100;
}

export type RankBy = "views" | "engagement" | "rate";

/** エンゲージメント上位の投稿。since を渡すとその日時以降に限定する */
async function topPostsSince(
  scope: AccountScope, limit: number, since?: Date, rankBy: RankBy = "engagement"
) {
  const db = await getDb();
  if (!db) return [];
  const conds = [eq(postLogs.status, "posted"), ownedBy(postLogs.accountId, scope)];
  if (since) conds.push(gte(postLogs.postedAt, since));
  const logs = await db.select().from(postLogs).where(and(...conds));
  const byLog = await analyticsByLogId(logs.map((l) => l.id));
  const rows = logs.map((l) => {
    const a = byLog.get(l.id);
    const likes = a?.likes ?? 0, replies = a?.replies ?? 0, reposts = a?.reposts ?? 0;
    const views = a?.views ?? 0;
    return {
      id: l.id,
      content: l.content,
      postedAt: l.postedAt,
      likes, replies, reposts, views,
      engagement: likes + replies + reposts,
      engagementRate: engagementRate({
        totalLikes: likes, totalReplies: replies, totalReposts: reposts, totalViews: views,
      }),
      categoryId: l.categoryId,
    };
  });
  const key =
    rankBy === "views" ? (r: (typeof rows)[number]) => r.views
    : rankBy === "rate" ? (r: (typeof rows)[number]) => r.engagementRate
    : (r: (typeof rows)[number]) => r.engagement;
  return rows.sort((x, y) => key(y) - key(x)).slice(0, limit);
}

export async function getTopPosts(limit: number, scope: AccountScope, rankBy: RankBy = "engagement") {
  return topPostsSince(scope, limit, undefined, rankBy);
}

/** 期間の開始日時。画面に「いつからいつまで」を出せるよう外にも公開する */
export function periodStart(period: "day" | "week" | "month", now = new Date()): Date {
  const since = new Date(now);
  if (period === "day") since.setHours(0, 0, 0, 0);
  else if (period === "week") since.setDate(now.getDate() - 7);
  else since.setDate(now.getDate() - 30);
  return since;
}

export async function getTopPostsByPeriod(
  period: "day" | "week" | "month",
  limit: number,
  scope: AccountScope,
  rankBy: RankBy = "engagement"
) {
  return topPostsSince(scope, limit, periodStart(period), rankBy);
}

/** 月次レポート用の集計。日別の投稿数とエンゲージメント、トップ投稿、エラーを返す */
export async function getMonthlyReport(year: number, month: number, scope: AccountScope) {
  const db = await getDb();
  const empty = {
    totals: { posts: 0, errors: 0, likes: 0, replies: 0, reposts: 0, views: 0 },
    byDay: [] as { date: string; posts: number; errors: number }[],
    topPosts: [] as {
      id: number; content: string; postedAt: Date | null;
      likes: number | null; replies: number | null; reposts: number | null; views: number | null;
    }[],
  };
  if (!db) return empty;

  const from = new Date(Date.UTC(year, month - 1, 1));
  const to = new Date(Date.UTC(month === 12 ? year + 1 : year, month === 12 ? 0 : month, 1));

  const logs = await db
    .select()
    .from(postLogs)
    .where(and(
      gte(postLogs.postedAt, from),
      lt(postLogs.postedAt, to),
      ownedBy(postLogs.accountId, scope),
    ));

  const byLogId = await analyticsByLogId(logs.map((l) => l.id));

  const byDayMap = new Map<string, { posts: number; errors: number }>();
  let likes = 0, replies = 0, reposts = 0, views = 0, errors = 0, posted = 0;
  for (const log of logs) {
    const d = log.postedAt.toISOString().slice(0, 10);
    const entry = byDayMap.get(d) ?? { posts: 0, errors: 0 };
    if (log.status === "posted") { entry.posts++; posted++; } else { entry.errors++; errors++; }
    byDayMap.set(d, entry);
    const a = byLogId.get(log.id);
    if (a) { likes += a.likes; replies += a.replies; reposts += a.reposts; views += a.views; }
  }

  const topPosts = logs
    .filter((l) => l.status === "posted")
    .map((l) => {
      const a = byLogId.get(l.id);
      return {
        id: l.id, content: l.content, postedAt: l.postedAt,
        likes: a?.likes ?? 0, replies: a?.replies ?? 0, reposts: a?.reposts ?? 0, views: a?.views ?? 0,
      };
    })
    .sort((x, y) => (y.likes ?? 0) - (x.likes ?? 0))
    .slice(0, 10);

  return {
    totals: { posts: posted, errors, likes, replies, reposts, views },
    byDay: Array.from(byDayMap.entries())
      .map(([date, v]) => ({ date, ...v }))
      .sort((a, b) => a.date.localeCompare(b.date)),
    topPosts,
  };
}

export async function upsertAnalytics(data: {
  postLogId: number;
  threadsPostId: string;
  likes: number;
  replies: number;
  reposts: number;
  views: number;
}) {
  const db = await getDb();
  if (!db) return;
  await db.insert(postAnalytics).values(data).onDuplicateKeyUpdate({ set: data });
}

// ── Account settings ──────────────────────────────────────────────────────────

/** アカウント運用設定の既定値。行がまだ無いアカウントでもUIが壊れないようにする */
export const DEFAULT_ACCOUNT_SETTINGS = {
  requireApproval: false,
  notifyOnError: true,
  autoFillEvergreen: false,
  recycleRewrite: true,
  recycleCooldownDays: 30,
  postsPerDay: 2,
  brandName: null as string | null,
  brandAccent: null as string | null,
};

export type AccountSettingsValues = typeof DEFAULT_ACCOUNT_SETTINGS;

export async function getAccountSettings(accountId: number): Promise<AccountSettingsValues> {
  const db = await getDb();
  if (!db) return { ...DEFAULT_ACCOUNT_SETTINGS };
  const rows = await db
    .select()
    .from(accountSettings)
    .where(eq(accountSettings.accountId, accountId))
    .limit(1);
  const row = rows[0];
  if (!row) return { ...DEFAULT_ACCOUNT_SETTINGS };
  return {
    requireApproval: row.requireApproval,
    notifyOnError: row.notifyOnError,
    autoFillEvergreen: row.autoFillEvergreen,
    recycleRewrite: row.recycleRewrite,
    recycleCooldownDays: row.recycleCooldownDays,
    postsPerDay: row.postsPerDay,
    brandName: row.brandName,
    brandAccent: row.brandAccent,
  };
}

export async function upsertAccountSettings(
  accountId: number,
  data: Partial<Omit<InsertAccountSettings, "id" | "accountId">>
) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const rows = await db
    .select({ id: accountSettings.id })
    .from(accountSettings)
    .where(eq(accountSettings.accountId, accountId))
    .limit(1);
  if (rows[0]) {
    await db.update(accountSettings).set(data).where(eq(accountSettings.accountId, accountId));
  } else {
    await db.insert(accountSettings).values({ ...data, accountId });
  }
}

/** アカウント削除時に設定行も片付ける（原稿・履歴は保全のため残す） */
export async function deleteAccountSettings(accountId: number) {
  const db = await getDb();
  if (!db) return;
  await db.delete(accountSettings).where(eq(accountSettings.accountId, accountId));
}

// ── Follower snapshots ────────────────────────────────────────────────────────

/**
 * その日のフォロワー数を記録する。
 * 同じ日に複数回呼ばれたら、その日の値を最新で上書きする（行は増やさない）。
 * 負数は呼び出し側で弾いている前提だが、ここでも保険をかける。
 */
export async function recordFollowerSnapshot(
  accountId: number, capturedDate: string, followerCount: number
) {
  if (followerCount < 0) return;
  const db = await getDb();
  if (!db) return;
  await db
    .insert(followerSnapshots)
    .values({ accountId, capturedDate, followerCount })
    .onDuplicateKeyUpdate({ set: { followerCount, fetchedAt: new Date() } });
}

/** 指定アカウントのスナップショットを日付昇順で返す（他アカウントは混ざらない） */
export async function listFollowerSnapshots(accountId: number, fromDate?: string) {
  const db = await getDb();
  if (!db) return [];
  const conds = [eq(followerSnapshots.accountId, accountId)];
  if (fromDate) conds.push(gte(followerSnapshots.capturedDate, fromDate));
  return db
    .select()
    .from(followerSnapshots)
    .where(and(...conds))
    .orderBy(followerSnapshots.capturedDate);
}

/** 期間開始日より前で最も近いスナップショット（増減の基準点） */
export async function getSnapshotBefore(accountId: number, date: string) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db
    .select()
    .from(followerSnapshots)
    .where(and(
      eq(followerSnapshots.accountId, accountId),
      lt(followerSnapshots.capturedDate, date),
    ))
    .orderBy(desc(followerSnapshots.capturedDate))
    .limit(1);
  return rows[0];
}

// ── Trend research ────────────────────────────────────────────────────────────

export const DEFAULT_TREND_SETTINGS = {
  keywords: [] as string[],
  excludeKeywords: [] as string[],
  refAccounts: [] as string[],
  language: "ja",
  region: "JP",
  industry: null as string | null,
  fetchTimes: [{ hour: 9, minute: 0 }, { hour: 18, minute: 0 }],
  autoFetch: true,
  retentionDays: 30,
  aiDailyLimit: 20,
  lastFetchKey: null as string | null,
  lastFetchAt: null as Date | null,
  lastFetchError: null as string | null,
};

export type TrendSettingsValues = typeof DEFAULT_TREND_SETTINGS;

function parseStringList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x.trim()).slice(0, 50) : [];
  } catch {
    return [];
  }
}

function parseFetchTimes(raw: string | null | undefined): { hour: number; minute: number }[] {
  if (!raw) return DEFAULT_TREND_SETTINGS.fetchTimes;
  try {
    const v = JSON.parse(raw);
    if (!Array.isArray(v)) return DEFAULT_TREND_SETTINGS.fetchTimes;
    const out = v
      .filter((t) => t && Number.isInteger(t.hour) && Number.isInteger(t.minute))
      .map((t) => ({ hour: Math.min(23, Math.max(0, t.hour)), minute: Math.min(59, Math.max(0, t.minute)) }))
      .slice(0, 4);
    return out.length ? out : DEFAULT_TREND_SETTINGS.fetchTimes;
  } catch {
    return DEFAULT_TREND_SETTINGS.fetchTimes;
  }
}

export async function getTrendSettings(accountId: number): Promise<TrendSettingsValues> {
  const db = await getDb();
  if (!db) return { ...DEFAULT_TREND_SETTINGS };
  const rows = await db.select().from(trendSettings).where(eq(trendSettings.accountId, accountId)).limit(1);
  const r = rows[0];
  if (!r) return { ...DEFAULT_TREND_SETTINGS };
  return {
    keywords: parseStringList(r.keywords),
    excludeKeywords: parseStringList(r.excludeKeywords),
    refAccounts: parseStringList(r.refAccounts),
    language: r.language,
    region: r.region,
    industry: r.industry,
    fetchTimes: parseFetchTimes(r.fetchTimes),
    autoFetch: r.autoFetch,
    retentionDays: r.retentionDays,
    aiDailyLimit: r.aiDailyLimit,
    lastFetchKey: r.lastFetchKey,
    lastFetchAt: r.lastFetchAt,
    lastFetchError: r.lastFetchError ?? null,
  };
}

export async function upsertTrendSettings(
  accountId: number,
  data: Partial<{
    keywords: string[]; excludeKeywords: string[]; refAccounts: string[];
    language: string; region: string; industry: string | null;
    fetchTimes: { hour: number; minute: number }[]; autoFetch: boolean;
    retentionDays: number; aiDailyLimit: number;
    lastFetchKey: string | null; lastFetchAt: Date | null; lastFetchError: string | null;
  }>
) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const set: Record<string, unknown> = {};
  if (data.keywords) set.keywords = JSON.stringify(data.keywords);
  if (data.excludeKeywords) set.excludeKeywords = JSON.stringify(data.excludeKeywords);
  if (data.refAccounts) set.refAccounts = JSON.stringify(data.refAccounts);
  if (data.language !== undefined) set.language = data.language;
  if (data.region !== undefined) set.region = data.region;
  if (data.industry !== undefined) set.industry = data.industry;
  if (data.fetchTimes) set.fetchTimes = JSON.stringify(data.fetchTimes);
  if (data.autoFetch !== undefined) set.autoFetch = data.autoFetch;
  if (data.retentionDays !== undefined) set.retentionDays = data.retentionDays;
  if (data.aiDailyLimit !== undefined) set.aiDailyLimit = data.aiDailyLimit;
  if (data.lastFetchKey !== undefined) set.lastFetchKey = data.lastFetchKey;
  if (data.lastFetchAt !== undefined) set.lastFetchAt = data.lastFetchAt;
  if (data.lastFetchError !== undefined) set.lastFetchError = data.lastFetchError;

  const rows = await db.select({ id: trendSettings.id }).from(trendSettings)
    .where(eq(trendSettings.accountId, accountId)).limit(1);
  if (rows[0]) {
    if (Object.keys(set).length) await db.update(trendSettings).set(set).where(eq(trendSettings.accountId, accountId));
  } else {
    await db.insert(trendSettings).values({ ...set, accountId });
  }
}

export type UpsertTrendPost = {
  accountId: number;
  platform: "threads" | "instagram";
  source: "keyword" | "manual";
  keyword: string | null;
  externalId: string;
  permalink: string | null;
  username: string | null;
  postedAt: Date | null;
  mediaType: string | null;
  summary: string;
  hasReplies: boolean | null;
  likes: number | null; replies: number | null; reposts: number | null;
  views: number | null; saves: number | null;
  score: number;
  scoreBreakdown: string;
  isRising: boolean;
};

/**
 * 収集投稿の保存。同じ (accountId, platform, externalId) は行を増やさず更新する。
 * 利用者が付けた status（保存/除外）と AI の分析結果は上書きしない。
 */
export async function upsertTrendPost(row: UpsertTrendPost) {
  const db = await getDb();
  if (!db) return;
  await db.insert(trendPosts).values(row).onDuplicateKeyUpdate({
    set: {
      keyword: row.keyword, permalink: row.permalink, username: row.username,
      postedAt: row.postedAt, mediaType: row.mediaType, summary: row.summary,
      hasReplies: row.hasReplies,
      likes: row.likes, replies: row.replies, reposts: row.reposts, views: row.views, saves: row.saves,
      score: row.score, scoreBreakdown: row.scoreBreakdown, isRising: row.isRising,
      fetchedAt: new Date(),
    },
  });
}

/** 指定アカウントの収集投稿。期間は fetchedAt ではなく postedAt を基準にする */
export async function listTrendPosts(
  accountId: number,
  opts: { since: Date; status?: ("active" | "saved" | "excluded" | "deleted")[]; platform?: "threads" | "instagram"; limit?: number }
) {
  const db = await getDb();
  if (!db) return [];
  const conds = [
    eq(trendPosts.accountId, accountId),
    or(gte(trendPosts.postedAt, opts.since), and(isNull(trendPosts.postedAt), gte(trendPosts.fetchedAt, opts.since))),
  ];
  if (opts.status?.length) conds.push(inArray(trendPosts.status, opts.status));
  if (opts.platform) conds.push(eq(trendPosts.platform, opts.platform));
  return db.select().from(trendPosts).where(and(...conds))
    .orderBy(desc(trendPosts.score), desc(trendPosts.postedAt))
    .limit(opts.limit ?? 100);
}

export async function getOwnedTrendPost(id: number, accountId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.select().from(trendPosts)
    .where(and(eq(trendPosts.id, id), eq(trendPosts.accountId, accountId))).limit(1);
  return rows[0];
}

export async function setTrendPostStatus(
  id: number, accountId: number, status: "active" | "saved" | "excluded" | "deleted"
) {
  const db = await getDb();
  if (!db) return;
  await db.update(trendPosts).set({ status })
    .where(and(eq(trendPosts.id, id), eq(trendPosts.accountId, accountId)));
}

export async function setTrendPostAi(id: number, accountId: number, aiReason: string, aiIdeas: string[]) {
  const db = await getDb();
  if (!db) return;
  await db.update(trendPosts).set({ aiReason, aiIdeas: JSON.stringify(aiIdeas) })
    .where(and(eq(trendPosts.id, id), eq(trendPosts.accountId, accountId)));
}

/** 同じキーワードで期間内に収集した件数（出現増加の算出に使う） */
export async function countTrendPostsForKeyword(
  accountId: number, keyword: string, from: Date, to: Date
): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const rows = await db.select({ c: sql<number>`count(*)` }).from(trendPosts)
    .where(and(
      eq(trendPosts.accountId, accountId), eq(trendPosts.keyword, keyword),
      gte(trendPosts.postedAt, from), lt(trendPosts.postedAt, to),
    ));
  return Number(rows[0]?.c ?? 0);
}

/**
 * 保存期間を過ぎた収集投稿を消す。
 * 利用者が「保存」した投稿と、原稿の参照元になった分析は残す。
 */
export async function pruneTrendPosts(accountId: number, retentionDays: number) {
  const db = await getDb();
  if (!db) return;
  const cutoff = new Date(Date.now() - retentionDays * 86_400_000);
  await db.delete(trendPosts).where(and(
    eq(trendPosts.accountId, accountId),
    lt(trendPosts.fetchedAt, cutoff),
    inArray(trendPosts.status, ["active", "excluded", "deleted"]),
  ));
}

export async function createTrendAnalysis(accountId: number, period: string, result: unknown, postCount: number) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const [r] = await db.insert(trendAnalyses).values({
    accountId, period, result: JSON.stringify(result), postCount,
  });
  return r.insertId;
}

export async function getLatestTrendAnalysis(accountId: number, period: string) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.select().from(trendAnalyses)
    .where(and(eq(trendAnalyses.accountId, accountId), eq(trendAnalyses.period, period)))
    .orderBy(desc(trendAnalyses.createdAt)).limit(1);
  return rows[0];
}

export async function getOwnedTrendAnalysis(id: number, accountId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.select().from(trendAnalyses)
    .where(and(eq(trendAnalyses.id, id), eq(trendAnalyses.accountId, accountId))).limit(1);
  return rows[0];
}

/** 今日のAI分析回数（1日の上限判定用） */
export async function countTrendAnalysesToday(accountId: number, since: Date): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const rows = await db.select({ c: sql<number>`count(*)` }).from(trendAnalyses)
    .where(and(eq(trendAnalyses.accountId, accountId), gte(trendAnalyses.createdAt, since)));
  return Number(rows[0]?.c ?? 0);
}

/**
 * 学習サイクル用: 期間内に投稿した原稿ごとの成果。
 * トレンドを参照した原稿（trendAnalysisId あり）と未参照の原稿を、同じ条件で並べて返す。
 * アカウントの絞り込みは post_logs 側のスコープで行う。
 */
export async function listPostOutcomes(scope: AccountScope, since: Date) {
  const db = await getDb();
  if (!db) return [];
  const logs = await db.select().from(postLogs).where(and(
    eq(postLogs.status, "posted"),
    gte(postLogs.postedAt, since),
    ownedBy(postLogs.accountId, scope),
  ));
  if (logs.length === 0) return [];
  const byLog = await analyticsByLogId(logs.map((l) => l.id));
  const postIds = logs.map((l) => l.postId).filter((id): id is number => id !== null);
  const postRows = postIds.length
    ? await db.select({ id: posts.id, trendAnalysisId: posts.trendAnalysisId, trendMeta: posts.trendMeta })
        .from(posts).where(inArray(posts.id, postIds))
    : [];
  const postById = new Map(postRows.map((p) => [p.id, p]));
  return logs.map((l) => {
    const a = byLog.get(l.id);
    const p = l.postId !== null ? postById.get(l.postId) : undefined;
    const likes = a?.likes ?? null, replies = a?.replies ?? null, reposts = a?.reposts ?? null, views = a?.views ?? null;
    return {
      logId: l.id, postId: l.postId, content: l.content, postedAt: l.postedAt,
      usedTrend: !!p?.trendAnalysisId,
      trendMeta: p?.trendMeta ?? null,
      likes, replies, reposts, views,
      /** 分析値が1件も無い投稿は「未取得」として率を出さない */
      hasAnalytics: !!a,
    };
  });
}

// ── 受信箱（Threadsの返信管理） ───────────────────────────────────────────────

export type UpsertThreadReply = {
  accountId: number;
  externalId: string;
  rootMediaId: string | null;
  rootPermalink: string | null;
  username: string | null;
  text: string | null;
  permalink: string | null;
  postedAt: Date | null;
  hideStatus: string | null;
};

/**
 * 返信の保存。同じ (accountId, externalId) は行を増やさず更新する。
 * 利用者が付けた status（既読/返信済み）と返信内容は上書きしない。
 */
export async function upsertThreadReply(row: UpsertThreadReply) {
  const db = await getDb();
  if (!db) return;
  await db.insert(threadReplies).values(row).onDuplicateKeyUpdate({
    set: {
      rootMediaId: row.rootMediaId, rootPermalink: row.rootPermalink, username: row.username,
      text: row.text, permalink: row.permalink, postedAt: row.postedAt, hideStatus: row.hideStatus,
      fetchedAt: new Date(),
    },
  });
}

/** 指定アカウントの返信一覧。新しい順 */
export async function listThreadReplies(
  accountId: number,
  opts: {
    status?: ("unread" | "read" | "replied")[]; limit?: number;
    /** 自分自身の返信（スレッドの続き）を除く。既に保存済みの行にも効く（削除はしない） */
    excludeUsername?: string | null;
  } = {}
) {
  const db = await getDb();
  if (!db) return [];
  const conds = [eq(threadReplies.accountId, accountId)];
  if (opts.status?.length) conds.push(inArray(threadReplies.status, opts.status));
  if (opts.excludeUsername) {
    // or() は型上 undefined を返しうるが、ここは常に2件渡すので実際には起きない
    conds.push(or(isNull(threadReplies.username), ne(threadReplies.username, opts.excludeUsername))!);
  }
  return db.select().from(threadReplies).where(and(...conds))
    .orderBy(desc(threadReplies.postedAt)).limit(opts.limit ?? 100);
}

export async function getOwnedThreadReply(id: number, accountId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.select().from(threadReplies)
    .where(and(eq(threadReplies.id, id), eq(threadReplies.accountId, accountId))).limit(1);
  return rows[0];
}

export async function setThreadReplyStatus(id: number, accountId: number, status: "unread" | "read" | "replied") {
  const db = await getDb();
  if (!db) return;
  await db.update(threadReplies).set({ status })
    .where(and(eq(threadReplies.id, id), eq(threadReplies.accountId, accountId)));
}

/** 返信送信の成功後に呼ぶ。送った内容と日時を残し、状態を「返信済み」にする */
export async function markThreadReplyReplied(id: number, accountId: number, content: string, now: Date = new Date()) {
  const db = await getDb();
  if (!db) return;
  await db.update(threadReplies).set({ status: "replied", repliedContent: content, repliedAt: now })
    .where(and(eq(threadReplies.id, id), eq(threadReplies.accountId, accountId)));
}

/** 未読件数（サイドバーのバッジ表示用） */
export async function countUnreadThreadReplies(accountId: number, excludeUsername?: string | null): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const conds = [eq(threadReplies.accountId, accountId), eq(threadReplies.status, "unread")];
  if (excludeUsername) {
    conds.push(or(isNull(threadReplies.username), ne(threadReplies.username, excludeUsername))!);
  }
  const rows = await db.select({ c: sql<number>`count(*)` }).from(threadReplies).where(and(...conds));
  return Number(rows[0]?.c ?? 0);
}
