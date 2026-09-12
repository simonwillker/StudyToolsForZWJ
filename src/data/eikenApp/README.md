# 英検マスター 問題データベース

`5.json` / `4.json` / `3.json` / `pre2.json`（準2級） / `2.json` / `pre1.json`（準1級） / `1.json` が、
英検マスターアプリ（`src/EikenApp.jsx`）の出題データです。各ファイル1つが1つの級に対応します。

コード（`EikenApp.jsx`）とは分離してあるので、**コードを触らずにこれらのJSONファイルへ問題を追加していくだけで、出題内容を増やせます。**

## ファイル全体のスキーマ

```json
{
  "level": "2",
  "levelLabel": "2級",
  "levelSub": "高校卒業程度",
  "color": "#8A3B2F",
  "vocab": [ ... ],
  "grammar": [ ... ],
  "reading": [ ... ],
  "listening": [ ... ],
  "dialogue": [ ... ]
}
```

| フィールド | 必須 | 説明 |
|---|---|---|
| `level` | ○ | 級を表す内部ID。`"5"` `"4"` `"3"` `"pre2"`（準2級） `"2"` `"pre1"`（準1級） `"1"` のいずれか。ファイル名と一致させる。 |
| `levelLabel` | ○ | 画面に表示する級名（例："2級"）。 |
| `levelSub` | ○ | 級のサブタイトル（例："高校卒業程度"）。 |
| `color` | ○ | その級のアクセントカラー（HEX）。 |
| `vocab` | ○ | 単語・熟語クイズの語彙リスト（配列）。 |
| `grammar` | ○ | 文法・穴うめ問題のリスト（配列）。 |
| `reading` | ○ | 長文読解パッセージのリスト（配列）。 |
| `listening` | ○ | リスニング問題のリスト（配列）。 |
| `dialogue` | ○ | 会話文（穴うめ）問題のリスト（配列）。 |

## vocab（単語・熟語）

```json
{
  "id": "v2-01",
  "word": "allocate",
  "phonetic": "ˈæləkeɪt",
  "pos": "動詞",
  "meaning": "割り当てる",
  "example": { "en": "The city allocated more funds to education this year.", "ja": "市は今年、教育により多くの資金を割り当てました。" }
}
```

- `id`：一意なID（例：`v2-01`）。他の項目と重複しないこと。
- アプリ側が同じ級の他の単語からランダムに3つ選び、誤答の選択肢を自動生成する。単語数が多いほど誤答のバリエーションが増える。
- `example` は正解・不正解にかかわらず回答後に必ず表示される（発音ボタンつき）。

## grammar（文法・穴うめ）

```json
{
  "id": "g2-01",
  "sentence": "___ she known about the traffic, she would have left earlier.",
  "ja": "もし彼女が渋滞について知っていたら、もっと早く出発していただろう。",
  "point": "仮定法過去完了の倒置（If she had known → Had she known）",
  "choices": [
    { "text": "Had", "correct": true, "explain": "..." },
    { "text": "Did", "correct": false, "explain": "..." },
    { "text": "Has", "correct": false, "explain": "..." },
    { "text": "Should", "correct": false, "explain": "..." }
  ]
}
```

- `choices` は必ず4択、`correct: true` を1つだけ含める。
- 各選択肢に `explain` を必ずつける（正解・不正解に関係なく全選択肢の解説を表示するため）。
- `point`（文法解説）と `ja`（全文訳）は回答後にまとめて表示される。

## reading（長文読解）

```json
{
  "id": "r2-01",
  "title": "The Rise of Automation",
  "passage": "Automation has transformed many industries...",
  "questions": [
    {
      "id": "r2-01-q1",
      "q": "What has automation done in factories?",
      "choices": [ { "text": "...", "correct": true, "explain": "..." }, ... ]
    }
  ]
}
```

- 1つのパッセージに複数の設問（`questions`）を持たせられる。各設問はそれぞれ独立した1問としてカウント・記録される。
- パッセージ本文は各設問の画面で毎回表示され、読み上げボタンがついている。

## listening（リスニング）

```json
{
  "id": "l2-01",
  "script": "Despite the heavy rain, the outdoor concert went ahead as scheduled...",
  "translation": "激しい雨にもかかわらず...",
  "question": "What happened to the concert despite the rain?",
  "choices": [ { "text": "...", "correct": true, "explain": "..." }, ... ]
}
```

- `script` はブラウザ標準の読み上げ（Web Speech API）で再生される。外部音声ファイルは不要。
- `script` と `translation` は回答前は隠され、回答後に解説と一緒に表示される。

## dialogue（会話文）

```json
{
  "id": "d2-01",
  "title": "Business Negotiation",
  "translation": "A：御社の提案を拝見しましたが...",
  "lines": [
    { "speaker": "A", "text": "..." },
    { "speaker": "B", "text": "..." },
    { "speaker": "A", "text": "___" },
    { "speaker": "B", "text": "..." }
  ],
  "blankIndex": 2,
  "choices": [ { "text": "...", "correct": true, "explain": "..." }, ... ]
}
```

- `lines` は会話の各発言。`blankIndex` は空所にする発言の配列インデックス（0始まり）。空所の `text` はダミーで構わない（画面には表示されない）。
- 「▶ 会話をとおして再生する」ボタンは、回答前は空所をスキップし、回答後は正解の発言を差し込んで通しで再生する（先読み防止のため）。

## 問題を追加する方法

1. 対象の級のJSONファイルを開く
2. 該当するカテゴリ（`vocab` / `grammar` / `reading` / `listening` / `dialogue`）の配列に、上記スキーマに沿った新しいオブジェクトを追加する
3. `id` は既存の連番の続きにする（他と重複しないこと）
4. 保存してコミット・プッシュする

コードの変更は一切不要です。アプリは起動時にこれらのJSONを読み込み、出題プールを自動的に再計算します。
