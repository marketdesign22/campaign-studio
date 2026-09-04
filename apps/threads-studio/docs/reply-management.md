# 受信箱（返信管理）

自社投稿についた公開返信を一覧・返信できる機能です。**ダイレクトメッセージ（DM）は対象外**です。Threadsの公式APIにDM用のエンドポイントが無いため実装していません（スクレイピングもしません）。

## 構成

| 層 | ファイル | 役割 |
|---|---|---|
| 収集・送信 | `server/replies.ts` | 自社投稿への公開返信の取得、返信の送信 |
| 自動返信テンプレート | `server/replyTemplates.ts` | キーワード一致の判定（純粋関数。自動送信はしない） |
| API | `server/routers/replies.ts` | 一覧 / 既読 / 今すぐ取得 / 送信 / 未読件数 / `templates.*`（テンプレートCRUD） |
| 共通ロジック | `server/threadsErrors.ts`, `server/threadsRetry.ts` | Threads APIのエラー分類・再試行（トレンド機能と共有） |
| 画面 | `client/src/pages/Inbox.tsx` | 一覧・フィルタ・返信フォーム・テンプレート提案の表示 |
| 設定画面 | `client/src/pages/Settings.tsx` `ReplyTemplatesCard` | キーワード×返信文のテンプレートを登録・編集・削除 |
| スケジューラ | `server/scheduler.ts` | 15分tickの最後（トレンド取得の後）に `fetchRepliesForAccounts` |

## データ

追加型・冪等（`server/scripts/upgradeDb.ts`）。既存テーブル・列は変更しません。

- `accounts.lastReplyFetchAt`, `accounts.lastReplyFetchError`, `accounts.threadsUsername`（NULL許容の追加列）
- `thread_replies`（`UNIQUE (accountId, externalId)`）
- `reply_templates`（アカウントごとのキーワード×返信文。index `idx_reply_templates_account`）

保存するのは返信本文（最大500文字）・投稿者名・出典URL・投稿日時・非表示状態のみ。返信対象の自社投稿IDは持つが、DMやプロフィール情報などの追加PIIは保存しません。

## Threads API

- 取得: `GET /{threads-user-id}/replies`（`threads_read_replies`）。自社投稿への公開返信を一括で返す
- **自分自身の返信（スレッドの続き）は除外する**。`GET /{threads-user-id}/replies` は他人からの返信と、自分がスレッドを続けるために自分自身に返信したものを区別せずに返すため、`accounts.threadsUsername`（このアカウント自身のThreadsユーザー名）と一致する返信は保存・表示しない。`threadsUsername` が未登録の場合は初回の取得時に一度だけ自動解決して保存する（再接続は不要）。既に保存済みの行も一覧取得時に除外するので、この修正はデプロイ直後から効く
- 送信: 通常投稿と同じ2段階（コンテナ作成→公開）に `reply_to_id` を足すだけ（`threads_manage_replies`）
- **既存アカウントは再接続が必要**（設定画面の「アカウントを追加」から同じ表示名で連携リンクを再発行）

## 自動返信テンプレート（半自動・キーワード一致）

設定画面でアカウントごとに「キーワード（複数可）→ 返信の定型文」のペアを最大20件まで登録できます。受信箱の一覧取得時に、未返信の返信の本文と登録済みキーワードを大文字小文字を区別せず部分一致で照合し（`server/replyTemplates.ts` `matchReplyTemplate`、登録順で最初に一致したものを採用）、一致すれば候補として表示します。

**自動では絶対に送信しません。** 候補は受信箱にその場で表示されるだけで、実際にThreadsへ送るのは利用者が「この内容で送信」または「編集して送信」→送信を押した時だけです。送信操作自体は手動返信と全く同じ `replies.reply` エンドポイント（500文字制限・連打防止・ownership検証込み）を通ります。テンプレートを追加・変更・無効化しても、既存の返信データや送信済みの記録は書き換えません。

## 安全策

- APIキー・アクセストークンはクライアントへ返さない
- 返信はThreadsへ実際に1回だけ送信する操作。キーワード一致は「候補の表示」までで、AIによる自動生成・自動送信は無い
- 手動取得は管理者のみ・60秒間隔、送信は3秒間隔で連打を防止
- 通信エラーとレート制限は間を空けて1回だけ再試行。認証・権限は即中断して種別を返す
- 失敗種別は `accounts.lastReplyFetchError` に残し、画面で「次に何をすればよいか」（再接続など）を案内する
- ログにはトークン・返信本文・APIの生レスポンスを出さず、失敗の種別だけ残す
- スケジューラでは投稿処理・トレンド取得の後に呼び、独立した try/catch で囲む。取得失敗が投稿・トレンド取得に影響することはない

## 制限事項・今後

- DM（ダイレクトメッセージ）は非対応（公式APIが公開されていないため）
- 自動返信は固定テンプレート文のみ。AIによる言い回しの自動生成・不適切な返信の非表示（モデレーション）は未実装。必要であれば別PRで追加する
- 返信一覧は直近50件（1アカウントあたり）を取得する設計
