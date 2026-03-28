# Marketing Team — Multi-Agent Workflow

このリポジトリはマーケティングチームの複数エージェントが協調して動作する仕組みを定義します。

## エージェント構成

以下の順序でエージェントを実行してください。各エージェントは前のエージェントのアウトプットを参照できます。

---

### Agent 1: リサーチャー (Researcher)

**役割**: 市場調査・競合分析

**タスク**:
- `tasks/brief.md` のクライアント情報を読む
- ターゲット市場・競合・トレンドを分析する
- 調査結果をまとめる

**アウトプット**: `tasks/output/01_research.md`

---

### Agent 2: ストラテジスト (Strategist)

**役割**: ブランド戦略・ポジショニング

**タスク**:
- `tasks/brief.md` と `tasks/output/01_research.md` を読む
- ブランドポジショニング・差別化ポイントを定義する
- ターゲットペルソナを策定する
- メッセージングフレームワークを作成する

**アウトプット**: `tasks/output/02_strategy.md`

---

### Agent 3: コピーライター (Copywriter)

**役割**: コピー・コンテンツ作成

**タスク**:
- `tasks/brief.md`、`tasks/output/02_strategy.md` を読む
- ヘッドライン・キャッチコピー（5案）を作成する
- LPのメインコピー（ヒーローセクション）を作成する
- メールの件名・本文（3パターン）を作成する

**アウトプット**: `tasks/output/03_copy.md`

---

### Agent 4: ソーシャルメディアマネージャー (Social Media Manager)

**役割**: SNS投稿コンテンツ作成

**タスク**:
- `tasks/brief.md`、`tasks/output/02_strategy.md`、`tasks/output/03_copy.md` を読む
- Twitter/X 投稿（5件）を作成する
- Instagram キャプション（3件）を作成する
- LinkedIn 投稿（2件）を作成する

**アウトプット**: `tasks/output/04_social.md`

---

### Agent 5: レビュアー (Reviewer)

**役割**: 全アウトプットのレビュー・改善提案

**タスク**:
- `tasks/brief.md` と `tasks/output/` 内の全ファイルを読む
- ブランドボイスの一貫性をチェックする
- 改善点・修正提案をまとめる
- エグゼクティブサマリーを作成する

**アウトプット**: `tasks/output/05_review.md`

---

## 実行方法

```
@tasks/brief.md を読んで、@CLAUDE.md のワークフローに従って全エージェントを動かして。アウトプットは tasks/output/ に保存して。
```

## ディレクトリ構成

```
marketing-team/
├── CLAUDE.md                  # このファイル（ワークフロー定義）
├── setup.sh                   # 初期セットアップスクリプト
└── tasks/
    ├── brief_template.md      # ブリーフテンプレート
    ├── brief.md               # クライアントブリーフ（要編集）
    └── output/
        ├── 01_research.md
        ├── 02_strategy.md
        ├── 03_copy.md
        ├── 04_social.md
        └── 05_review.md
```
