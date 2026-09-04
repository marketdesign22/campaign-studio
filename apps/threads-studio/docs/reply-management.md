# 受信箱（返信管理）

自社投稿についた公開返信を一覧・返信できる機能です。**ダイレクトメッセージ（DM）は対象外**です。Threadsの公式APIにDM用のエンドポイントが無いため実装していません（スクレイピングもしません）。

## 構成

| 層 | ファイル | 役割 |
|---|---|---|
| 収集・送信 | `server/replies.ts` | 自社投稿への公開返信の取得、返信の送信 |
| API | `server/routers/replies.ts` | 一覧 / 既読 / 今すぐ取得 / 送信 / 未読件数 |
| 共通ロジック | `server/threadsErrors.ts`, `server/threadsRetry.ts` | Threads APIのエラー分類・再試行（トレンド機能と共有） |
| 画面 | `client/src/pages/Inbox.tsx` | 一覧・フィルタ・返信フォーム |
| スケジューラ | `server/scheduler.ts` | 15分tickの最後（トレンド取得の後）に `fetchRepliesForAccounts` |

## データ

追加型・冪等（`server/scripts/upgradeDb.ts`）。既存テーブル・列は変更しません。

- `accounts.lastReplyFetchAt`, `accounts.lastReplyFetchError`（NULL許容の追加列）
- `thread_replies`（`UNIQUE (accountId, externalId)`）

保存するのは返信本文（最大500文字）・投稿者名・出典URL・投稿日時・非表示状態のみ。返信対象の自社投稿IDは持つが、DMやプロフィール情報などの追加PIIは保存しません。

## Threads API

- 取得: `GET /{threads-user-id}/replies`（`threads_read_replies`）。自社投稿への公開返信を一括で返す
- 送信: 通常投稿と同じ2段階（コンテナ作成→公開）に `reply_to_id` を足すだけ（`threads_manage_replies`）
- **既存アカウントは再接続が必要**（設定画面の「アカウントを追加」から同じ表示名で連携リンクを再発行）

## 安全策

- APIキー・アクセストークンはクライアントへ返さない
- 返信はThreadsへ実際に1回だけ送信する操作。AIによる自動返信・自動送信は無い（このPRでは案生成も実装していない）
- 手動取得は管理者のみ・60秒間隔、送信は3秒間隔で連打を防止
- 通信エラーとレート制限は間を空けて1回だけ再試行。認証・権限は即中断して種別を返す
- 失敗種別は `accounts.lastReplyFetchError` に残し、画面で「次に何をすればよいか」（再接続など）を案内する
- ログにはトークン・返信本文・APIの生レスポンスを出さず、失敗の種別だけ残す
- スケジューラでは投稿処理・トレンド取得の後に呼び、独立した try/catch で囲む。取得失敗が投稿・トレンド取得に影響することはない

## 制限事項・今後

- DM（ダイレクトメッセージ）は非対応（公式APIが公開されていないため）
- AIによる返信案の生成・不適切な返信の非表示（モデレーション）は未実装。必要であれば別PRで追加する
- 返信一覧は直近50件（1アカウントあたり）を取得する設計
