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
- `trend_settings`（accountId ユニーク。`lastFetchError` は既存環境向けに `addColumn` で追加）
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
- 通信エラーとレート制限は間を空けて1回だけ再試行。認証・権限は即中断して種別を返す
- 失敗種別は `trend_settings.lastFetchError` に残し、トレンド画面で「次に何をすればよいか」（再接続など）を案内する
- レート制限で何も取れなかった枠はロックを戻し、次回の tick（15分後）で再試行する。認証・権限失敗は枠ごとに1回しか試さない
- スケジューラでは投稿処理の後に呼び、独立した try/catch で囲む。取得失敗が投稿・トークン更新・分析取得を止めることはない

## データの流れと話題性スコア

1. アカウント別のキーワードを Threads API の TOP / RECENT で取得し、最大3ページを追います。
2. `(accountId, platform, externalId)` で重複を除き、本文は140文字の安全な要約にして保存します。
3. `shared/trendScore.ts` の純粋関数が、新しさ、取得できた反応速度、返信の有無、前日比、自社テーマ適合度を0〜100へ正規化します。各項目の点数と根拠も保存します。
4. AI分析は要約を中心テーマ、フック、構成、語調、継続性、地域差、独自化の切り口、リスクへ構造化します。空や壊れたAI応答は保存しません。
5. 原稿作成は必ず異なる3案を候補として返します。選んだ案だけを利用者が編集欄へ反映し、承認・予約・投稿は従来フローで行います。
6. `posts.trendAnalysisId` と `trendMeta` を投稿結果に紐付け、7日または30日で「利用あり/なし」、時間帯、テーマ別を比較します。3件未満は結論を出さず、相関を因果と表現しません。

## スケジューラと運用

既存の15分tickの最後でトレンド取得を別の例外処理として実行するため、取得失敗は自動投稿を失敗させません。既定は1日2回で、アカウントのタイムゾーンと永続スロットキーで同一枠の重複実行を抑えます。手動更新は管理者のみ、アカウントごと5分間隔です。永続エラーは無限再試行せず、通信/5xxのみ1回再試行します。

## OAuth 再接続

Meta for Developers の Threads API 設定で `threads_keyword_search` を有効にし、アプリの設定画面から対象アカウントを再接続してください。同じThreads User IDのトークンだけを更新するため、原稿、予約、投稿履歴、分析は消えません。権限不足は「再接続」、認証切れは「アカウントを確認」、429は「時間をおいて再試行」と画面に表示します。

## 料金が発生する処理

Threads取得自体にOpenAI料金は発生しません。「AIで傾向を分析」と「トレンドから原稿3案を生成」で、設定された `OPENAI_MODEL` のAPI料金が発生します。AI分析はアカウントごとの1日上限で抑制できます。

## トラブルシューティング

- データなし: 業種・地域・キーワードを設定し、「今すぐ取得」を実行します。空キーワードでの広範囲検索は行いません。
- 権限不足/401: Threadsアカウントを再接続します。
- API制限/429: 手動取得を止め、次の自動取得枠を待ちます。保存済みデータは残ります。
- AI未設定: RenderのSecretに `OPENAI_API_KEY` と必要なら `OPENAI_MODEL` を設定します。
- タイムアウト/5xx: 一時障害として分類されます。既存データを削除せず、次回再試行できます。

## Render デプロイ前後の確認

### デプロイ前

1. DBバックアップを取得し、`pnpm db:counts` の結果を保存します。本番DBで `seed:demo` や `db:import` は実行しないでください。
2. SQLで主要件数を記録します: `SELECT 'accounts' t, COUNT(*) n FROM accounts UNION ALL SELECT 'posts', COUNT(*) FROM posts UNION ALL SELECT 'post_logs', COUNT(*) FROM post_logs UNION ALL SELECT 'post_analytics', COUNT(*) FROM post_analytics;`
3. Threadsアカウントの有効/失効、Renderの `DATABASE_URL`, OAuth, OpenAIのSecret名、Metaのcallback URLを確認します。Secretの値は画面やPRに貼らないでください。

### デプロイ後

1. 同じ件数SQLを再実行し、既存の `accounts/posts/post_logs/post_analytics` が減っていないことを確認します。新規トレンドテーブルは0件で正常です。
2. ログイン、既存投稿一覧、予約・承認、分析、AI接続テストを順に確認します。
3. トレンド画面で設定案内、キーワード登録、TOP/RECENT取得、AI分析、3案生成、選択案の編集と保存を確認します。この確認で「今すぐ投稿」は押さないでください。
4. 投稿スケジューラとトレンド取得のログを確認し、トークンや本文がログに出ていないことを確認します。

## ロールバック

アプリを直前のコミットへ戻し、再デプロイします。追加列とトレンドテーブルは従来コードから参照されないため、緊急ロールバック時に削除しないでください。復帰後に原因を確認し、必要な場合だけDBバックアップから回復します。

## Instagram公式APIの将来拡張

現在の `platform` と `source` を保ったまま、公式Instagram APIクライアントを収集アダプターとして追加します。アクセス可能な公開コンテンツ、保存できるフィールド、レート制限を当時のMeta公式仕様で再確認し、手動URL登録と自動取得を別の `source` として区別します。スクレイピングを代替にしません。
