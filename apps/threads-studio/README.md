# Threads Studio — Threads運用ダッシュボード

組織の公式Threadsアカウントを計画・自動配信・分析まで一括で運用するダッシュボードです。
複数アカウント・承認フロー・AI原稿アシスト・月次レポート・ホワイトレーベルに対応しています。

## 主な機能

| 機能 | 説明 |
|---|---|
| 自動投稿 | アカウントごとに朝・夕の投稿時刻とタイムゾーン（PT/MT/CT/ET/JST）を設定。15分ごとのtickが時刻到来を判定して投稿 |
| 予約カレンダー | ドラッグ&ドロップで投稿日を変更。**予約日が来ていない原稿は投稿されません** |
| 複数アカウント | 1つの環境で複数のThreadsアカウントを運用（代理店・複数ブランド向け） |
| 承認フロー | 有効化すると新規原稿は「下書き」になり、承認済みのみ自動投稿 |
| AIアシスト | 過去投稿の文体を学習した下書き生成・リライト |
| 分析 | Threads Insights APIから いいね/返信/リポスト/ビュー を日次自動取得 |
| 月次レポート | クライアント報告用サマリー。印刷でPDF保存 |
| トークン自動更新 | 長期トークン（60日で失効）を7日ごとに自動リフレッシュ。失敗時は通知 |
| ホワイトレーベル | ブランド名・アクセントカラーを設定画面から変更 |
| 日英切替UI | サイドバーのトグルで日本語/英語を切替（設定は端末ごとに保存） |
| 米国タイムゾーン | アカウントごとに PT / MT / CT / ET / JST を選択可能 |

## セットアップ

```bash
pnpm install
pnpm db:upgrade      # スキーマを最新化（冪等・何度でも実行可）
pnpm dev             # 開発サーバー
```

必要な環境変数: `DATABASE_URL`（MySQL）ほか、Manusプラットフォームが注入する認証系変数。

### cron登録（デプロイ後に1回）

新方式は **tick 1本** です。15分ごとに起動し、各アカウントの設定時刻・タイムゾーンに従って投稿します。

```bash
manus-heartbeat create \
  --name threads-tick \
  --cron "0 */15 * * * *" \
  --path /api/scheduled/tick \
  --description "Threads自動投稿tick（15分ごと）"
```

旧方式の `/api/scheduled/morning-post` `/api/scheduled/evening-post` も互換のため残っていますが、
tickに移行してください（設定画面の投稿時刻が反映されるのはtickのみ）。

### Threadsトークンの取得

1. [Meta for Developers](https://developers.facebook.com/) でThreads APIアプリを作成
2. 長期アクセストークン（60日有効）を取得
3. 設定ページ →「Threadsアカウント」→「追加」で登録（登録時に自動検証されます）

登録後はサーバーが7日ごとに自動リフレッシュするため、手動更新は不要です。

## デモ環境

商談・スクリーンショット用のダミーデータを投入できます（実運用DBでは実行しないこと）:

```bash
pnpm seed:demo
```

## 開発

```bash
pnpm check    # 型チェック
pnpm test     # ユニットテスト（スケジューラのタイムゾーン処理など）
pnpm build    # 本番ビルド
```

### アーキテクチャ概要

- `server/scheduler.ts` — 投稿エンジン。タイムゾーン計算・スロット発火判定・日次メンテナンス（トークン更新・Insights取得）
- `server/threadsApi.ts` — Threads Graph API クライアント（投稿・トークン更新・Insights）
- `server/routers/` — tRPC ルーター（accounts / posts / ai / analytics / settings ...）
- `server/scripts/upgradeDb.ts` — 冪等なDBアップグレード（information_schema検査方式）
- `client/src/pages/` — React ページ。デザイントークンは `client/src/index.css`

### 設計上の注意

- drizzleの過去マイグレーション（`drizzle/*.sql`）は実DBと乖離しているため使用しない。
  スキーマ変更は `drizzle/schema.ts`（型の源泉）と `server/scripts/upgradeDb.ts` の両方に追加する。
- 投稿の二重送信防止は post_logs ベース（アカウント×スロット×ローカル日付で1回）。
  サーバー停止でtickが飛んでも、復帰後のtickで「遅れて投稿」される（投稿されないことはない）。
