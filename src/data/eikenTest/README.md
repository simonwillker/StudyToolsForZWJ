# 英検 模擬テスト 問題データベース（5級〜1級）

`5.json` / `4.json` / `3.json` / `pre2.json`（準2級） / `2.json` / `pre1.json`（準1級） / `1.json` が、
**英検マスターの「模擬テスト」モード**（`src/EikenTest.jsx`）の出題データです。1ファイルが1つの級の「1回分の一次試験」に対応します。

分野別ドリル（`src/data/eikenApp/*.json`）とは別のデータです。こちらは **過去問（一次試験）の大問構成をそのまま再現した通し受験用** で、
- 解答中は正誤を表示しない（提出後にまとめて採点）
- 筆記 → リスニングの順に、本番と同じ制限時間で進む
- リスニングは放送回数が制限される（3級以下は2回、準2級以上は1回）

という本番同様の進行になります。**コードを触らず、このJSONに追記するだけで問題を増やせます。**

## 問題を追加したら必ず検証する

```bash
node scripts/validateEikenTest.mjs
```

スキーマ違反（`correct: true` が2つある、語句整序の答えが並べかえで作れない、空所番号が本文にない、IDの重複 等）を検出します。
エラーが1件でもあれば終了コード1で止まります。

## ファイル全体のスキーマ

```json
{
  "level": "3",
  "levelLabel": "3級",
  "levelSub": "中学卒業程度",
  "color": "#8A6D2F",
  "exam": {
    "title": "3級 一次試験 模擬テスト",
    "note": "画面上部に表示する説明文",
    "writtenMinutes": 50,
    "listeningMinutes": 26,
    "passRate": 0.6
  },
  "sections": [ ... ]
}
```

| フィールド | 必須 | 説明 |
|---|---|---|
| `level` | ○ | 級の内部ID。`"5"` `"4"` `"3"` `"pre2"` `"2"` `"pre1"` `"1"`。**ファイル名と一致させる**。 |
| `levelLabel` / `levelSub` / `color` | ○ | 表示名・サブタイトル・アクセントカラー（`eikenApp/*.json` と同じ値にそろえる）。 |
| `exam.writtenMinutes` | ○ | 筆記試験の制限時間（分）。本番モードのカウントダウンに使う。 |
| `exam.listeningMinutes` | ○ | リスニングの制限時間（分）。 |
| `exam.passRate` | ○ | 合格の目安となる正答率（0〜1）。結果画面の合否めやすに使う。 |

## sections（大問）

すべての大問に共通のフィールド：

| フィールド | 必須 | 説明 |
|---|---|---|
| `id` | ○ | 大問の一意なID（例：`"3-p1"`）。 |
| `phase` | ○ | `"written"`（筆記）または `"listening"`（リスニング）。**この順に並べる**。 |
| `part` | ○ | 画面に出す大問名（例：`"筆記 1"` `"リスニング 第2部"`）。 |
| `title` | ○ | 形式名（例：`"短文の語句空所補充"`）。 |
| `type` | ○ | `gapfill` / `dialogue` / `ordering` / `cloze` / `reading` / `listening` / `writing` のいずれか。 |
| `officialCount` | ○ | **本番の問題数**。収録数と併記され、「本番 15問」のように表示される。収録が少なくても本番の規模が分かるようにするための値。 |
| `instruction` | ○ | 本番の問題冊子に近い指示文。 |

### type: gapfill（短文の語句空所補充）

```json
{ "id": "3-p1-01", "sentence": "I have lived here （　） I was five.", "ja": "訳", "point": "文法・語法のポイント",
  "choices": [ { "text": "since", "correct": true, "explain": "…" }, ... ] }
```

`choices` は4択、`correct: true` はちょうど1つ。**全選択肢に `explain` を書く**（復習画面で全部表示するため）。

### type: dialogue（会話文の文空所補充）

```json
{ "id": "3-p2-01", "title": "レストランで", "translation": "会話全体の訳",
  "lines": [ { "speaker": "A", "text": "…" }, { "speaker": "B", "text": "＿＿＿" } ],
  "blankIndex": 1,
  "choices": [ ... ] }
```

`blankIndex` は空所にする発言の配列インデックス（0始まり）。空所の `text` は画面に出ないのでダミーで構いません。

### type: ordering（日本文つき語句整序）

```json
{ "id": "3-p3-01", "ja": "彼女が書いたその手紙は私を幸せにしました。",
  "chunks": ["made", "The letter", "she wrote", "me", "happy"],
  "sentence": "The letter she wrote made me happy.",
  "explain": "語順の解説" }
```

- `chunks` は画面に出す語句（バラバラの順で書く）。受験者はタップして並べます。
- `sentence` は**正解の英文**。採点は「並べた `chunks` を空白でつないだ文」と `sentence` を、大文字小文字・句読点を無視して比較します。
- したがって **`chunks` を正しく並べると `sentence` と完全に同じ語の並びになる**必要があります。検証スクリプトがこれをチェックします。

### type: cloze（長文の語句空所補充）／ type: reading（長文の内容一致選択）

どちらも `passages` の配列を持ちます。

```json
"passages": [
  { "id": "3-p4-a", "format": "Eメール", "title": "Volunteer Day",
    "passage": "本文。cloze の場合は空所を ( 1 ) ( 2 ) のように書く",
    "translation": "本文の訳",
    "questions": [ ... ] }
]
```

- `reading` の設問：`{ "id": "...", "q": "設問文", "choices": [ ... ] }`
- `cloze` の設問：`{ "id": "...", "blank": 1, "choices": [ ... ] }` — `blank` の番号は**本文中の `( 1 )` と一致**させること（検証スクリプトがチェックします）。解答中は該当の空所がハイライトされます。
- `format` は本文の上に出る種別バッジ（`掲示` / `Eメール` / `説明文` など）。
- 1つのパッセージの設問はそれぞれ独立した1問として採点されます。

### type: listening（リスニング）

大問側に次のフィールドを追加できます。

| フィールド | 説明 |
|---|---|
| `listeningStyle` | `response`（応答文選択）/ `conversation` / `passage` / `reallife` / `interview`。`response` のときだけ設問文（`question`）が不要になります。 |
| `playLimit` | **本番モードでの放送回数**。3級以下は `2`、準2級以上は `1`。練習モードでは無制限になります。 |
| `choicesAudioOnly` | `true` にすると、本番モードで選択肢の文字を隠し、放送で読み上げます（第1部の再現）。練習モードでは表示されます。 |

```json
{ "id": "3-l2-01",
  "script": [ { "speaker": "A", "text": "…" }, { "speaker": "B", "text": "…" } ],
  "question": "What will Nancy do next?",
  "translation": "会話と質問の訳",
  "choices": [ ... ] }
```

- `script` は配列（会話）でも文字列（1人が読む英文）でもかまいません。配列のときは話者ごとに声の高さを変えて順番に読み上げます。
- 音声はブラウザ標準の読み上げ（Web Speech API）で生成します。**音声ファイルは不要です。**
- `script` と `translation` は解答中は表示されず、提出後の復習画面で表示されます。
- RealLife形式（`reallife`）は、`question` に「状況：…　質問：…」の形で状況説明を書きます。

### type: writing（ライティング）

`questions` ではなく `prompts` の配列を持ちます。自動採点の対象外で、提出後に解答例とチェックリストで自己採点します。

```json
{ "id": "3-p5-02", "styleLabel": "意見論述問題",
  "instruction": "指示文", "topic": "QUESTION本文",
  "conditions": ["語数の目安は25〜35語", "…"],
  "wordCount": "25〜35語",
  "modelAnswer": "解答例の英文", "modelTranslation": "解答例の訳",
  "checklist": ["観点1", "観点2"], "points": 16 }
```

入力欄には語数カウンターがつきます。

## 問題を追加する手順

1. 対象の級のJSONを開き、該当の大問の `questions`（または `passages` / `prompts`）に追記する
2. `id` は既存の連番の続きにする（**全ファイル通しで重複しないこと**）
3. `node scripts/validateEikenTest.mjs` を実行し、エラーが0件になることを確認する
4. コミット・プッシュする

本番と同じ問題数にしたい場合は、各大問の `officialCount` まで問題を足していけば、そのまま完全な模試になります。コードの変更は不要です。
