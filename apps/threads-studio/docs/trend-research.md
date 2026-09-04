# トレンドリサーチ機能

Threads / Instagram の話題を収集し、話題性スコア・AI分析・原稿生成・学習サイクルまでをアカウント単位で回す機能です。

## 構成

| 層 | ファイル | 役割 |
|---|---|---|
| 収集・分析 | `server/trends.ts` | Threads `keyword_search`（TOP + RECENT）、重複排除、スコア付け、保存、AI分析 |
| API | `server/routers/trends.ts` | 一覧 / 保存・除外 / 今すぐ取得 / AI分析 / 設定 / 参考URL登録 / おすすめ |
| 原稿生成 | `server/routers/ai.ts` `generateDrafts` | `trend` 入力で分析を構成・切り口として反映。3案を角度違いで返す |
| スコア | `shared/trendScore.ts` | 0〜100 の話題性スコアと内訳 |
| 学習 | `shared/trendLearning.ts` | 7日の成果集計（トレンド反映 vs 未反映）と参考URLの解釈 |
| 画面 | `client/src/pages/Trends.tsx` | 収集投稿 / 傾向分析 / おすすめ の3タブ |
| 設定 | `client/src/pages/Settings.tsx` `TrendSettingsCard` | キーワード・除外語・参考アカウント・言語・地域・業種・取得時刻・自動取得・保存期間・AI上限 |
| スケジューラ | `server/scheduler.ts` | 15分tickの最後に `runTrendFetchIfDue`、日次で `markDeletedSavedPosts` |

## データ

すべて追加型・冪等（`server/scripts/upgradeDb.ts`）。既存テーブル・列は変更しません。

- `posts.trendAnalysisId`, `posts.trendMeta`（NULL許容の追加列）
- `trend_settings`（accountId ユニーク）
- `trend_posts`（`UNIQUE (accountId, platform, externalId)`）
- `trend_analyses`

保存するのは要約（先頭140文字）・出典URL・投稿者名・投稿日時・取得日時のみ。全文は保存しません。

## Threads API の制約

- `keyword_search` は `id, text, media_type, permalink, timestamp, username, has_replies, is_quote_post, is_reply` しか返しません。**他人の投稿のいいね・返信数・閲覧数は取れない**ため、それらは `null`（画面では「取得不可」）で保存し、スコアは取れた指標（新しさ・返信の有無・キーワード出現の伸び・自社テーマ適合）だけで正規化します。
- 上限は 1ユーザーあたり 2,200 クエリ / 24時間。既定（20キーワード × 2種類 × 1日2回 = 80回）で十分余裕があります。
- スコープ `threads_keyword_search` が必要です。**既存アカウントは設定画面から再接続してください**（再接続するまで取得は「権限不足」になります）。

## Instagram

公式APIの連携（Instagram Graph API / Facebookログイン）はこのアプリに無いため、**Instagram の自動収集は実装していません**。公開投稿URLの手動登録のみ対応し、本文・反応数は「取得不可」と表示します。スクレイピングは行いません。

## 安全策

- APIキー・アクセストークンはクライアントへ返さない（`getSettings` は内部ロックキーも返さない）
- 返信は収集しない。除外語を含む投稿は保存しない
- 出典URLと取得日時を必ず保存し、保存済み投稿は日次で存在確認して削除済みを表示
- AI分析の画面には「推測を含む・事実は元投稿で確認」の警告を常時表示
- AI生成結果は原稿の「案」として返すだけで、既存の承認フロー（`requireApproval`）をそのまま通る。自動投稿はしない
- 手動取得は管理者のみ・5分間隔、AI分析は 1日 `aiDailyLimit` 回（既定20）
- 通信エラーのみ1回再試行。認証・権限・レート制限は即中断して種別を返す
