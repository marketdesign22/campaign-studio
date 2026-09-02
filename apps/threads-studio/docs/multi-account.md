# マルチアカウント運用と、既存データの移行手順

Threads Studio は複数のThreadsアカウントを1つの環境で運用できます。
画面左上の切り替えUIで選んだアカウントが、ダッシュボード・原稿・カレンダー・
履歴・分析・月次レポート・設定のすべてのデータ範囲になります。

このドキュメントは、**すでに運用中のDBに対して安全にこの機能を有効化する手順**をまとめたものです。

---

## 1. 分離のしくみ

### どこで絞り込んでいるか

画面側では絞っていません。サーバー側の3層で担保しています。

| 層 | 実装 | 役割 |
|---|---|---|
| リクエスト検証 | `server/accountScope.ts` | `x-account-id` ヘッダの値を検証し、実在かつ有効なアカウントだけを通す。クライアントの申告は信用しない |
| クエリ | `server/db.ts` の `ownedBy()` | `posts` / `post_logs` を引く全クエリに `accountId` 条件を必ず付ける |
| 書き込み | 各ルーターの `requireOwnedPost()` / `filterOwnedPostIds()` | 更新・削除の前に所有を確認する。他アカウントのIDを渡すと `NOT_FOUND` |

バックグラウンドの予約投稿（`server/scheduler.ts`）は、
**UIの選択状態を一切参照しません**。`runTick` がアカウントを1件ずつ回し、
そのアカウント自身のスコープとトークンで投稿します。

### `accountId` が未設定の旧データの扱い

マルチアカウント化より前に作られた原稿・履歴は `accountId` が `NULL` のままです。
これらは **最初に作られたアカウント（＝IDが最小のアカウント）のもの** として読み出されます
（`AccountScope.includeLegacy`）。

- 2番目以降のアカウント（`creaw.usa` など）からは **一切見えません**
- **DBは書き換えていません。** 読み出し時の解釈だけで実現しています

この状態のままでも運用できますが、最古アカウントを削除すると解釈の基準がずれます。
下記の backfill で `accountId` を確定させることを推奨します。

---

## 2. 移行手順

> **前提**: `DATABASE_URL` を本番DBに向けた環境で実行します。
> 手順4までは一切書き込みません。

### 手順1: 現在の件数を記録する（読み取り専用）

```bash
pnpm db:counts > before.txt
cat before.txt
```

テーブル別の総件数、アカウント別の件数、`accountId` 未設定の件数が出ます。
**この出力を必ず保存してください。** 適用後の突き合わせに使います。

### 手順2: バックアップを作成し、復元できることを確認する

一次バックアップは `mysqldump` を推奨します。

```bash
mysqldump --single-transaction --set-gtid-purged=OFF \
  -h <host> -P 4000 -u <user> -p <database> > backup-$(date -u +%Y%m%dT%H%M%SZ).sql
```

`mysqldump` が使えない環境では JSON エクスポートを使います。

```bash
pnpm db:export           # backups/threads-studio-<UTC時刻>.json に保存
```

**復元できることの確認**（本番とは別のDBに向けて実行してください）:

```bash
DATABASE_URL=<検証用DBのURL> pnpm db:import -- --file backups/<ファイル名>.json --confirm-restore
DATABASE_URL=<検証用DBのURL> pnpm db:counts    # 手順1と同じ件数になることを確認
```

### 手順3: スキーマを更新する（追加のみ）

```bash
pnpm db:upgrade
```

`server/scripts/upgradeDb.ts` は information_schema を見て
**足りないものだけ**を追加します。何度実行しても同じ結果になります。
既存の列・行・値は一切変更しません。

追加されるもの:

| 対象 | 内容 |
|---|---|
| `account_settings`（新規テーブル） | アカウントごとの運用ルール・ブランド設定 |
| `categories.accountId`（新規列・NULL可） | カテゴリーの所属。`NULL` = 従来からある共通カテゴリー |
| `account_settings` の初期行 | 既存アカウントごとに1行。**現在のグローバル `settings` の値をコピー**するので、挙動は今のまま変わりません |
| 索引5件 | `posts(accountId)`, `posts(accountId, scheduledDate)`, `post_logs(accountId, postedAt)`, `post_analytics(postLogId)`, `categories(accountId)` |

### 手順4: 旧データの所属を確認する（読み取り専用）

```bash
pnpm db:counts
```

`accountId` 未設定の件数と、判断材料になる `post_logs` の先頭5件が出ます。
`threadsPostId` を Threads 側の実際の投稿と照合すれば、どのアカウントの投稿か確認できます。

**所属が確認できない行がある場合は、次の手順に進まないでください。**
未設定のままでも最古アカウントから正しく見えており、他アカウントには漏れません。

### 手順5: 所属を確定させる（唯一の書き込み手順）

```bash
pnpm db:backfill                            # 対象件数の確認のみ
pnpm db:backfill -- --account-id 1          # 移行先を指定して予行（まだ書かない）
pnpm db:backfill -- --account-id 1 --apply  # 実行
```

- 埋めるのは `accountId` 列だけです。本文・ID・日時・トークンは変更しません
- **すでに `accountId` が入っている行には触れません**（他アカウントへ混ざりません）
- `--apply` はトランザクションで実行し、途中で失敗したら全部戻します
- 移行先は必ず `--account-id` で人間が指定します。スクリプトが推測することはありません

### 手順6: 件数を突き合わせる

```bash
pnpm db:counts > after.txt
diff before.txt after.txt
```

期待される差分は「`accountId` 未設定の件数が0になり、その分が指定アカウントの件数に移る」ことだけです。
**総件数は1件も変わりません。**

---

## 3. ロールバック手順

### 手順5（backfill）だけを取り消す

`accountId` を `NULL` に戻します。移行先に指定したアカウントIDを使ってください。

```sql
-- 移行前から accountId が入っていた行まで NULL にしないよう、
-- 移行対象だった行だけを戻すには backfill 直前のバックアップから復元するのが確実です。
```

backfill 前のバックアップから復元するのが最も安全です:

```bash
pnpm db:import -- --file backups/<backfill直前のファイル>.json --confirm-restore
pnpm db:counts   # before.txt と一致することを確認
```

### 手順3（スキーマ追加）を取り消す

追加した列とテーブルを落とします。**既存データには影響しません。**

```sql
DROP TABLE IF EXISTS `account_settings`;
ALTER TABLE `categories` DROP COLUMN `accountId`;
DROP INDEX `idx_posts_account` ON `posts`;
DROP INDEX `idx_posts_account_date` ON `posts`;
DROP INDEX `idx_post_logs_account` ON `post_logs`;
DROP INDEX `idx_post_analytics_log` ON `post_analytics`;
DROP INDEX `idx_categories_account` ON `categories`;
```

`posts.accountId` と `post_logs.accountId` は
**この改修より前から存在する列なので、落とさないでください。**

### アプリケーションを戻す

このコミットの1つ前にデプロイを戻せば、旧コードで動きます。
追加したテーブル・列は旧コードから参照されないため、残っていても無害です。

---

## 4. 手動での確認項目

自動テストでは環境が用意できない部分です。ステージングまたは本番適用直後に確認してください。

| # | 確認すること | 期待される結果 |
|---|---|---|
| 1 | 左上の切り替えで `SCSU.Japan` を選ぶ | 原稿・カレンダー・履歴・分析・レポートがSCSUのものだけ |
| 2 | `creaw.usa` に切り替える | 上記すべてが空、または creaw.usa のものだけ。SCSUの内容が1件も出ない |
| 3 | `creaw.usa` で原稿を1件追加し、SCSUに切り替える | 追加した原稿がSCSU側に出ない |
| 4 | 切り替えたままページを移動（ダッシュボード→分析→設定） | 選択が維持される |
| 5 | ブラウザを再読み込み | 選択が維持される |
| 6 | `creaw.usa` を選んだ状態で設定を開く | 表示されるスケジュール・運用ルールが creaw.usa のもの |
| 7 | `creaw.usa` で「今すぐ投稿」 | creaw.usa 側のThreadsに投稿される。履歴も creaw.usa に記録される |
| 8 | ブラウザの開発者ツールでレスポンスを確認 | `threadsAccessToken` がどのレスポンスにも含まれない |
| 9 | `localStorage` の `selected-account-id` を存在しない値（例 `999`）に書き換えて再読み込み | APIが拒否し、既定アカウントに戻る。他アカウントのデータは表示されない |
| 10 | 移行前の `pnpm db:counts` と移行後を比較 | 総件数が一致 |

---

## 5. この改修で対応していないこと

- **外部キー制約は追加していません。** `posts.accountId` に FK を張ると、
  アカウント削除時に既存の原稿・履歴が消えるか `NULL` に戻ってしまいます
  （`NULL` に戻ると最古アカウントの旧データとして再解釈され、かえって混ざります）。
  代わりに索引を張り、所有チェックはアプリケーション層（`requireOwnedPost` など）で行っています。
- **`post_analytics` に `accountId` 列は追加していません。**
  分析行は `post_logs` と1対1で、アカウントは `post_logs.accountId` から一意に決まります。
  列を複製すると両者がずれる余地が生まれるため、`postLogId` で結合して絞り込んでいます
  （`postLogId` に索引を追加済み）。
- **`post_analytics` に `postLogId` のユニーク制約はありません。**
  日次取得のたびに行が増える構造のため、既存データに重複がある可能性があります。
  制約を後付けすると重複行があった場合に失敗するので、追加していません。
  代わりに集計側で「同じ `postLogId` は最新の1件だけ採用する」よう修正済みです
  （`analyticsByLogId`）。重複行そのものの整理は別途判断してください。
