# 月次レポート（クライアント提出用）

`/report` 画面。印刷（PDF保存）してそのまま提出できる構成で、集計は決定論的、文章だけ AI の下書きを人が編集します。

## 構成

| 層 | ファイル | 役割 |
|---|---|---|
| 型・計算 | `shared/report.ts` | `ReportData` 型、反応率・前月比・達成率などの純粋関数（画面とサーバーで共有） |
| 集計 | `server/reportBuilder.ts` | `buildReportData(account, scope, year, month)`。AIを使わない |
| 文章 | `server/reportNarrative.ts` | `invokeLLM`（json_object）で総評・良かった点・課題・施策を下書き。zod で検証 |
| API | `server/routers/reports.ts` | `get` / `generate` / `regenerateNarrative` / `saveNarrative` / `setStatus` / `targets` / `saveTargets` |
| 日次取得 | `server/accountInsights.ts` | アカウント全体の日次 views / clicks（直近30日を上書き） |
| 自動生成 | `server/reportMaintenance.ts` | 月が替わったあと最初の日次メンテナンスで前月分を draft 作成し通知 |
| 画面 | `client/src/pages/Report.tsx` | KPIカード → グラフ → 表 → 投稿 → 成果 → [改ページ] 文章 → 付録 |

## データ（追加型・冪等。`server/scripts/upgradeDb.ts`）

- `post_analytics.quotes` / `shares`（既定 0）。`fetchPostInsights` が `quotes,shares` も取る
- `post_analytics_daily`: 投稿ごとの反応数の日次スナップショット（`postLogId, capturedDate` 一意）。`fetchAnalyticsForRecentPosts` が毎回書く。取得対象は直近 92 日
- `account_insights_daily`: `accountId, date` 一意。views / clicks は NULL 可（取れない指標は 0 にしない）
- `kpi_targets`: `accountId, yearMonth, metric` 一意
- `reports`: `accountId, yearMonth` 一意。status は draft / reviewed / sent

## 集計のルール

- 日付（月の境界・日次・曜日×時間帯）はアカウントのタイムゾーンで切る
- 閲覧数・反応数は「その月に公開した投稿」の最新値の合計（投稿ベース）。日次推移の閲覧数だけはアカウント全体の日次インサイト（別ソース）
- 反応数 = いいね + 返信 + 再投稿 + 引用 + シェア。反応率 = 反応数 ÷ 閲覧数（閲覧 0 は null）
- データが無い指標は 0 ではなく null。画面では「—」
- 投稿 TOP5 / 改善余地: 閲覧 50 以上を反応率順。改善余地は対象 10 件未満なら空
- CV計測が無効のアカウントではリンククリック・コンバージョンは null
- `notes` に「フォロワー履歴なし / 日次インサイト未取得 / 前月データなし / 投稿5件未満 / 目標未設定 / 反応未取得の投稿あり / CV計測無効」を日本語で列挙し、画面の付録と AI 入力の両方に渡す

## 文章（AI下書き）

- 入力は集計結果の数値要約だけ。投稿本文は冒頭 60 文字まで
- システムプロンプトで固定: 渡した数値以外を使わない／null を埋めない／投稿5件未満や注記がある月は断定しない／根拠のない因果を書かない／敬体／施策は「何を・どのくらい・なぜ」
- 画面で編集して保存できる。「AI下書きです」の注意書きは印刷に出さない
- 文章の生成に失敗しても集計は保存され、「文章を作り直す」で再試行できる

## 状態

- `draft` → `reviewed` → `sent`。`sent` は再生成・文章変更ができない（戻す場合は「レビュー済に戻す」）
- 自動生成は既存のレポートがある月には触らない（人の編集・状態を上書きしない）

## 印刷

`client/src/index.css` の `@media print`: A4・余白 14mm、表・カードは `break-inside: avoid`、文章パートは `break-before: page`、KPIカードの背景色は `print-color-adjust: exact`。ナビ・ツールバー・編集欄は `print:hidden`。

## 安全策

- すべて `accountProcedure`。集計・目標・レポートはアカウント単位
- 目標値の保存は管理者のみ
- トークン・API レスポンス本文・投稿全文はレスポンスにもログにも出さない（失敗は種別だけ）
- 既存の `analytics` ルーター・分析取得の挙動は変えていない（取得対象期間の拡張と quotes/shares の追加のみ）
