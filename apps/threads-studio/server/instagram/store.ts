/**
 * Instagram 公開の依頼台帳（TiDB / MySQL）。
 *
 * テーブル定義は schema.ts。
 *
 * mediaUrls には素材の署名URL（期限つき）が入る。コンテナを作り終えた時点、
 * または失敗で終わった時点で null にする。ログ・応答には出さない。
 */
import { and, eq } from "drizzle-orm";
import { getDb } from "../db";
import type {
  PublicationRow,
  PublicationState,
  PublicationStore,
} from "./publisher";
import { instagramPublications } from "./schema";

type Row = typeof instagramPublications.$inferSelect;

function parseList(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((v): v is string => typeof v === "string")
      : [];
  } catch {
    return [];
  }
}

function fromDb(row: Row): PublicationRow {
  return {
    scheduledPostId: row.scheduledPostId,
    externalClientId: row.externalClientId,
    igUserId: row.igUserId,
    state: row.state as PublicationState,
    caption: row.caption,
    mediaUrls: row.mediaUrls === null ? null : parseList(row.mediaUrls),
    childContainerIds: parseList(row.childContainerIds),
    creationId: row.creationId,
    mediaId: row.mediaId,
    permalink: row.permalink,
    error: row.error,
    attempts: row.attempts,
    publishAttempted: row.publishAttempted,
    requestDigest: row.requestDigest,
    updatedAt: row.updatedAt,
  };
}

function toDb(patch: Partial<PublicationRow>): Partial<Row> {
  const out: Partial<Row> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (key === "mediaUrls")
      out.mediaUrls = value === null ? null : JSON.stringify(value);
    else if (key === "childContainerIds")
      out.childContainerIds = JSON.stringify(value ?? []);
    else (out as Record<string, unknown>)[key] = value;
  }
  return out;
}

function affectedRows(result: unknown): number {
  const header = Array.isArray(result) ? result[0] : result;
  const value = (header as { affectedRows?: unknown } | undefined)
    ?.affectedRows;
  return typeof value === "number" ? value : 0;
}

export function createDbPublicationStore(): PublicationStore {
  return {
    async get(scheduledPostId) {
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");
      const rows = await db
        .select()
        .from(instagramPublications)
        .where(eq(instagramPublications.scheduledPostId, scheduledPostId))
        .limit(1);
      return rows[0] ? fromDb(rows[0]) : null;
    },
    async insert(row) {
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");
      try {
        await db
          .insert(instagramPublications)
          .values(toDb(row) as typeof instagramPublications.$inferInsert);
        return true;
      } catch {
        // 一意制約（同じ予約の再送・同時実行）
        return false;
      }
    },
    async update(scheduledPostId, expected, patch) {
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");
      const result = await db
        .update(instagramPublications)
        .set(toDb(patch))
        .where(
          and(
            eq(instagramPublications.scheduledPostId, scheduledPostId),
            eq(instagramPublications.state, expected)
          )
        );
      return affectedRows(result) > 0;
    },
  };
}
