import {
  boolean,
  int,
  mediumtext,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/mysql-core";
import { bigint } from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/** Threads API credentials and configuration */
export const settings = mysqlTable("settings", {
  id: int("id").autoincrement().primaryKey(),
  threadsAccessToken: text("threadsAccessToken"),
  threadsUserId: varchar("threadsUserId", { length: 64 }),
  morningCronTaskUid: varchar("morningCronTaskUid", { length: 65 }),
  eveningCronTaskUid: varchar("eveningCronTaskUid", { length: 65 }),
  /** 朝の投稿時刻（時・分） */
  morningHour: int("morningHour").default(8).notNull(),
  morningMinute: int("morningMinute").default(0).notNull(),
  /** 夕の投稿時刻（時・分） */
  eveningHour: int("eveningHour").default(18).notNull(),
  eveningMinute: int("eveningMinute").default(0).notNull(),
  /** タイムゾーン: "LA" = America/Los_Angeles, "JP" = Asia/Tokyo */
  timezone: mysqlEnum("timezone", ["LA", "JP", "ET", "CT", "MT"]).default("LA").notNull(),
  /** 1日の投稿回数（2〜6） */
  postsPerDay: int("postsPerDay").default(2).notNull(),
  /** 追加スロット時刻 JSON文字列 [{hour,minute},...] */
  extraSlots: text("extraSlots").default("[]").notNull(),
  /** 新規原稿を「下書き」で作成し、承認後にのみ自動投稿する */
  requireApproval: boolean("requireApproval").default(false).notNull(),
  /** 投稿失敗時にオーナーへ通知する */
  notifyOnError: boolean("notifyOnError").default(true).notNull(),
  /** ホワイトレーベル: 表示ブランド名（未設定時はデフォルト） */
  brandName: varchar("brandName", { length: 64 }),
  /** ホワイトレーベル: アクセントカラー (hex) */
  brandAccent: varchar("brandAccent", { length: 16 }),
  /** 日次メンテナンス（トークン更新・分析取得）を最後に実行したUTC日付 YYYY-MM-DD */
  lastMaintenanceDate: varchar("lastMaintenanceDate", { length: 10 }),
  /** 予約原稿が尽きたスロットを、再投稿コンテンツで自動的に埋める */
  autoFillEvergreen: boolean("autoFillEvergreen").default(false).notNull(),
  /** 再投稿時にAIで言い回し・絵文字を変える（APIキー未設定時は原文のまま） */
  recycleRewrite: boolean("recycleRewrite").default(true).notNull(),
  /** 同じ再投稿コンテンツを再利用するまでの最低日数 */
  recycleCooldownDays: int("recycleCooldownDays").default(30).notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Settings = typeof settings.$inferSelect;

/**
 * Threads accounts under management. Each account has its own token and
 * posting schedule, so one installation can operate multiple clients.
 */
export const accounts = mysqlTable("accounts", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 64 }).notNull(),
  threadsUserId: varchar("threadsUserId", { length: 64 }).notNull(),
  threadsAccessToken: text("threadsAccessToken").notNull(),
  /** 長期トークンを最後にリフレッシュした日時 */
  tokenRefreshedAt: timestamp("tokenRefreshedAt"),
  /** トークンの失効予定日時（refresh_access_token の expires_in から算出） */
  tokenExpiresAt: timestamp("tokenExpiresAt"),
  morningHour: int("morningHour").default(8).notNull(),
  morningMinute: int("morningMinute").default(0).notNull(),
  eveningHour: int("eveningHour").default(18).notNull(),
  eveningMinute: int("eveningMinute").default(0).notNull(),
  /** タイムゾーン: "LA" = America/Los_Angeles, "JP" = Asia/Tokyo。slots 未設定時の既定 */
  timezone: mysqlEnum("timezone", ["LA", "JP", "ET", "CT", "MT"]).default("LA").notNull(),
  /**
   * 投稿枠の定義 JSON: [{hour,minute,timezone},...]（最大6件）。
   * 枠ごとにタイムゾーンを持てるので「JSTの朝夕 + PTの朝夕」が1アカウントで組める。
   * null のときは上の morning/evening + timezone から2枠を組み立てる（従来動作）。
   */
  slots: text("slots"),
  active: boolean("active").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Account = typeof accounts.$inferSelect;
export type InsertAccount = typeof accounts.$inferInsert;

/**
 * アカウントごとの運用設定。
 *
 * 従来 `settings` に1行だけ持っていた運用ルール（承認フロー・通知・再投稿など）を
 * アカウント単位に分離したもの。`settings` は互換のため残してあり、
 * アカウントを跨ぐ設定（lastMaintenanceDate 等）だけがそちらに残る。
 */
export const accountSettings = mysqlTable("account_settings", {
  id: int("id").autoincrement().primaryKey(),
  /** accounts.id。1アカウント1行（UNIQUE） */
  accountId: int("accountId").notNull().unique(),
  /** 新規原稿を「下書き」で作成し、承認後にのみ自動投稿する */
  requireApproval: boolean("requireApproval").default(false).notNull(),
  /** 投稿失敗時にオーナーへ通知する */
  notifyOnError: boolean("notifyOnError").default(true).notNull(),
  /** 予約原稿が尽きたスロットを、再投稿コンテンツで自動的に埋める */
  autoFillEvergreen: boolean("autoFillEvergreen").default(false).notNull(),
  /** 再投稿時にAIで言い回し・絵文字を変える */
  recycleRewrite: boolean("recycleRewrite").default(true).notNull(),
  /** 同じ再投稿コンテンツを再利用するまでの最低日数 */
  recycleCooldownDays: int("recycleCooldownDays").default(30).notNull(),
  /** 1日の投稿回数（自動割り当ての既定値） */
  postsPerDay: int("postsPerDay").default(2).notNull(),
  /** ホワイトレーベル: 表示ブランド名 */
  brandName: varchar("brandName", { length: 64 }),
  /** ホワイトレーベル: アクセントカラー (hex) */
  brandAccent: varchar("brandAccent", { length: 16 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type AccountSettings = typeof accountSettings.$inferSelect;
export type InsertAccountSettings = typeof accountSettings.$inferInsert;

/**
 * アップロードされた画像。Threads APIは「公開URL」しか受け付けないため、
 * 画像はDBに保持し /api/media/:token で配信する（tokenはランダム）。
 */
export const media = mysqlTable("media", {
  id: int("id").autoincrement().primaryKey(),
  token: varchar("token", { length: 40 }).notNull().unique(),
  mimeType: varchar("mimeType", { length: 40 }).notNull(),
  byteSize: int("byteSize").notNull(),
  /** base64エンコードした画像本体（MEDIUMTEXT = 最大16MB） */
  data: mediumtext("data").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Media = typeof media.$inferSelect;

/** Post drafts managed by the admin */
/** Post categories */
export const categories = mysqlTable("categories", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 64 }).notNull(),
  color: varchar("color", { length: 16 }).default("#335B82").notNull(),
  /** 所属アカウント。null = アカウント分離導入前からある共通カテゴリー */
  accountId: int("accountId"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Category = typeof categories.$inferSelect;

/** Post drafts managed by the admin */
export const posts = mysqlTable("posts", {
  id: int("id").autoincrement().primaryKey(),
  content: text("content").notNull(),
  status: mysqlEnum("status", ["pending", "posted", "error"]).default("pending").notNull(),
  /** 承認フロー: draft = 未承認（自動投稿されない）, approved = 承認済み */
  approvalStatus: mysqlEnum("approvalStatus", ["draft", "approved"]).default("approved").notNull(),
  /** 投稿先アカウント。null = デフォルト（最初のアクティブアカウント） */
  accountId: int("accountId"),
  /** slot index: 0=morning,1=evening,2+=extra */
  slotIndex: int("slotIndex").default(0).notNull(),
  /** scheduled date (YYYY-MM-DD) assigned by auto-scheduler */
  scheduledDate: varchar("scheduledDate", { length: 10 }),
  /** category id */
  categoryId: int("categoryId"),
  sortOrder: int("sortOrder").default(0).notNull(),
  /** 添付画像のURL（内部アップロードなら /api/media/xxx、外部URLも可） */
  imageUrl: varchar("imageUrl", { length: 512 }),
  /** 再投稿コンテンツ: 投稿後も残しておき、空きスロットで言い回しを変えて再利用する */
  evergreen: boolean("evergreen").default(false).notNull(),
  /** 再投稿として最後に配信した日時（クールダウン判定に使う） */
  lastRecycledAt: timestamp("lastRecycledAt"),
  /** 再投稿として配信した回数 */
  recycleCount: int("recycleCount").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Post = typeof posts.$inferSelect;
export type InsertPost = typeof posts.$inferInsert;

/** Log of every auto-post attempt */
export const postLogs = mysqlTable("post_logs", {
  id: int("id").autoincrement().primaryKey(),
  postId: int("postId"),
  accountId: int("accountId"),
  content: text("content").notNull(),
  status: mysqlEnum("status", ["posted", "error"]).notNull(),
  threadsPostId: varchar("threadsPostId", { length: 128 }),
  errorMessage: text("errorMessage"),
  slotIndex: int("slotIndex").default(0).notNull(),
  categoryId: int("categoryId"),
  imageUrl: varchar("imageUrl", { length: 512 }),
  /** 再投稿コンテンツから自動生成された投稿かどうか */
  recycled: boolean("recycled").default(false).notNull(),
  postedAt: timestamp("postedAt").defaultNow().notNull(),
});

export type PostLog = typeof postLogs.$inferSelect;

/** Threads post analytics (fetched from Threads Insights API) */
export const postAnalytics = mysqlTable("post_analytics", {
  id: int("id").autoincrement().primaryKey(),
  postLogId: int("postLogId").notNull(),
  threadsPostId: varchar("threadsPostId", { length: 128 }).notNull(),
  likes: int("likes").default(0).notNull(),
  replies: int("replies").default(0).notNull(),
  reposts: int("reposts").default(0).notNull(),
  views: bigint("views", { mode: "number" }).default(0).notNull(),
  fetchedAt: timestamp("fetchedAt").defaultNow().notNull(),
});

export type PostAnalytics = typeof postAnalytics.$inferSelect;
