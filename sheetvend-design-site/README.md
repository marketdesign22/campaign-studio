# SheetVendマーケットデザイン — LP

SheetVendマーケットデザイン(運営: SheetVend LLC)のランディングページです。純粋な静的サイト(HTML/CSS/JS のみ)なので、ビルド不要でそのまま Vercel にデプロイできます。

## ディレクトリ構成

```
sheetvend-design-site/
├── index.html          # メインページ
├── vercel.json          # Vercel 静的サイト設定
├── README.md
└── assets/
    ├── style.css
    ├── script.js
    ├── favicon.svg
    ├── og-image.png     # SNSシェア用 OGP 画像 (1200x630)
    └── og-source.html   # OGP画像の生成元(スクリーンショット用ソース)
```

## ローカルで確認する

ビルド不要なので、任意の静的サーバーで開けます。

```bash
cd sheetvend-design-site
npx serve .
# もしくは
python3 -m http.server 8080
```

## Vercel CLI で1コマンドデプロイ

### 1. 初回のみ: Vercel CLI をインストール & ログイン

```bash
npm i -g vercel
vercel login
```

### 2. デプロイ

`sheetvend-design-site` フォルダの直下で実行してください。

```bash
cd sheetvend-design-site
vercel --prod
```

初回実行時はプロジェクト名などを聞かれるので、質問に答えると数十秒で本番URL(`https://xxxxx.vercel.app`)が発行されます。2回目以降は同じコマンド1つで再デプロイできます。

> プレビュー環境だけ確認したい場合は `--prod` を外して `vercel` だけ実行してください。

## 更新方法(再デプロイの手順)

1. `index.html` や `assets/` 内のファイルを編集する
2. 変更をローカルで確認する(上記の「ローカルで確認する」を参照)
3. `sheetvend-design-site` フォルダ直下で `vercel --prod` を実行する

これだけで最新の内容が本番URLに反映されます。Git連携している場合は、対象ブランチに push するだけでも自動デプロイされます。

## OGP画像を作り直す場合

`assets/og-source.html` が OGP画像(`assets/og-image.png`)の生成元です。デザインを変更したい場合はこのファイルを編集し、ヘッドレスブラウザで 1200x630 のスクリーンショットを撮って `assets/og-image.png` を上書きしてください(Playwright / Puppeteer 等で `viewport: {width:1200, height:630}` を指定してスクリーンショット)。

## お問い合わせ

- LINE: https://lin.ee/soWHL7L
- メール: sheetvend@gmail.com
