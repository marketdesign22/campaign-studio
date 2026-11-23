# Instagram 公開の受け取り口（Threads Studio 側）

大漁マーケットOS（司令塔）が承認済みの予約を Instagram に出すとき、
Threads Studio がその依頼を受け取り、Meta の Graph API へ中継する。
OS 側の設計と本番への出し方は、大漁マーケットのリポジトリの
`docs/instagram-publishing.md` にまとめてある。

> **現状：実投稿はしない。** Meta 側の権限確認が終わるまで
> `INSTAGRAM_PUBLISH_ENABLED` は設定しない。テストは Graph API をすべてモックしている。

## 入口

`POST /api/instagram/publish`（`Authorization: Bearer <INSTAGRAM_PUBLISH_WEBHOOK_SECRET>`）

| action | 何をするか | 応答 |
| --- | --- | --- |
| `publish`（既定） | 依頼を記録したら**すぐ**答え、コンテナ作成は応答のあとに進める。**ここでは公開しない** | 202 `{status:"accepted", publication_id, container_id}` / 公開済みなら 200 `{status:"published", id, url}` / 失敗で終わっていれば 422 |
| `publish` + `dry_run: true` | 検証だけ。Graph API を呼ばず、何も保存しない | 200 `{status:"dry_run", checks}` |
| `status` | `scheduled_post_ids` のそれぞれを一歩進め、結果を返す | 200 `{results:[{scheduled_post_id, state, id?, url?, error?}]}` |

`state` は `published` / `failed` / `in_progress`。知らない予約は返さない
（OS 側は「次の回で聞き直す」）。

## 流れ

```
OS dispatch ──publish──▶ queued ─(応答のあと)─▶ creating ──▶ processing
OS sync(5分ごと) ──status──▶ processing ──FINISHED──▶ publishing ──公開──▶ published
                                          └─ERROR/EXPIRED──▶ failed（公開していない）
```

- 背景のタイマーは使わない。進めるのは OS からの呼び出しだけ。
- 1依頼 = 1行（`instagram_publications`、主キーは OS の `scheduled_posts.id`）。
  `pnpm db:upgrade`（起動時に実行）が無ければ作る。既存テーブルは変えない。

## 無料プラン（スリープ）でも安全な理由

当面 Render は無料プランで動かす。15分アイドルでスリープし、起動に1分ほどかかる。

| 心配 | どうしているか |
| --- | --- |
| 起動待ちで OS の待ち時間（15秒）を使い切る | 依頼は記録した時点ですぐ答える。Graph API の呼び出しは応答のあと。OS が打ち切っても、届いた依頼は記録され、OS の再送には前回の結果を返す |
| 同じ予約を二重に処理する | 依頼は `scheduled_post_id` で一意。コンテナ作成は借用（`creating` + `leaseToken`）を持つ1つの呼び出しだけが進める。公開は `processing → publishing` の条件つき更新に勝った1つだけ |
| 途中で落ちる（再起動・スリープ） | 状態はすべて台帳にある。カルーセルの子コンテナは1枚ごとに記録し、借用が切れたあと（3分）次の呼び出しが続きの枚から作る。一時的な失敗は作れた枚を残して `queued` に戻す。公開の呼び出し中に落ちたものは自動でやり直さない（下） |
| 公開の依頼で公開してしまう | 公開は状態の問い合わせ（`status`）からだけ。`publish` は受付とコンテナ作成まで |

## 二重投稿を防ぐ仕組み

1. 同じ `scheduled_post_id` の再送は、前回の行をそのまま返す（コンテナを作り直さない）。
   中身（クライアント・キャプション・スライド番号）が違えば 409。
2. 公開の直前に `processing → publishing` を条件つきで書き換える。取り合いに負けたら何もしない。
3. 公開の呼び出しが失敗・応答なしのときは **failed にしない**（公開されたか分からないため）。
   次の問い合わせでコンテナの状態が `PUBLISHED` と確かめられたときだけ published にする。
   確かめられないものは自動で公開し直さない。OS 側で一定時間後に「要確認」へ移り、
   人が Instagram を見て判断する。
4. 公開前（コンテナ作成）の失敗だけは、OS からの再送で新しい素材URLを使ってやり直せる。

## 秘密値と素材URL

- 共有シークレット・アクセストークン・素材の署名URLは、ログ・応答・エラー文に出さない。
- 署名URLは、コンテナを作り終えた時点（または失敗で終わった時点）で台帳から消す。
- Graph API のエラー文は、HTTP ステータスとエラーコードだけにする
  （Meta のエラー文には入力値が含まれることがあるため）。
- アクセストークンは URL に載せない（POST は本文、GET は Authorization ヘッダー【要確認】）。

## 設定（Render の Environment）

| 変数 | 既定 | 説明 |
| --- | --- | --- |
| `INSTAGRAM_PUBLISH_ENABLED` | 未設定＝無効 | `"true"` のときだけ実際に公開する |
| `INSTAGRAM_PUBLISH_DRY_RUN` | 未設定 | `"true"` なら全依頼を検証だけにする |
| `INSTAGRAM_PUBLISH_WEBHOOK_SECRET` | 未設定＝受け取り口ごと閉じる | OS の `META_PUBLISH_WEBHOOK_SECRET` と同じ値 |
| `INSTAGRAM_CLIENT_ID` | 未設定＝全部 403 | 公開してよい OS の `clients.id`（第1段階は CREAW の1件） |
| `INSTAGRAM_IG_USER_ID` | — | Instagram プロアカウントの ID |
| `INSTAGRAM_ACCESS_TOKEN` | — | Graph API のアクセストークン（秘密） |
| `INSTAGRAM_GRAPH_API_BASE` | なし | `https://<host>/<version>`。【要確認】推測で既定値を置かない |

設定が足りないまま有効にしても、公開の依頼は 503（`missing` に変数名だけを返す）になり、
Graph API は呼ばない。

## 要確認（Meta 公式ドキュメントで確かめてから有効にする）

コードは下の前提で書いてある。違っていたら `server/instagram/graph.ts` と
`LIMITS`（`publisher.ts`）を直す。

- [ ] ログイン方式（Facebook ログイン経由／Instagram ログイン）と、それぞれの Graph API のホスト・バージョン
- [ ] 必要な権限名（コンテンツ公開・基本情報）と、クライアントのアカウントに使うときの App Review の要否。
      テスター役（アプリの役割）で試験できるか
- [ ] コンテナ作成：`POST /{ig-user-id}/media`（`image_url`, `caption`, `is_carousel_item`, `media_type=CAROUSEL`, `children`）
- [ ] 状態：`GET /{container-id}?fields=status_code` の値（`FINISHED` / `IN_PROGRESS` / `ERROR` / `EXPIRED` / `PUBLISHED`）
- [ ] 公開：`POST /{ig-user-id}/media_publish`（`creation_id`）
- [ ] パーマリンク：`GET /{media-id}?fields=permalink`
- [ ] GET で `Authorization: Bearer` が使えるか（使えなければ別の渡し方。URL には載せない）
- [ ] 上限：カルーセルの枚数・キャプション文字数・ハッシュタグ数・24時間あたりの公開数
- [ ] 画像の条件（形式・サイズ・縦横比）と、コンテナの有効期限
- [ ] 一時的なエラーの見分け方（`is_transient` など）

## テスト

`server/instagram/publisher.test.ts`（`pnpm test` に含まれる）。Graph API と DB はすべて偽物。
確かめていること：フラグ既定オフ／dry-run で何も呼ばない・保存しない／他クライアント 403／
再送で二重にしない／公開の失敗を failed にしない・自動で公開し直さない／
エラー文・応答に URL・トークンを含めない／Bearer 認証。
スリープ明け：すぐ受付を返し応答の時点では Graph API を呼ばない／OS が打ち切った依頼の再送で二重に作らない／
同時の依頼でコンテナを作るのは片方だけ／カルーセルの途中で落ちても続きの枚から作る／借用を失った呼び出しは書き進めない。
