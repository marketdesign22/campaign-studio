/**
 * Instagram 公開の依頼台帳のテーブル定義。
 *
 * 既存テーブルは変更しない。instagram_publications を1つ足すだけ。
 * `pnpm db:upgrade`（起動時に実行）が、無ければ作る（何度実行しても失敗しない）。
 * このファイルは DB へ接続しない（upgradeDb から読み込むため）。
 */
import {
  boolean,
  int,
  mysqlTable,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/mysql-core";

export const instagramPublications = mysqlTable("instagram_publications", {
  /** 大漁マーケットの scheduled_posts.id（冪等キー） */
  scheduledPostId: varchar("scheduledPostId", { length: 64 }).primaryKey(),
  externalClientId: varchar("externalClientId", { length: 64 }).notNull(),
  igUserId: varchar("igUserId", { length: 64 }).notNull(),
  state: varchar("state", { length: 16 }).notNull(),
  caption: text("caption").notNull(),
  mediaUrls: text("mediaUrls"),
  childContainerIds: text("childContainerIds"),
  creationId: varchar("creationId", { length: 64 }),
  mediaId: varchar("mediaId", { length: 64 }),
  permalink: varchar("permalink", { length: 512 }),
  error: text("error"),
  attempts: int("attempts").notNull().default(0),
  publishAttempted: boolean("publishAttempted").notNull().default(false),
  requestDigest: varchar("requestDigest", { length: 64 }).notNull(),
  /** コンテナ作成中の借用（creating のときだけ） */
  leaseToken: varchar("leaseToken", { length: 64 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export const INSTAGRAM_TABLES: { table: string; ddl: string }[] = [
  {
    table: "instagram_publications",
    ddl: `
    CREATE TABLE \`instagram_publications\` (
      \`scheduledPostId\` varchar(64) PRIMARY KEY,
      \`externalClientId\` varchar(64) NOT NULL,
      \`igUserId\` varchar(64) NOT NULL,
      \`state\` varchar(16) NOT NULL,
      \`caption\` text NOT NULL,
      \`mediaUrls\` text NULL,
      \`childContainerIds\` text NULL,
      \`creationId\` varchar(64) NULL,
      \`mediaId\` varchar(64) NULL,
      \`permalink\` varchar(512) NULL,
      \`error\` text NULL,
      \`attempts\` int NOT NULL DEFAULT 0,
      \`publishAttempted\` boolean NOT NULL DEFAULT false,
      \`requestDigest\` varchar(64) NOT NULL,
      \`leaseToken\` varchar(64) NULL,
      \`createdAt\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
      \`updatedAt\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `,
  },
];

export const INSTAGRAM_INDEXES: {
  table: string;
  index: string;
  columns: string;
}[] = [
  {
    table: "instagram_publications",
    index: "idx_instagram_publications_state",
    columns: "`state`, `updatedAt`",
  },
];
