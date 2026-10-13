# Sapix 問題データ（学年 → 科目 → 単元）

`src/SapixApp.jsx` が使う問題データです。フォルダの形がそのまま画面の「学年 → 科目 → 単元」になります。

```
src/data/sapix/
└── g<学年>/            ← g1〜g6
    └── <科目>/         ← math（算数）/ kokugo（国語）/ rika（理科）/ shakai（社会）/ eigo（英語）
        ├── meta.json   ← grade・subject・分類（色）・単元の一覧
        ├── README.md   ← その科目のスキーマ
        └── <単元id>.json
```

いまあるのは `g4/` の 5 科目です。

## 学年・科目を足す

1. `g<学年>/<科目>/` を作り、`g4/` の同じ科目の `meta.json`・単元 JSON・`README.md` をまねて置く。
   - `meta.json` の `grade`（数）と `subject`（科目の ID）はフォルダ名と同じにする。
   - `eyebrow`（見出しの上の小さな英字）・`lead`（単元一覧の説明）・`target`（「小学5年 夏期講習相当」など）は画面に出る。なくてもよい。
   - 問題の `id` は全学年をまたいで重ならないようにする（例：5年の算数は `sm5-…`）。国語・社会・理科・英語は科目の頭文字（`sk-` / `ss-` / `sr-` / `se-`）で始める。
2. `npm run validate` を通す（算数は全問を検算、ほかの科目は形と整合性、フォルダ名と `grade`/`subject` の食いちがいも見る）。
3. コードの変更はいらない。`meta.json` を置いた学年・科目が自動で画面に出る。

学習記録のキーは `src/sapixStorage.js` が決める（4年は以前からの `sapixMathProgressV1` など、ほかは `sapixG5MathProgressV1` など）。
4年のキーは変えないこと。変えるとこれまでの記録とバックアップが読めなくなる。
