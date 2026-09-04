import {
  boolean,
  index,
  int,
  mediumtext,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  uniqueIndex,
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
  /** 受信箱: 直近の返信取得日時（成功・失敗いずれも記録） */
  lastReplyFetchAt: timestamp("lastReplyFetchAt"),
  /** 受信箱: 直近の返信取得で対処が必要だった失敗の種別。成功で null */
  lastReplyFetchError: varchar("lastReplyFetchError", { length: 32 }),
  /** 受信箱: このアカウント自身のThreads上のユーザー名（@なし）。自分自身の返信（スレッドの続き）を一覧から除くために使う */
  threadsUsername: varchar("threadsUsername", { length: 64 }),
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
  /** コンテンツ運用OS設定（JSONは共有Zodスキーマで検証） */
  weeklyPostCount: int("weeklyPostCount").default(7).notNull(),
  purposeRatios: text("purposeRatios"),
  defaultCta: varchar("defaultCta", { length: 300 }),
  forbiddenTopics: text("forbiddenTopics"),
  qualityStrictness: mysqlEnum("qualityStrictness", ["standard", "strict"]).default("standard").notNull(),
  strategyAiDailyLimit: int("strategyAiDailyLimit").default(10).notNull(),
  autoWeeklyStrategy: boolean("autoWeeklyStrategy").default(false).notNull(),
  weeklyReviewEnabled: boolean("weeklyReviewEnabled").default(true).notNull(),
  conversionTrackingEnabled: boolean("conversionTrackingEnabled").default(true).notNull(),
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
  /** 参照したトレンド分析。null = トレンドを使っていない原稿（学習サイクルの比較群） */
  trendAnalysisId: int("trendAnalysisId"),
  /** 参照した傾向のメモ JSON（テーマ・冒頭の型など。他人の本文は入れない） */
  trendMeta: text("trendMeta"),
  campaignId: int("campaignId"),
  strategyItemId: int("strategyItemId"),
  conversionGoalId: int("conversionGoalId"),
  trackingMeta: text("trackingMeta"),
  /** 原稿の作成経路。分析用で、既存行はmanual扱い */
  creationSource: mysqlEnum("creationSource", ["manual", "ai", "strategy", "import", "recycle"]).default("manual").notNull(),
  qualityCheckStatus: mysqlEnum("qualityCheckStatus", ["unchecked", "ok", "recommend", "review", "blocked"]).default("unchecked").notNull(),
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

/**
 * フォロワー数の日次スナップショット。
 *
 * Threads Insights の followers_count は「現在の総数」しか返さないため、
 * 増減は日次で撮ったスナップショットの差分から求める。
 * (accountId, capturedDate) で一意。同じ日に複数回取得したらその日の値を更新する。
 */
export const followerSnapshots = mysqlTable("follower_snapshots", {
  id: int("id").autoincrement().primaryKey(),
  accountId: int("accountId").notNull(),
  /** アカウントのタイムゾーンでの取得日 YYYY-MM-DD */
  capturedDate: varchar("capturedDate", { length: 10 }).notNull(),
  followerCount: int("followerCount").notNull(),
  fetchedAt: timestamp("fetchedAt").defaultNow().notNull(),
});

export type FollowerSnapshot = typeof followerSnapshots.$inferSelect;

// ── トレンドリサーチ ─────────────────────────────────────────────────────────

/** アカウントごとのトレンド収集設定 */
export const trendSettings = mysqlTable("trend_settings", {
  id: int("id").autoincrement().primaryKey(),
  accountId: int("accountId").notNull().unique(),
  /** 監視キーワード JSON string[] */
  keywords: text("keywords"),
  /** 除外キーワード JSON string[] */
  excludeKeywords: text("excludeKeywords"),
  /** 参考アカウント JSON string[]（@なしのユーザー名） */
  refAccounts: text("refAccounts"),
  language: varchar("language", { length: 8 }).default("ja").notNull(),
  /** JP / US / OTHER */
  region: varchar("region", { length: 8 }).default("JP").notNull(),
  industry: varchar("industry", { length: 64 }),
  /** 取得時刻 JSON [{hour,minute}]。既定は朝9時・夕18時（アカウントの基準タイムゾーン） */
  fetchTimes: text("fetchTimes"),
  autoFetch: boolean("autoFetch").default(true).notNull(),
  retentionDays: int("retentionDays").default(30).notNull(),
  /** 1日あたりのAI分析回数の上限 */
  aiDailyLimit: int("aiDailyLimit").default(20).notNull(),
  /** 直近に自動取得した枠 "YYYY-MM-DD/index"（同じ枠を二度取らないためのロック） */
  lastFetchKey: varchar("lastFetchKey", { length: 24 }),
  lastFetchAt: timestamp("lastFetchAt"),
  /** 直近の取得で対処が必要だった失敗の種別（auth / permission / rate_limited / network / unknown）。成功で null */
  lastFetchError: varchar("lastFetchError", { length: 32 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type TrendSettings = typeof trendSettings.$inferSelect;

/**
 * 収集した投稿。本文は要約（先頭140文字）だけ持ち、全文は保存しない。
 * 反応数は取得できたものだけ入り、取れなければ NULL のまま（0にしない）。
 */
export const trendPosts = mysqlTable("trend_posts", {
  id: int("id").autoincrement().primaryKey(),
  accountId: int("accountId").notNull(),
  platform: mysqlEnum("platform", ["threads", "instagram"]).notNull(),
  /** keyword = API検索, manual = 利用者がURLを登録 */
  source: mysqlEnum("source", ["keyword", "manual"]).default("keyword").notNull(),
  keyword: varchar("keyword", { length: 64 }),
  /** プラットフォーム側のID。重複排除のキー */
  externalId: varchar("externalId", { length: 128 }).notNull(),
  permalink: varchar("permalink", { length: 512 }),
  username: varchar("username", { length: 64 }),
  postedAt: timestamp("postedAt"),
  mediaType: varchar("mediaType", { length: 24 }),
  summary: varchar("summary", { length: 255 }).notNull(),
  hasReplies: boolean("hasReplies"),
  likes: int("likes"),
  replies: int("replies"),
  reposts: int("reposts"),
  views: int("views"),
  saves: int("saves"),
  score: int("score").default(0).notNull(),
  /** 内訳 JSON（ScoreComponent[]） */
  scoreBreakdown: text("scoreBreakdown"),
  isRising: boolean("isRising").default(false).notNull(),
  status: mysqlEnum("status", ["active", "saved", "excluded", "deleted"]).default("active").notNull(),
  /** AIによる「伸びた理由」 */
  aiReason: text("aiReason"),
  /** AIによる活用案 JSON string[] */
  aiIdeas: text("aiIdeas"),
  firstSeenAt: timestamp("firstSeenAt").defaultNow().notNull(),
  fetchedAt: timestamp("fetchedAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type TrendPost = typeof trendPosts.$inferSelect;

/** AIによる傾向分析の結果（期間ごと） */
export const trendAnalyses = mysqlTable("trend_analyses", {
  id: int("id").autoincrement().primaryKey(),
  accountId: int("accountId").notNull(),
  /** 24h / 7d / 30d */
  period: varchar("period", { length: 8 }).notNull(),
  /** 分析結果 JSON（TrendAnalysis） */
  result: text("result").notNull(),
  postCount: int("postCount").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type TrendAnalysis = typeof trendAnalyses.$inferSelect;

/**
 * Threadsの受信箱: 自社投稿についた公開返信。
 * DM（ダイレクトメッセージ）は公式APIが公開されていないため対象外。
 * (accountId, externalId) が重複排除のキー。利用者が付けた status・返信内容は
 * 再取得で上書きしない（db.ts の upsertThreadReply を参照）。
 */
export const threadReplies = mysqlTable("thread_replies", {
  id: int("id").autoincrement().primaryKey(),
  accountId: int("accountId").notNull(),
  /** Threads側の返信メディアID */
  externalId: varchar("externalId", { length: 128 }).notNull(),
  /** 返信対象（自社投稿）のThreadsメディアID。取れない場合は NULL */
  rootMediaId: varchar("rootMediaId", { length: 128 }),
  rootPermalink: varchar("rootPermalink", { length: 512 }),
  username: varchar("username", { length: 64 }),
  /** 返信本文。投稿と同じ500文字制限で保存する */
  text: varchar("text", { length: 600 }),
  permalink: varchar("permalink", { length: 512 }),
  postedAt: timestamp("postedAt"),
  /** Threads側の非表示状態（例: HIDDEN） */
  hideStatus: varchar("hideStatus", { length: 24 }),
  status: mysqlEnum("status", ["unread", "read", "replied"]).default("unread").notNull(),
  /** このアプリから送信した返信の本文（利用者が実際に送った内容） */
  repliedContent: text("repliedContent"),
  repliedAt: timestamp("repliedAt"),
  firstSeenAt: timestamp("firstSeenAt").defaultNow().notNull(),
  fetchedAt: timestamp("fetchedAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ThreadReply = typeof threadReplies.$inferSelect;

/**
 * 受信箱: キーワードに一致した返信へ提案する定型文。
 * ここに登録した内容は「案」として一覧に表示されるだけで、自動では送信しない。
 * 送信は利用者が「この内容で送信」を押した時だけ（server/routers/replies.ts の reply と同じ経路）。
 */
export const replyTemplates = mysqlTable("reply_templates", {
  id: int("id").autoincrement().primaryKey(),
  accountId: int("accountId").notNull(),
  /** 反応するキーワード JSON string[] */
  keywords: text("keywords").notNull(),
  /** 提案する返信の定型文 */
  replyText: varchar("replyText", { length: 500 }).notNull(),
  enabled: boolean("enabled").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ReplyTemplate = typeof replyTemplates.$inferSelect;

/**
 * エンゲージメント: 他アカウントの投稿（トレンド収集済み）へこちらから送ったコメントの記録。
 * 送信操作の監査・二重送信の目安表示にだけ使う。全文の複製は保存しない
 * （targetSummary は表示用の短い要約。trend_posts.summary と同じ考え方）。
 */
export const engagementComments = mysqlTable("engagement_comments", {
  id: int("id").autoincrement().primaryKey(),
  accountId: int("accountId").notNull(),
  /** コメント先のThreadsメディアID。トレンド投稿本体、またはその配下の返信のいずれか */
  targetExternalId: varchar("targetExternalId", { length: 128 }).notNull(),
  targetType: mysqlEnum("targetType", ["post", "reply"]).default("post").notNull(),
  /** 参照したトレンド投稿。行が削除されても記録は残すため外部キー制約は付けない */
  trendPostId: int("trendPostId"),
  targetUsername: varchar("targetUsername", { length: 64 }),
  targetPermalink: varchar("targetPermalink", { length: 512 }),
  targetSummary: varchar("targetSummary", { length: 255 }),
  /** 送信したコメント本文（最大500文字。Threadsの返信と同じ制限） */
  content: varchar("content", { length: 500 }).notNull(),
  /** Threads側で発行されたコメントのID */
  threadsCommentId: varchar("threadsCommentId", { length: 128 }),
  sentAt: timestamp("sentAt").defaultNow().notNull(),
});

export type EngagementComment = typeof engagementComments.$inferSelect;

// ── クライアント情報のAI読み取り ──────────────────────────────────────

/** AI候補。確認完了まで既存設定とは分離する。 */
export const clientProfileDrafts = mysqlTable("client_profile_drafts", {
  id: int("id").autoincrement().primaryKey(),
  accountId: int("accountId").notNull(),
  status: mysqlEnum("status", ["pending", "approved", "dismissed"]).default("pending").notNull(),
  inputs: text("inputs").notNull(),
  profile: mediumtext("profile").notNull(),
  keywords: text("keywords").notNull(),
  warnings: text("warnings").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  reviewedAt: timestamp("reviewedAt"),
});

export type ClientProfileDraft = typeof clientProfileDrafts.$inferSelect;

/** 利用者が確認した現行プロフィール。アカウントごと1件。 */
export const clientProfiles = mysqlTable("client_profiles", {
  id: int("id").autoincrement().primaryKey(),
  accountId: int("accountId").notNull().unique(),
  profile: mediumtext("profile").notNull(),
  sourceInputs: text("sourceInputs").notNull(),
  approvedAt: timestamp("approvedAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ClientProfileRow = typeof clientProfiles.$inferSelect;

/** 承認された検索候補と過去成果を独立して保持する。 */
export const clientTrendKeywords = mysqlTable("client_trend_keywords", {
  id: int("id").autoincrement().primaryKey(),
  accountId: int("accountId").notNull(),
  keyword: varchar("keyword", { length: 64 }).notNull(),
  category: varchar("category", { length: 32 }).notNull(),
  reason: varchar("reason", { length: 300 }).notNull(),
  targetCustomer: varchar("targetCustomer", { length: 160 }),
  region: varchar("region", { length: 80 }),
  priority: int("priority").default(3).notNull(),
  enabled: boolean("enabled").default(true).notNull(),
  sources: text("sources").notNull(),
  lastUsedAt: timestamp("lastUsedAt"),
  outcome: text("outcome"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

// ── 集客成果・週間戦略・品質チェック ──────────────────────────────
export const campaigns = mysqlTable("campaigns", {
  id: int("id").autoincrement().primaryKey(), accountId: int("accountId").notNull(),
  name: varchar("name", { length: 100 }).notNull(), code: varchar("code", { length: 80 }).notNull(),
  active: boolean("active").default(true).notNull(), createdAt: timestamp("createdAt").defaultNow().notNull(), updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [uniqueIndex("uniq_campaign_code").on(table.accountId, table.code)]);

export const conversionGoals = mysqlTable("conversion_goals", {
  id: int("id").autoincrement().primaryKey(), accountId: int("accountId").notNull(),
  name: varchar("name", { length: 80 }).notNull(), type: varchar("type", { length: 32 }).notNull(), destinationUrl: varchar("destinationUrl", { length: 2048 }),
  enabled: boolean("enabled").default(true).notNull(), priority: int("priority").default(3).notNull(), valueCents: bigint("valueCents", { mode: "number" }), currency: varchar("currency", { length: 3 }).default("JPY").notNull(),
  region: varchar("region", { length: 80 }), campaign: varchar("campaign", { length: 100 }), attributionDays: int("attributionDays").default(30).notNull(), primary: boolean("primary").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(), updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [index("idx_conversion_goal_account").on(table.accountId, table.enabled, table.priority)]);

export const conversionEvents = mysqlTable("conversion_events", {
  id: int("id").autoincrement().primaryKey(), accountId: int("accountId").notNull(), postId: int("postId"), postLogId: int("postLogId"), campaignId: int("campaignId"), conversionGoalId: int("conversionGoalId"),
  eventType: varchar("eventType", { length: 32 }).notNull(), eventTime: timestamp("eventTime").notNull(), quantity: int("quantity").default(1).notNull(), valueCents: bigint("valueCents", { mode: "number" }), currency: varchar("currency", { length: 3 }).default("JPY").notNull(),
  source: varchar("source", { length: 100 }), medium: varchar("medium", { length: 100 }), campaign: varchar("campaign", { length: 100 }), content: varchar("content", { length: 100 }), externalEventId: varchar("externalEventId", { length: 160 }), metadata: text("metadata"), note: varchar("note", { length: 500 }), registeredBy: int("registeredBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(), updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  uniqueIndex("uniq_conversion_external").on(table.accountId, table.externalEventId),
  index("idx_conversion_event_account_time").on(table.accountId, table.eventTime),
  index("idx_conversion_event_post").on(table.accountId, table.postId),
]);

export const conversionEventRevisions = mysqlTable("conversion_event_revisions", {
  id: int("id").autoincrement().primaryKey(), accountId: int("accountId").notNull(), conversionEventId: int("conversionEventId").notNull(), snapshot: text("snapshot").notNull(), changedBy: int("changedBy"), reason: varchar("reason", { length: 300 }), createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [index("idx_conversion_revision_event").on(table.accountId, table.conversionEventId)]);

export const contentStrategies = mysqlTable("content_strategies", {
  id: int("id").autoincrement().primaryKey(), accountId: int("accountId").notNull(), startDate: varchar("startDate", { length: 10 }).notNull(), status: mysqlEnum("status", ["draft", "approved", "archived"]).default("draft").notNull(),
  goal: varchar("goal", { length: 300 }).notNull(), audience: varchar("audience", { length: 300 }).notNull(), coreMessage: varchar("coreMessage", { length: 500 }).notNull(), warnings: text("warnings").notNull(), createdBy: int("createdBy"), createdAt: timestamp("createdAt").defaultNow().notNull(), updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [index("idx_strategy_account_start").on(table.accountId, table.startDate)]);

export const contentStrategyItems = mysqlTable("content_strategy_items", {
  id: int("id").autoincrement().primaryKey(), accountId: int("accountId").notNull(), strategyId: int("strategyId").notNull(), day: int("day").notNull(), date: varchar("date", { length: 10 }).notNull(), status: mysqlEnum("status", ["active", "excluded", "scheduled"]).default("active").notNull(),
  purpose: varchar("purpose", { length: 32 }).notNull(), theme: varchar("theme", { length: 160 }).notNull(), hook: varchar("hook", { length: 200 }).notNull(), cta: varchar("cta", { length: 200 }).notNull(), format: varchar("format", { length: 24 }).notNull(), recommendedTime: varchar("recommendedTime", { length: 5 }).notNull(), trend: varchar("trend", { length: 160 }), rationale: varchar("rationale", { length: 500 }).notNull(), expectedOutcome: varchar("expectedOutcome", { length: 300 }).notNull(), confidence: int("confidence").notNull(), hypothesis: boolean("hypothesis").default(true).notNull(), factCheckWarning: varchar("factCheckWarning", { length: 300 }), createdAt: timestamp("createdAt").defaultNow().notNull(), updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [index("idx_strategy_item_account").on(table.accountId, table.strategyId, table.date)]);

export const weeklyReviews = mysqlTable("weekly_reviews", {
  id: int("id").autoincrement().primaryKey(), accountId: int("accountId").notNull(), strategyId: int("strategyId").notNull(), result: text("result").notNull(), sampleSize: int("sampleSize").default(0).notNull(), createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [uniqueIndex("uniq_weekly_review_strategy").on(table.accountId, table.strategyId)]);

export const postQualityChecks = mysqlTable("post_quality_checks", {
  id: int("id").autoincrement().primaryKey(), accountId: int("accountId").notNull(), postId: int("postId"), contentHash: varchar("contentHash", { length: 64 }).notNull(), status: varchar("status", { length: 16 }).notNull(), summary: varchar("summary", { length: 800 }).notNull(), aiUsed: boolean("aiUsed").default(false).notNull(), createdBy: int("createdBy"), createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [index("idx_quality_account_post").on(table.accountId, table.postId, table.createdAt)]);

export const postQualityFindings = mysqlTable("post_quality_findings", {
  id: int("id").autoincrement().primaryKey(), accountId: int("accountId").notNull(), qualityCheckId: int("qualityCheckId").notNull(), code: varchar("code", { length: 60 }).notNull(), status: varchar("status", { length: 16 }).notNull(), message: varchar("message", { length: 500 }).notNull(), reason: varchar("reason", { length: 500 }).notNull(), evidence: varchar("evidence", { length: 500 }).notNull(), severity: int("severity").notNull(), suggestion: varchar("suggestion", { length: 500 }).notNull(), autoFixable: boolean("autoFixable").default(false).notNull(), humanReview: boolean("humanReview").default(false).notNull(), deterministic: boolean("deterministic").default(false).notNull(), createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [index("idx_quality_finding_check").on(table.accountId, table.qualityCheckId)]);
