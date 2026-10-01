import { and, desc, eq, gte, inArray, isNull, lt, or } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { randomUUID } from "node:crypto";
import {
  accounts,
  campaigns,
  categories,
  contentStrategyItems,
  followerSnapshots,
  monthlyReports,
  postAnalytics,
  postLogs,
  posts,
  reportConfigs,
  reportPostDaily,
  type Account,
} from "../drizzle/schema";
import { getDb, listConversionEvents } from "./db";
import type { AccountScope } from "./accountScope";
import { primaryTimezone } from "@shared/postingSlots";
import {
  emptyReportConfig,
  narrativeSchema,
  reportConfigSchema,
  type ReportConfig,
  type ReportData,
  type ReportNarrative,
  type ReportPost,
  type SavedReport,
} from "@shared/monthlyReport";
import {
  buildReportData,
  localReportParts,
  reportMonthRange,
  reportRate,
  REPORT_TIMEZONES,
  shiftMonth,
  shiftDay,
} from "./reportBuilder";

async function dbRequired() {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "レポートの保存先に接続できません。",
    });
  return db;
}
export async function getReportConfig(accountId: number, month: string) {
  const db = await dbRequired();
  const [row] = await db
    .select()
    .from(reportConfigs)
    .where(
      and(
        eq(reportConfigs.accountId, accountId),
        eq(reportConfigs.month, month)
      )
    );
  return row
    ? reportConfigSchema.parse(JSON.parse(row.configJson))
    : emptyReportConfig();
}
export async function reportConfigWithDefaults(
  accountId: number,
  month: string
) {
  const db = await dbRequired();
  const [row] = await db
    .select()
    .from(reportConfigs)
    .where(
      and(
        eq(reportConfigs.accountId, accountId),
        eq(reportConfigs.month, month)
      )
    );
  if (row) return reportConfigSchema.parse(JSON.parse(row.configJson));
  const [prior] = await db
    .select()
    .from(reportConfigs)
    .where(
      and(
        eq(reportConfigs.accountId, accountId),
        lt(reportConfigs.month, month)
      )
    )
    .orderBy(desc(reportConfigs.month))
    .limit(1);
  if (!prior) return emptyReportConfig();
  const old = reportConfigSchema.parse(JSON.parse(prior.configJson));
  // Client identity and purpose persist; targets and measurement certification require monthly confirmation.
  return {
    ...emptyReportConfig(),
    clientName: old.clientName,
    authorName: old.authorName,
    objective: old.objective,
    autoGenerate: old.autoGenerate,
  };
}
export async function saveReportConfig(
  accountId: number,
  month: string,
  config: ReportConfig
) {
  const db = await dbRequired();
  const configJson = JSON.stringify(config);
  await db
    .insert(reportConfigs)
    .values({ accountId, month, configJson })
    .onDuplicateKeyUpdate({ set: { configJson } });
}
export async function recordReportPostDaily(
  accountId: number,
  postLogId: number,
  date: string,
  metrics: { likes: number; replies: number; reposts: number; views: number },
  now = new Date()
) {
  const db = await dbRequired();
  const value = {
    accountId,
    postLogId,
    capturedDate: date,
    ...metrics,
    fetchedAt: now,
  };
  await db
    .insert(reportPostDaily)
    .values(value)
    .onDuplicateKeyUpdate({ set: value });
}
export async function collectReportData(
  account: Account,
  scope: AccountScope,
  month: string,
  now = new Date()
): Promise<ReportData> {
  const db = await dbRequired();
  const timezone = REPORT_TIMEZONES[primaryTimezone(account)];
  const current = reportMonthRange(month, timezone),
    previous = reportMonthRange(shiftMonth(month, -1), timezone);
  if (current.from > now)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "未来月の実績レポートは作成できません。",
    });
  const owned = scope.includeLegacy
    ? or(eq(postLogs.accountId, account.id), isNull(postLogs.accountId))
    : eq(postLogs.accountId, account.id);
  const logs = await db
    .select()
    .from(postLogs)
    .where(
      and(
        owned,
        eq(postLogs.status, "posted"),
        gte(postLogs.postedAt, previous.from),
        lt(postLogs.postedAt, current.to),
        lt(postLogs.postedAt, now)
      )
    );
  const ids = logs.map(p => p.id);
  const postIds = logs.flatMap(p => (p.postId === null ? [] : [p.postId]));
  const [
    analytics,
    postRows,
    categoryRows,
    campaignRows,
    purposeRows,
    followers,
    events,
    previousEvents,
    config,
    previousConfig,
    daily,
  ] = await Promise.all([
    ids.length
      ? db
          .select()
          .from(postAnalytics)
          .where(inArray(postAnalytics.postLogId, ids))
      : Promise.resolve([]),
    postIds.length
      ? db
          .select()
          .from(posts)
          .where(
            and(
              inArray(posts.id, postIds),
              scope.includeLegacy
                ? or(eq(posts.accountId, account.id), isNull(posts.accountId))
                : eq(posts.accountId, account.id)
            )
          )
      : Promise.resolve([]),
    db
      .select()
      .from(categories)
      .where(
        scope.includeLegacy
          ? or(
              eq(categories.accountId, account.id),
              isNull(categories.accountId)
            )
          : eq(categories.accountId, account.id)
      ),
    db.select().from(campaigns).where(eq(campaigns.accountId, account.id)),
    db
      .select()
      .from(contentStrategyItems)
      .where(eq(contentStrategyItems.accountId, account.id)),
    db
      .select()
      .from(followerSnapshots)
      .where(
        and(
          eq(followerSnapshots.accountId, account.id),
          gte(
            followerSnapshots.capturedDate,
            shiftDay(`${shiftMonth(month, -1)}-01`, -1)
          ),
          lt(followerSnapshots.capturedDate, `${shiftMonth(month, 1)}-01`)
        )
      ),
    listConversionEvents(
      account.id,
      current.from,
      new Date(Math.min(current.to.getTime(), now.getTime()))
    ),
    listConversionEvents(account.id, previous.from, previous.to),
    reportConfigWithDefaults(account.id, month),
    getReportConfig(account.id, shiftMonth(month, -1)),
    db
      .select()
      .from(reportPostDaily)
      .where(
        and(
          eq(reportPostDaily.accountId, account.id),
          gte(reportPostDaily.capturedDate, `${month}-01`),
          lt(reportPostDaily.capturedDate, `${shiftMonth(month, 1)}-01`)
        )
      ),
  ]);
  const latest = new Map<number, typeof postAnalytics.$inferSelect>();
  for (const a of analytics) {
    const old = latest.get(a.postLogId);
    if (
      a.fetchedAt <= now &&
      (!old ||
        a.fetchedAt > old.fetchedAt ||
        (+a.fetchedAt === +old.fetchedAt && a.id > old.id))
    )
      latest.set(a.postLogId, a);
  }
  const reportPosts: ReportPost[] = logs.map(log => {
    const a = latest.get(log.id),
      p = postRows.find(p => p.id === log.postId),
      s = purposeRows.find(s => s.id === p?.strategyItemId);
    return {
      id: log.id,
      postId: log.postId,
      content: log.content,
      postedAt: log.postedAt.toISOString(),
      ...localReportParts(log.postedAt, timezone),
      category:
        categoryRows.find(c => c.id === log.categoryId)?.name ?? "未分類",
      campaign:
        campaignRows.find(c => c.id === p?.campaignId)?.name ?? "未分類",
      purpose: s?.purpose ?? "未分類",
      imageUrl: log.imageUrl,
      views: a?.views ?? null,
      likes: a?.likes ?? null,
      replies: a?.replies ?? null,
      reposts: a?.reposts ?? null,
      fetchedAt: a?.fetchedAt.toISOString() ?? null,
      rate: a ? reportRate(a.likes + a.replies + a.reposts, a.views) : null,
    };
  });
  const currentIds = new Set(
    reportPosts.filter(p => p.date.startsWith(month)).map(p => p.id)
  );
  const observations = Array.from(new Set(daily.map(d => d.capturedDate)))
    .sort()
    .map(date => {
      const rows = daily.filter(
        d => d.capturedDate === date && currentIds.has(d.postLogId)
      );
      const views = rows.reduce((n, d) => n + d.views, 0);
      const reactions = rows.reduce(
        (n, d) => n + d.likes + d.replies + d.reposts,
        0
      );
      return {
        date,
        measured: rows.length,
        views: rows.length ? views : null,
        rate: rows.length ? reportRate(reactions, views) : null,
      };
    });
  return buildReportData({
    accountId: account.id,
    accountName: account.name,
    month,
    timezone,
    posts: reportPosts,
    followers: followers.map(f => ({
      date: f.capturedDate,
      count: f.followerCount,
    })),
    events,
    previousEvents,
    config,
    previousConfig,
    observations,
    now,
  });
}
function deserialize(row: typeof monthlyReports.$inferSelect): SavedReport {
  return {
    id: row.id,
    status: row.status,
    revision: row.revision,
    generatedAt: row.generatedAt.toISOString(),
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    sentAt: row.sentAt?.toISOString() ?? null,
    narrativeSource: row.narrativeSource,
    data: JSON.parse(row.dataJson) as ReportData,
    narrative: narrativeSchema.parse(JSON.parse(row.narrativeJson)),
  };
}
export async function listReports(accountId: number, month: string) {
  const db = await dbRequired();
  return db
    .select({
      id: monthlyReports.id,
      status: monthlyReports.status,
      generatedAt: monthlyReports.generatedAt,
      revision: monthlyReports.revision,
    })
    .from(monthlyReports)
    .where(
      and(
        eq(monthlyReports.accountId, accountId),
        eq(monthlyReports.month, month)
      )
    )
    .orderBy(desc(monthlyReports.generatedAt));
}
export async function getReport(accountId: number, id: string) {
  const db = await dbRequired();
  const [row] = await db
    .select()
    .from(monthlyReports)
    .where(
      and(eq(monthlyReports.accountId, accountId), eq(monthlyReports.id, id))
    );
  if (!row)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "このアカウントのレポートが見つかりません。",
    });
  return deserialize(row);
}
export async function createReport(
  data: ReportData,
  narrative: ReportNarrative,
  createdBy: number | null,
  autoKey: string | null = null
) {
  const db = await dbRequired();
  const id = randomUUID();
  await db.insert(monthlyReports).values({
    id,
    accountId: data.accountId,
    month: data.month,
    dataJson: JSON.stringify(data),
    narrativeJson: JSON.stringify(narrative),
    createdBy,
    autoKey,
    generatedAt: new Date(),
  });
  return getReport(data.accountId, id);
}
export function reportTransitionAllowed(from: string, to: string) {
  return (
    (from === "draft" && to === "reviewed") ||
    (from === "reviewed" && to === "sent")
  );
}
export async function updateReport(
  accountId: number,
  id: string,
  revision: number,
  update: {
    narrative?: ReportNarrative;
    source?: "ai" | "edited";
    status?: "reviewed" | "sent";
  }
) {
  const db = await dbRequired();
  const existing = await getReport(accountId, id);
  if (
    (update.narrative && existing.status !== "draft") ||
    (update.status && !reportTransitionAllowed(existing.status, update.status))
  )
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "確定済みの内容は変更できません。新しい版を作成してください。",
    });
  const [result] = await db
    .update(monthlyReports)
    .set({
      revision: revision + 1,
      ...(update.narrative
        ? {
            narrativeJson: JSON.stringify(update.narrative),
            narrativeSource: update.source ?? "edited",
          }
        : {}),
      ...(update.status
        ? {
            status: update.status,
            ...(update.status === "reviewed"
              ? { reviewedAt: new Date() }
              : { sentAt: new Date() }),
          }
        : {}),
    })
    .where(
      and(
        eq(monthlyReports.accountId, accountId),
        eq(monthlyReports.id, id),
        eq(monthlyReports.revision, revision),
        eq(monthlyReports.status, existing.status)
      )
    );
  if (!result.affectedRows)
    throw new TRPCError({
      code: "CONFLICT",
      message: "別の操作で更新されました。読み込み直してください。",
    });
  return getReport(accountId, id);
}
export async function autoReportExists(accountId: number, month: string) {
  const db = await dbRequired();
  const [row] = await db
    .select({ id: monthlyReports.id })
    .from(monthlyReports)
    .where(eq(monthlyReports.autoKey, `${accountId}:${month}`));
  return !!row;
}
export async function listReportAccounts() {
  const db = await dbRequired();
  return db.select().from(accounts).where(eq(accounts.active, true));
}
