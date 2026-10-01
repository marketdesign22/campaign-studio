/** Additive and idempotent, shared by the existing deployment upgrade command. */
const definitions = [
  `CREATE TABLE IF NOT EXISTS report_post_daily (
    id int AUTO_INCREMENT PRIMARY KEY, accountId int NOT NULL, postLogId int NOT NULL, capturedDate varchar(10) NOT NULL,
    likes int NOT NULL, replies int NOT NULL, reposts int NOT NULL, views bigint NOT NULL, fetchedAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_report_post_day (accountId,postLogId,capturedDate), KEY idx_report_daily_account (accountId,capturedDate)
  )`,
  `CREATE TABLE IF NOT EXISTS report_configs (
    id int AUTO_INCREMENT PRIMARY KEY, accountId int NOT NULL, month varchar(7) NOT NULL, configJson text NOT NULL,
    UNIQUE KEY uniq_report_config_month (accountId,month)
  )`,
  `CREATE TABLE IF NOT EXISTS monthly_reports (
    id varchar(36) PRIMARY KEY, accountId int NOT NULL, month varchar(7) NOT NULL, autoKey varchar(80) NULL,
    status enum('draft','reviewed','sent') NOT NULL DEFAULT 'draft', revision int NOT NULL DEFAULT 1,
    dataJson mediumtext NOT NULL, narrativeJson text NOT NULL, narrativeSource enum('template','ai','edited') NOT NULL DEFAULT 'template',
    createdBy int NULL, generatedAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP, reviewedAt timestamp NULL, sentAt timestamp NULL,
    UNIQUE KEY uniq_report_auto (autoKey), KEY idx_monthly_report_account (accountId,month)
  )`,
];

export const REPORT_TABLES = definitions.map(ddl => {
  const table = ddl.match(/CREATE TABLE IF NOT EXISTS (\w+)/)![1];
  return {
    table,
    ddl: ddl.replace(
      `CREATE TABLE IF NOT EXISTS ${table}`,
      "CREATE TABLE `" + table + "`"
    ),
  };
});
