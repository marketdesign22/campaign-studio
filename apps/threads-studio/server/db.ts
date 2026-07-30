import { and, desc, eq, gte, isNotNull, isNull, lt, lte, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  InsertAccount, InsertPost, InsertUser,
  accounts, categories, postAnalytics, postLogs, posts, settings, users,
} from "../drizzle/schema";
import { ENV } from "./_core/env";

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try { _db = drizzle(process.env.DATABASE_URL); }
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
  else if (user.openId === ENV.ownerOpenId) { values.role = "admin"; updateSet.role = "admin"; }
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

export async function listCategories() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(categories).orderBy(categories.id);
}

export async function createCategory(name: string, color: string) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.insert(categories).values({ name, color });
}

export async function deleteCategory(id: number) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.delete(categories).where(eq(categories.id, id));
}

// ── Posts ─────────────────────────────────────────────────────────────────────

export async function listPosts() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(posts).orderBy(posts.scheduledDate, posts.slotIndex, posts.sortOrder, posts.createdAt);
}

export async function getPostById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.select().from(posts).where(eq(posts.id, id)).limit(1);
  return rows[0];
}

export async function createPost(data: InsertPost) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.insert(posts).values(data);
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

/**
 * Eligibility conditions for auto/manual posting:
 * - pending & approved
 * - scheduledDate が未設定、または今日（アカウントのローカル日付）以前。
 *   予約日がまだ来ていない原稿は絶対に投稿しない。
 * - 対象アカウント宛て（accountId 一致 or 未指定原稿）
 */
function eligibleWhere(todayLocal: string, accountId?: number) {
  const conds = [
    eq(posts.status, "pending"),
    eq(posts.approvalStatus, "approved"),
    or(isNull(posts.scheduledDate), lte(posts.scheduledDate, todayLocal)),
  ];
  if (accountId !== undefined) {
    conds.push(or(isNull(posts.accountId), eq(posts.accountId, accountId)));
  }
  return and(...conds);
}

/** Get next eligible post for a given slotIndex (date-aware) */
export async function getNextPendingPost(slotIndex: number, todayLocal: string, accountId?: number) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db
    .select()
    .from(posts)
    .where(and(eq(posts.slotIndex, slotIndex), eligibleWhere(todayLocal, accountId)))
    .orderBy(posts.scheduledDate, posts.sortOrder, posts.createdAt)
    .limit(1);
  return rows[0];
}

/** Get next eligible post of any slot (date-aware) */
export async function getNextPendingPostAny(todayLocal: string, accountId?: number) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db
    .select()
    .from(posts)
    .where(eligibleWhere(todayLocal, accountId))
    .orderBy(posts.scheduledDate, posts.slotIndex, posts.sortOrder, posts.createdAt)
    .limit(1);
  return rows[0];
}

/**
 * このアカウント・スロットについて、ローカル日付の当日分ログ（成功/失敗問わず）が
 * 既にあるか。tick が15分ごとに走っても同じ枠を二重投稿しないためのロック。
 */
export async function hasSlotLogInRange(
  accountId: number,
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
      or(isNull(postLogs.accountId), eq(postLogs.accountId, accountId)),
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

export async function listPostLogs(limit = 100) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(postLogs).orderBy(desc(postLogs.postedAt)).limit(limit);
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
}) {
  const db = await getDb();
  if (!db) return;
  await db.insert(postLogs).values({ ...data, slotIndex: data.slotIndex ?? 0 });
}

// ── Analytics ─────────────────────────────────────────────────────────────────

export async function getAnalyticsSummary(period: "day" | "week" | "month") {
  const db = await getDb();
  if (!db) return { totalPosts: 0, totalLikes: 0, totalReplies: 0, totalReposts: 0, totalViews: 0, byCategory: [] };

  const now = new Date();
  const from = new Date(now);
  if (period === "day") from.setDate(from.getDate() - 1);
  else if (period === "week") from.setDate(from.getDate() - 7);
  else from.setMonth(from.getMonth() - 1);

  const logs = await db
    .select()
    .from(postLogs)
    .where(and(eq(postLogs.status, "posted"), gte(postLogs.postedAt, from)));

  const analytics = await db
    .select()
    .from(postAnalytics)
    .where(gte(postAnalytics.fetchedAt, from));

  const totalPosts = logs.length;
  const totalLikes = analytics.reduce((s, a) => s + a.likes, 0);
  const totalReplies = analytics.reduce((s, a) => s + a.replies, 0);
  const totalReposts = analytics.reduce((s, a) => s + a.reposts, 0);
  const totalViews = analytics.reduce((s, a) => s + a.views, 0);

  return { totalPosts, totalLikes, totalReplies, totalReposts, totalViews, byCategory: [] };
}

export async function getTopPosts(limit = 10) {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select({
      id: postLogs.id,
      content: postLogs.content,
      postedAt: postLogs.postedAt,
      likes: postAnalytics.likes,
      replies: postAnalytics.replies,
      reposts: postAnalytics.reposts,
      views: postAnalytics.views,
      categoryId: postLogs.categoryId,
    })
    .from(postLogs)
    .leftJoin(postAnalytics, eq(postAnalytics.postLogId, postLogs.id))
    .where(eq(postLogs.status, "posted"))
    .orderBy(desc(postAnalytics.likes))
    .limit(limit);
  return rows;
}

export async function getTopPostsByPeriod(period: "day" | "week" | "month", limit = 5) {
  const db = await getDb();
  if (!db) return [];
  const now = new Date();
  let since: Date;
  if (period === "day") { since = new Date(now); since.setHours(0, 0, 0, 0); }
  else if (period === "week") { since = new Date(now); since.setDate(now.getDate() - 7); }
  else { since = new Date(now); since.setMonth(now.getMonth() - 1); }
  const rows = await db
    .select({
      id: postLogs.id,
      content: postLogs.content,
      postedAt: postLogs.postedAt,
      likes: postAnalytics.likes,
      replies: postAnalytics.replies,
      reposts: postAnalytics.reposts,
      views: postAnalytics.views,
      categoryId: postLogs.categoryId,
    })
    .from(postLogs)
    .leftJoin(postAnalytics, eq(postAnalytics.postLogId, postLogs.id))
    .where(and(eq(postLogs.status, "posted"), gte(postLogs.postedAt, since)))
    .orderBy(desc(postAnalytics.likes))
    .limit(limit);
  return rows;
}

/** 月次レポート用の集計。日別の投稿数とエンゲージメント、トップ投稿、エラーを返す */
export async function getMonthlyReport(year: number, month: number) {
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
    .where(and(gte(postLogs.postedAt, from), lt(postLogs.postedAt, to)));

  const logIds = logs.map((l) => l.id);
  const analytics = logIds.length
    ? await db.select().from(postAnalytics)
    : [];
  const byLogId = new Map(analytics.map((a) => [a.postLogId, a]));

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
