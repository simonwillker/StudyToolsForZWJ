# きょうのドリル（Daily Drill）

小学生向けの日常学習ドリル用 React コンポーネントです。もともと Claude.ai の Artifacts（アーティファクト）機能上で作成・反復改良してきたものを、GitHub で管理できる形にパッケージしました。

## 収録コンテンツ

- **算数**：学年（小3〜6）・問題類型（計算／文章題・図形）・問題数（20/35/50問）を選んで計算ドリルを自動生成
- **理科 / 社会**：学年（小3〜6）・問題数（20/35/50問）を選べる4択形式
- **国語**：一問一答形式（学年タグ付き）
- **英語**：英検2級レベルの語彙・文法4択
- **英検2級 単語テスト**：400語を20語ずつ、好きな範囲でテスト
- **カスタム単語テスト**：自分で入力した英単語（最大35語）で「意味を入力／英語を書く／聞き取り／穴うめ英作文」の4形式
- **カスタム漢字テスト**：自分で入力した漢字・言葉（最大35語）で「読み方／書き取り／穴うめ作文」の3形式
- 出題ローテーション（直近のテストに出た問題をなるべく避ける仕組み）

## ⚠️ 重要：Claude Artifacts 専用APIについて

このコンポーネントは、Claude.ai の Artifacts 実行環境でのみ動作する2つのブラウザAPIを使っています。**GitHub Pages やご自身のサーバーなど、Claude.ai の外で動かす場合は、以下の対応が必要です。**

### 1. `window.storage`（出題履歴の永続化）

各教科の「直近に出た問題」を記録するために使っています。Claude Artifacts 環境では自動的に使えますが、通常のブラウザには存在しません。

- **対応方法**：`window.storage.get / set` の呼び出し箇所（`loadRecency` / `saveRecency` 関数）を `localStorage` や、ご自身のバックエンドAPIに置き換えてください。
- 呼び出しはすべて `try/catch` で保護されているため、置き換えないまま動かしても**エラーにはならず**、出題ローテーション機能だけが無効になります（毎回ランダム出題になります）。

### 2. Anthropic API 呼び出し（カスタム単語・漢字テストのAI生成）

「意味を入力」「穴うめ」「カスタム漢字」テストで、単語の意味・読み・例文をAIに生成させるために、`fetch("https://api.anthropic.com/v1/messages", ...)` を**APIキーなしで**呼び出しています。これは Claude Artifacts 環境がリクエストを自動的に認証・プロキシしてくれる特別な仕組みです。

- **対応方法**：このコードをそのまま外部でホストすると、CORSやAPIキー未設定でこの呼び出しは失敗します。ご自身のサーバー（Node.jsなど）に、Anthropic API キーを使ったプロキシエンドポイントを立て、`fetchWordData` / `fetchKanjiData` 関数の fetch 先をそちらに向けてください。
- こちらも `try/catch` で保護されているため、失敗時は画面にエラーメッセージが表示されるだけで、アプリ全体がクラッシュすることはありません。
- 「聞き取り（ディクテーション）」モードはブラウザ標準の `SpeechSynthesis` API のみを使うため、この制約を受けません。

### 一番かんたんな使い方

上記の理由から、**このコードを一番手軽に動かせるのは、これまで通り Claude.ai の Artifacts（`src/DailyDrill.jsx` の中身をそのまま貼り付け）です。** GitHubはコードのバージョン管理・共有用として使い、実行は引き続き Claude.ai 上で行う、という運用もおすすめです。

### ⚠️ GitHub版とArtifacts版でデータの持ち方が違います

このリポジトリ版（`src/DailyDrill.jsx`）は、理科・社会・国語・英語・英検単語の問題を `src/data/*.json` から読み込む構成になっています（問題を増やしやすくするため。算数のみ数式生成のためJSON化の対象外）。一方、Claude.ai Artifactsにそのまま貼り付けて使う単一ファイル版は、複数ファイルの読み込みに対応していないため、**問題データを引き続きファイル内に直接書いた状態**です。両者は現時点で内容が同期していない場合があるので、混同しないよう注意してください。

## ローカルで動かす（プレビュー用）

```bash
npm install
npm run dev
```

`window.storage` と Anthropic API 呼び出し以外の画面・ロジックはこれで確認できます（出題ローテーションとAI生成機能を除く）。

## ビルド

```bash
npm run build
```

`dist/` に静的ファイルが出力されます。

## GitHubへの登録

このフォルダで以下を実行してください（GitHub上に空のリポジトリを先に作成しておく必要があります）。

```bash
cd daily-drill
git init
git add .
git commit -m "Initial commit: daily drill app"
git branch -M main
git remote add origin https://github.com/<あなたのユーザー名>/<リポジトリ名>.git
git push -u origin main
```

Claude Code を使う場合は、このフォルダで `claude` を起動し、「このプロジェクトをGitHubリポジトリとして初期化してpushして」のように自然言語で頼むこともできます。

## ディレクトリ構成

```
daily-drill/
├── index.html
├── package.json
├── vite.config.js
├── tailwind.config.js
├── postcss.config.js
├── .gitignore
└── src/
    ├── main.jsx
    ├── index.css
    ├── DailyDrill.jsx   ← 本体コンポーネント
    └── data/
        ├── rika.json    ← 理科の問題データベース
        ├── shakai.json  ← 社会の問題データベース
        ├── kokugo.json  ← 国語の問題データベース
        ├── eigo.json    ← 英語（英検2級レベル）の問題データベース
        ├── eiken.json   ← 英検2級 単語テストの単語データベース
        └── README.md    ← 問題を追加する手順・スキーマの説明
```

算数以外の問題は `src/data/*.json` に分離されています。**問題を増やしたいときは、コードを変更せずこれらのJSONファイルに追記するだけ**で反映されます。詳しくは `src/data/README.md` を参照してください。

## GitHub Pagesで公開する

`main` ブランチにpushすると、GitHub Actions（`.github/workflows/deploy.yml`）が自動的にビルドしてGitHub Pagesに公開します。iPad・iPhone・PCなど、どの端末のブラウザからも公開URLでアクセスできます。

- 公開URL：`https://simonwillker.github.io/StudyToolsForZWJ/`
- **初回のみ**、リポジトリの `Settings → Pages → Build and deployment → Source` を「**GitHub Actions**」に設定してください（この設定はGitHub上のWeb画面から行う必要があります）。
- 以降は `main` にpushするたびに自動で再デプロイされます（Actionsタブでビルド状況を確認できます）。
- ローカルのVite設定（`vite.config.js`）には、GitHub Pagesのプロジェクトページ用に `base: "/StudyToolsForZWJ/"` を設定済みです。リポジトリ名を変更した場合はここも合わせて変更してください。
