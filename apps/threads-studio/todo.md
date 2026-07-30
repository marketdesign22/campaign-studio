# SCSU Threads Auto Poster — TODO

## v2 — 商品化アップデート（完了）
- [x] Threads APIドメイン修正（graph.threads.net）
- [x] 予約日フィルタ: 予約日が来ていない原稿は投稿しない
- [x] tick方式スケジューラ（15分ごと・設定時刻/タイムゾーン反映・二重投稿防止・自己修復）
- [x] 長期トークンの自動リフレッシュ（7日ごと）＋失効前通知
- [x] 投稿失敗時のオーナー通知
- [x] Threads Insights API から分析データを日次自動取得（手動「最新化」も可）
- [x] 複数アカウント対応（accounts テーブル・アカウント別スケジュール）
- [x] 承認フロー（下書き→承認→自動投稿）
- [x] AIアシスト（ブランドボイス学習の下書き生成・リライト）
- [x] 月次レポートページ（印刷=PDF保存対応）
- [x] ホワイトレーベル（ブランド名・アクセントカラー）
- [x] モバイル: メニュータップでサイドバー自動クローズ
- [x] デザイン刷新（明朝×ゴシック・デザイントークン化）
- [x] 冪等DBアップグレードスクリプト（pnpm db:upgrade）
- [x] デモデータシード（pnpm seed:demo）
- [x] スケジューラのユニットテスト（タイムゾーン・DST・発火判定）
- [x] README（セットアップ・cron登録・アーキテクチャ）

新しいcron登録（従来の morning/evening の代わりに tick 1本）は README.md を参照。


## Features
- [x] Project initialized
- [x] DB schema: settings, posts, post_logs tables
- [x] DB migration applied
- [x] tRPC router: settings (get/save Threads token)
- [x] tRPC router: posts (list/create/update/delete)
- [x] tRPC router: postLogs (list history)
- [x] tRPC router: manualPost (immediate post)
- [x] Threads API service (2-step: create container → publish)
- [x] Heartbeat cron handler: morning post (LA 8:00 = UTC 15:00)
- [x] Heartbeat cron handler: evening post (LA 18:00 = UTC 01:00+1)
- [x] Heartbeat jobs registered via manus-heartbeat CLI (registered post-deploy — see POST-DEPLOY STEPS)
- [x] Frontend: DashboardLayout with sidebar
- [x] Frontend: Dashboard/Home page (stats + next post preview)
- [x] Frontend: Posts management page (list/add/edit/delete)
- [x] Frontend: Post history page (status filter)
- [x] Frontend: Settings page (token input + save)
- [x] Frontend: Manual post button with confirmation
- [x] Vitest: settings router test
- [x] Vitest: threads API service unit test

## POST-DEPLOY STEPS (run after publishing the site)

After deploying, register the two cron jobs from the sandbox terminal:

```bash
# Morning post — LA 8:00 = UTC 15:00
manus-heartbeat create \
  --name scsu-morning-post \
  --cron "0 0 15 * * *" \
  --path /api/scheduled/morning-post \
  --description "SCSU Threads morning auto-post (LA 8:00)"

# Evening post — LA 18:00 = UTC 01:00 next day
manus-heartbeat create \
  --name scsu-evening-post \
  --cron "0 0 1 * * *" \
  --path /api/scheduled/evening-post \
  --description "SCSU Threads evening auto-post (LA 18:00)"
```

Verify with: `manus-heartbeat list`

## Design & Feature Updates
- [ ] Generate illustration icons (sun/moon/dashboard/posts/history/settings)
- [ ] Apply school colors: blue #335B82, orange #ff9800
- [ ] Add Threads logo to sidebar
- [ ] DB: add morningHour, morningMinute, eveningHour, eveningMinute, timezone columns to settings
- [ ] Backend: tRPC settings router returns/saves time config
- [ ] Frontend: Settings page — time picker with LA/Japan timezone toggle
- [ ] Frontend: Replace emoji with illustration icons throughout UI
- [ ] Frontend: Add Threads icon to sidebar header
- [ ] カレンダープレビュー機能：インポート後のスケジュールをカレンダーで確認・微調整
- [ ] 分析ページにランキングボード追加（日別・週別・月別トップ5グラフ＋リスト）
- [ ] threads-autoposterスキルを最新機能（一括インポート・カレンダー・分析・SVGアイコン）に更新
- [ ] カレンダーのドラッグ＆ドロップ機能（@dnd-kit）
