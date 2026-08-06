---
name: zero-cost-deploy
description: Webアプリを月額$0〜5で本番公開する構成（Render/Railway + TiDB + GitHub Actions + Google OAuth + Meta API）の構築レシピと、それを「デプロイ代行」としてクライアントワークで売るためのプレイブック。デプロイ・公開・ホスティング相談、他アプリの公開作業、デプロイ代行サービスの営業資料作成を頼まれたときに参照する。
---

# ゼロコストデプロイ — 構築レシピ＆クライアントワーク化

実績: 2026-08-06、Threads Studio（React+Express+MySQL+外部API+cron）を
この構成で本番公開まで完走済み（`apps/threads-studio/`）。オーナーは同じ手順を再現できる。

## 標準スタック

| 役割 | 無料構成 | 有料版（時刻厳守・クライアント向け） |
|---|---|---|
| アプリサーバー | Render Free（アイドルでスリープ） | Railway Hobby 月$5 |
| DB (MySQL) | TiDB Cloud Serverless（永久無料・カード不要・Spending Limit $0設定） | Railway MySQL |
| cron | GitHub Actions が投稿時間帯にHTTPで叩いて起こす（`.github/workflows/threads-tick.yml` 方式） | サーバー内蔵 setInterval |
| 認証 | Google OAuth（自前JWTセッション。テンプレは `apps/threads-studio/server/_core/oauth.ts` / `sdk.ts`） | 同左 |
| AI | Anthropic API（従量・月数十円） | 同左 |
| 通知 | Resend 無料枠 | 同左 |

設定ファイルの現物: リポジトリ直下 `render.yaml`、`.github/workflows/threads-tick.yml`、
手順書 `apps/threads-studio/docs/free-hosting.md`（顧客向け説明にもそのまま使える）。

## 実戦で踏んだ地雷（再発防止チェックリスト）

デプロイが落ちたら、この順で疑う:

1. **pnpm 10 はネイティブビルドを既定ブロック** → `package.json` に
   `pnpm.onlyBuiltDependencies: ["@tailwindcss/oxide", "esbuild"]` を明記
2. **DB の TLS はURLクエリでなくコードで有効化** — `?ssl={...}` は貼り付けで壊れる。
   `server/dbConfig.ts` 方式（localhost以外は常時TLS、`DB_SSL=off/insecure` で上書き）
3. **本番バンドルに vite を入れない** — serveStatic を vite 非依存ファイルに分離し、
   dev時のみ動的import。esbuild に `--external:./vite`
4. **新品DBには基本テーブルが無い** — マイグレーションは CREATE TABLE IF NOT EXISTS から。
   `CREATE DATABASE IF NOT EXISTS` も起動時に実行
5. **GitHub Actions の schedule はデフォルトブランチのみ実行** — 作業ブランチに置いても動かない
6. **Actions の schedule は最大1〜2時間遅延・稀にRunner障害で失敗** — 冪等設計＋追い付き投稿で吸収。
   「時刻±90分」を許容できない案件は Railway へ
7. **Google OAuth**: JS origins にパスは入れない / リダイレクトURIは
   `https://<domain>/api/oauth/callback` / テストモードでは**Test users登録者しかログイン不可** /
   クライアントシークレットは表示1回きり
8. **Meta (Threads) API**: 開発モードのままでも自分＋Threads Tester招待で運用可（審査不要）。
   テスター承認は**スマホのThreadsアプリ側**（設定→アカウント→ウェブサイトの権限）で行う
9. **コピペの前後空白**が原因のエラーが頻出（Google・Render入力欄）。エラー文に whitespace とあればまずこれ
10. **秘密情報がスクショ/チャットに写ったら**作業完了後にローテーション
    （Googleシークレット再発行 / TiDB Reset Password / トークン再生成）

## クライアントワークとしての売り方

**商品名の例**: 「アプリ公開代行 / Launch Package」。
「作ったのに公開できない」「Manus・Replit・ローカルでしか動かない」人が客。

### ターゲット
- AIツール（Cursor/Claude/ChatGPT/Manus等）でアプリを作ったが公開方法が分からない個人・スモールビジネス
- ノーコード卒業組、Web制作者からの下請け
- 既存Threads Studio見込み客への追加提案（「あなたの環境に建てます」）

### プラン（日本 / 米国）

| プラン | 内容 | 価格 |
|---|---|---|
| Launch | 公開一式（ドメイン・DB・認証・デプロイ・動作確認・手順書） | 5〜8万円 / $500〜800 |
| Launch+ | ＋独自ドメイン・メール通知・cron・簡易監視 | 10〜15万円 / $1,000〜1,500 |
| 保守 | 月次: 依存更新・障害対応・小修正（合計2h目安） | 月1〜2万円 / $150〜300 |

- 原価はほぼゼロ（無料構成）〜月$5。**見積りの根拠は「あなたの時間単価」**（$75〜150/h換算）
- 保守なし納品は不可とは言わないが、「壊れた時は都度スポット2万円〜」を明記して保守に誘導
- 納品物: 稼働URL / 全認証情報の引き渡し（1Password共有等） / 運用手順書（free-hosting.md様式）/ 30日間の初期不良対応

### ピッチ（3文）
1. 「作ったアプリ、まだ手元でしか動いていませんよね？」
2. 「月額0円〜のクラウド構成で、○日以内にURL付きで公開します。実例がこれです（Threads Studioを見せる）」
3. 「公開後の運用手順書と30日サポート付き。まず無料で構成診断します」

### 受注時の作業フロー（1案件 実働4〜8時間）
1. ヒアリング: 技術スタック / DB有無 / cron有無 / 認証有無 / 時刻厳守要件（→無料 or Railway判定）
2. リポジトリを受領 → 地雷チェックリストを先回りで適用
3. アカウント類は**クライアント名義**で作らせる（自分のカードや名義で作らない。画面共有で誘導）
4. デプロイ → 動作確認 → 手順書 → 引き渡し → 秘密情報ローテーション

### 実績の見せ方
- Threads Studio 本番URL（稼働中デモ）
- 「$0/月で 認証・DB・自動実行つきのフルスタックアプリ」という構成図 1枚
- 販売プレイブック `threads-studio-sales` と併用（Threads運用代行とのクロスセル）
