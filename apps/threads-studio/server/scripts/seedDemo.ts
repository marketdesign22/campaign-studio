/**
 * デモデータ投入スクリプト（商談・スクリーンショット用）。
 *
 *   pnpm seed:demo            — デモアカウント・原稿・履歴・分析データを投入
 *
 * 投入されるトークンはダミーのため実際の投稿はできません。
 * 実運用DBに対しては実行しないでください。
 */
import "dotenv/config";
import mysql from "mysql2/promise";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  const conn = await mysql.createConnection(url);

  console.log("[seed] デモアカウント");
  const [acc] = await conn.query(
    `INSERT INTO accounts (name, threadsUserId, threadsAccessToken, timezone, morningHour, eveningHour)
     VALUES ('SCSU 公式', '17840000000000000', 'DEMO_TOKEN_NOT_REAL', 'LA', 8, 18)`
  );
  const accountId = (acc as { insertId: number }).insertId;

  console.log("[seed] カテゴリー");
  await conn.query(`INSERT INTO categories (name, color) VALUES ('イベント', '#335B82'), ('キャンパス', '#ff9800'), ('入試情報', '#2f7d6d')`);

  console.log("[seed] 原稿");
  const today = new Date();
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const addDays = (n: number) => { const d = new Date(today); d.setDate(d.getDate() + n); return d; };
  const drafts: [string, number, number | null, string][] = [
    ["【夏期講習 受付開始】夏期集中講座の申込受付を開始しました。定員に達し次第締切となります。詳細はプロフィールのリンクから。", 0, 1, fmt(addDays(1))],
    ["図書館の開館時間が夏期スケジュールに変わります。平日 8:00-22:00 / 土日 9:00-18:00。試験前の学習にぜひご活用ください。", 1, 2, fmt(addDays(1))],
    ["オープンキャンパス、次回は8月23日(日)開催。キャンパスツアー・模擬授業・個別相談を実施します。", 0, 1, fmt(addDays(2))],
    ["奨学金の秋学期申請は8月15日締切です。学生支援課の窓口またはポータルサイトからお手続きください。", 1, 3, fmt(addDays(2))],
    ["学食の新メニュー「SCSUバーガー」が登場。学生投票で選ばれた一品です。", 0, 2, fmt(addDays(3))],
  ];
  for (const [content, slot, cat, date] of drafts) {
    await conn.query(
      `INSERT INTO posts (content, status, approvalStatus, slotIndex, scheduledDate, categoryId, accountId)
       VALUES (?, 'pending', 'approved', ?, ?, ?, ?)`,
      [content, slot, date, cat, accountId]
    );
  }

  console.log("[seed] 投稿履歴 + 分析データ（過去3週間）");
  const past: [string, number, number, number, number, number][] = [
    ["先週のオープンキャンパス、たくさんのご来場ありがとうございました！次回は8月23日(日)開催です。", 482, 36, 58, 8120, 1],
    ["新入生向けキャンパスツアーの動画を公開しました。入学前にキャンパスの雰囲気をチェック！", 341, 22, 41, 6033, 2],
    ["図書館の開館時間が夏期スケジュールに変わります。", 214, 12, 19, 4110, 3],
    ["サマーコンサートのチケット、残りわずかです。", 158, 9, 14, 3002, 5],
    ["学食の新メニューが登場しました。", 121, 18, 8, 2540, 7],
    ["前期試験の日程を公開しました。ポータルサイトをご確認ください。", 98, 6, 5, 1980, 10],
    ["キャリアセンター主催の企業説明会、参加登録受付中です。", 87, 4, 9, 1750, 14],
    ["サークル紹介ウィーク、今週開催中です。", 76, 11, 6, 1512, 18],
  ];
  for (const [content, likes, replies, reposts, views, daysAgo] of past) {
    const postedAt = new Date(today.getTime() - daysAgo * 24 * 3600 * 1000);
    const [logRes] = await conn.query(
      `INSERT INTO post_logs (content, status, threadsPostId, slotIndex, accountId, postedAt)
       VALUES (?, 'posted', ?, ?, ?, ?)`,
      [content, `1792${Math.floor(Math.random() * 1e10)}`, daysAgo % 2, accountId, postedAt]
    );
    const logId = (logRes as { insertId: number }).insertId;
    await conn.query(
      `INSERT INTO post_analytics (postLogId, threadsPostId, likes, replies, reposts, views)
       SELECT id, threadsPostId, ?, ?, ?, ? FROM post_logs WHERE id = ?`,
      [likes, replies, reposts, views, logId]
    );
  }
  // 失敗例も1件（エラーハンドリングのデモ用）
  await conn.query(
    `INSERT INTO post_logs (content, status, errorMessage, slotIndex, accountId, postedAt)
     VALUES ('奨学金の秋学期申請は8月15日締切です。', 'error', 'Threads publish failed (400): token expired', 0, ?, ?)`,
    [accountId, new Date(today.getTime() - 4 * 24 * 3600 * 1000)]
  );

  console.log("[seed] ブランド設定");
  await conn.query(
    `UPDATE settings SET brandName = 'SCSU Threads Studio' LIMIT 1`
  ).catch(() => {});

  console.log("[seed] 完了");
  await conn.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
