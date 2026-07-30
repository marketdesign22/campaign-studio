# 完全無料ホスティング構成 — Render + TiDB + GitHub Actions

月額$0で自動投稿を運用する構成。仕組み: Render無料枠のサーバーは放置中は眠るが、
GitHub Actionsが投稿時間帯に30分おきに `/api/scheduled/tick` を叩いて起こし、
起きたサーバーが「時刻が来ているのに未投稿のスロット」を追い付き投稿する。

**トレードオフ**: 投稿が設定時刻から数分〜十数分遅れることがある。ダッシュボードの
初回表示に約1分かかる（眠りから起きるため）。クライアント運用を始めたら
Railway（月$5〜）への引っ越しを推奨。

## 1. TiDB Cloud（無料MySQL）— 10分

1. [tidbcloud.com](https://tidbcloud.com) にGoogleアカウントでサインアップ
2. **Serverless** クラスターを作成（リージョンは us-west-2 が無難）→ 永久無料枠
3. クラスター画面の **Connect** → Connect With: `General` → パスワードを生成
4. 表示された接続情報から `DATABASE_URL` を組み立てる（TLS必須）:

```
mysql://<user>:<pass>@<host>:4000/threads_studio?ssl={"minVersion":"TLSv1.2","rejectUnauthorized":true}
```

5. SQL Editor で `CREATE DATABASE threads_studio;` を実行しておく

## 2. Render（無料アプリサーバー）— 10分

1. [render.com](https://render.com) にGitHubアカウントでサインアップ
2. **New → Blueprint** → `campaign-studio` リポジトリを選択
   （リポジトリ直下の `render.yaml` が自動で読み込まれ、Root Directory・ブランチ・
   ビルドコマンドは設定済み）
3. 入力を求められる環境変数を設定:
   - `DATABASE_URL` — 手順1で組み立てた文字列
   - `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — 手順3で取得
   - `CRON_SECRET` — `openssl rand -hex 24` などで生成した適当な長い文字列
   - `ANTHROPIC_API_KEY` — AIアシストを使うなら（後からでも可）
4. デプロイ完了後、`https://threads-studio-xxxx.onrender.com` のようなURLが発行される

## 3. Google OAuth — 10分

1. [Google Cloud Console](https://console.cloud.google.com/apis/credentials) →
   認証情報を作成 → **OAuthクライアントID（ウェブアプリケーション）**
2. 承認済みリダイレクトURIに `https://<RenderのURL>/api/oauth/callback` を登録
3. ID/シークレットをRenderの環境変数に設定して再デプロイ

## 4. GitHub Actions（目覚まし役）— 5分

1. GitHubの `campaign-studio` リポジトリ → **Settings → Secrets and variables → Actions**
2. Secretsを2つ追加:
   - `TICK_URL` = RenderのURL（例 `https://threads-studio-xxxx.onrender.com`、末尾スラッシュなし）
   - `CRON_SECRET` = 手順2-3でRenderに設定したのと同じ値
3. **Actions** タブ → `threads-tick` → 有効化し、**Run workflow** で手動実行して
   緑（成功）になることを確認

> 注意（GitHub Actionsの仕様）:
> - scheduleは**デフォルトブランチ上のワークフローのみ**実行される
> - リポジトリに60日間コミットがないとscheduleが自動停止する（メールが来るので
>   「Keep workflow enabled」を押せば継続。運用中は月次でトラッカー更新コミットを
>   していれば実質問題にならない）
> - 実行時間帯は `.github/workflows/threads-tick.yml` にUTCで定義。投稿時刻を
>   大きく変えたらそこも調整する

## 5. 動作確認

1. RenderのURLを開く → Googleでサインイン（最初の1人が管理者になる）
2. 設定 → Threadsアカウント登録（Metaの長期トークン。取得方法はREADME参照）
3. 投稿を1本「今日」の日付で作成 → Actionsから `Run workflow` → 投稿されればOK

## 費用まとめ

| サービス | 無料枠 | 超える条件 |
|---|---|---|
| Render | 750時間/月・スリープあり | このアプリでは実質超えない |
| TiDB Serverless | 5GiB・月50億RU | このアプリでは実質超えない |
| GitHub Actions | プライベートリポジトリ2,000分/月 | 現在の設定で約900〜1,800分/月。不安なら実行間隔を45分に |
| Anthropic API | 従量課金（無料枠なし） | 週1回の下書き生成で月数十円。使わなければ$0 |
