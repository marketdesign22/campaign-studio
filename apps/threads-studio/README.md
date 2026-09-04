# Threads Studio — Threads運用ダッシュボード

組織の公式Threadsアカウントを計画・自動配信・分析まで一括で運用するダッシュボードです。
複数アカウント・承認フロー・AI原稿アシスト・月次レポート・ホワイトレーベルに対応しています。

**スタンドアロン版**: Googleログイン＋内蔵スケジューラ搭載。Railway（または任意のNode.jsホスティング）＋MySQLだけで動作し、外部プラットフォームへの依存はありません。

## 主な機能

| 機能 | 説明 |
|---|---|
| 自動投稿 | アカウントごとに朝・夕の投稿時刻とタイムゾーン（PT/MT/CT/ET/JST）を設定。内蔵スケジューラが15分ごとに時刻到来を判定して投稿 |
| 予約カレンダー | ドラッグ&ドロップで投稿日を変更。**予約日が来ていない原稿は投稿されません** |
| 複数アカウント | 左上の切り替えUIで運用先を選択。原稿・予約・履歴・分析・レポート・設定・トークンがアカウント単位で完全に分離される（[docs/multi-account.md](docs/multi-account.md)） |
| 承認フロー | 有効化すると新規原稿は「下書き」になり、承認済みのみ自動投稿 |
| AIアシスト | 過去投稿の文体を学習した下書き生成・リライト（OpenAI API・日英対応） |
| クライアント情報読み取り | 公式サイトと連携済みThreadsから、出典・信頼度付きのプロフィール候補と検索条件を作成（[docs/client-profile-reading.md](docs/client-profile-reading.md)） |
| トレンドリサーチ | Threads公式キーワード検索、Instagram参考URL、AI分析、3案生成、成果学習（[docs/trend-research.md](docs/trend-research.md)） |
| 分析 | Threads Insights APIから いいね/返信/リポスト/ビュー を日次自動取得 |
| 月次レポート | クライアント報告用サマリー。印刷でPDF保存 |
| トークン自動更新 | 長期トークン（60日で失効）を7日ごとに自動リフレッシュ。失敗時はメール通知 |
| ホワイトレーベル | ブランド名・アクセントカラーを設定画面から変更 |
| 日英切替UI | サイドバーのトグルで日本語/英語を切替（設定は端末ごとに保存） |
| Googleログイン | Google OAuthでサインイン。`ALLOWED_EMAILS` で招待制にできる |

## マルチアカウント

画面左上の切り替えで運用対象のアカウントを選びます。選択はブラウザに保存され、
ページを移動しても維持されます。切り替えると、ダッシュボード・投稿原稿管理・
カレンダー・投稿履歴・分析・月次レポート・設定・投稿先のすべてが
そのアカウントのものに切り替わります。

絞り込みは画面側ではなくサーバー側で行われ、`x-account-id` ヘッダの値は
必ず検証されます。予約投稿はUIの選択状態とは無関係に、予約レコードの
アカウントとトークンで実行されます。

運用中のDBへ導入する手順（バックアップ・件数の突き合わせ・ロールバック）は
[docs/multi-account.md](docs/multi-account.md) を参照してください。

## ローカル開発

```bash
pnpm install
cp .env.example .env   # 値を埋める（最低限 DATABASE_URL / JWT_SECRET / GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET）
pnpm db:upgrade        # スキーマを最新化（冪等・何度でも実行可）
pnpm dev               # 開発サーバー
```

### Google OAuth の準備

1. [Google Cloud Console](https://console.cloud.google.com/apis/credentials) で「OAuthクライアントID（ウェブアプリケーション）」を作成
2. 承認済みリダイレクトURIに以下を登録:
   - ローカル: `http://localhost:3000/api/oauth/callback`
   - 本番: `https://<あなたのドメイン>/api/oauth/callback`
3. クライアントID/シークレットを `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` に設定

**アクセス制御**: `ALLOWED_EMAILS`（カンマ区切り）に載っているメールだけがログインできます。
未設定の場合は**最初にログインした人だけ**が受け入れられ、自動的に管理者になります。

## デプロイ

**完全無料で運用する場合**: Render＋TiDB＋GitHub Actionsの構成が使えます（投稿が数分遅れる
トレードオフあり）。手順は [docs/free-hosting.md](docs/free-hosting.md)。
クライアント案件では以下のRailway構成（月$5〜・遅延なし）を推奨。

## Railway へのデプロイ

1. Railway で新規プロジェクトを作成し、このリポジトリ（`apps/threads-studio`）を接続
   - モノレポの場合はサービスの Root Directory を `apps/threads-studio` に設定
2. **MySQL** プラグインを追加し、アプリの `DATABASE_URL` に `${MySQL.MYSQL_URL}` を設定
3. Variables に `.env.example` の必須項目を設定（`JWT_SECRET` は `openssl rand -hex 32` で生成）
4. デプロイ後に発行されるドメインを `APP_URL` に設定し、GoogleコンソールのリダイレクトURIにも追加

`railway.json` により、ビルド（`pnpm build`）→ マイグレーション（`pnpm db:upgrade`）→ 起動（`pnpm start`）が自動で行われます。

### スケジューラについて

サーバープロセス内蔵のスケジューラが**15分ごと**に自動投稿tickを実行します。外部cronの登録は不要です。

- 停止したい場合: `DISABLE_SCHEDULER=1`
- 外部cron（GitHub Actions等）から叩きたい場合: `CRON_SECRET` を設定し
  `POST /api/scheduled/tick`（ヘッダー `Authorization: Bearer $CRON_SECRET`）

投稿の二重送信防止は post_logs ベース（アカウント×スロット×ローカル日付で1回）なので、
再起動・複数tickでも多重投稿にはなりません。サーバー停止中に到来したスロットは復帰後のtickで遅れて投稿されます。

### Threadsトークンの取得

1. [Meta for Developers](https://developers.facebook.com/) でThreads APIアプリを作成
2. 長期アクセストークン（60日有効）を取得
3. 設定ページ →「Threadsアカウント」→「追加」で登録（登録時に自動検証されます）

登録後はサーバーが7日ごとに自動リフレッシュするため、手動更新は不要です。

### 通知メール（任意）

`RESEND_API_KEY` と `NOTIFY_EMAIL` を設定すると、トークン失効・投稿エラー時に
[Resend](https://resend.com) 経由でメール通知が届きます。未設定ならサーバーログのみ。

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
- `server/cron.ts` — 内蔵スケジューラ（15分ごとに runTick を実行）
- `server/threadsApi.ts` — Threads Graph API クライアント（投稿・トークン更新・Insights）
- `server/_core/oauth.ts` — Google OAuth（認可コードフロー＋IDトークン検証）
- `server/_core/sdk.ts` — セッションJWTの発行・検証
- `server/_core/llm.ts` — Anthropic API クライアント（AIアシスト）
- `server/_core/notification.ts` — Resend メール通知
- `server/routers/` — tRPC ルーター（accounts / posts / ai / analytics / settings ...）
- `server/scripts/upgradeDb.ts` — 冪等なDBアップグレード（information_schema検査方式）
- `client/src/pages/` — React ページ。デザイントークンは `client/src/index.css`

### 設計上の注意

- drizzleの過去マイグレーション（`drizzle/*.sql`）は実DBと乖離しているため使用しない。
  スキーマ変更は `drizzle/schema.ts`（型の源泉）と `server/scripts/upgradeDb.ts` の両方に追加する。
- Threadsアクセストークンは DB とサーバー環境変数のみに保存し、Gitにはコミットしない。
