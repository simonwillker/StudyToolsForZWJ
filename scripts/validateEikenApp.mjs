/* ============================================================
   英検マスター（分野別ドリル）データの検証スクリプト
   使い方：node scripts/validateEikenApp.mjs
   単語データを中心に、アプリが前提とする形をチェックする。
   ============================================================ */

import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "data", "eikenApp");
const UNIT_SIZE = 20;

const errors = [];
const warnings = [];
const allIds = new Set();
const wordLevels = new Map(); // word -> [levels]

function err(f, p, m) { errors.push(`${f} ${p}: ${m}`); }
function warn(f, p, m) { warnings.push(`${f} ${p}: ${m}`); }

const files = readdirSync(DIR).filter((f) => f.endsWith(".json")).sort();
const summary = [];

for (const file of files) {
  let d;
  try {
    d = JSON.parse(readFileSync(join(DIR, file), "utf8"));
  } catch (e) {
    errors.push(`${file}: JSONとして読めません — ${e.message}`);
    continue;
  }

  ["level", "levelLabel", "levelSub", "color", "vocab", "grammar", "reading", "listening", "dialogue"].forEach((k) => {
    if (!d[k]) err(file, "(root)", `${k} がありません`);
  });
  if (d.level && file !== `${d.level}.json`) err(file, "(root)", `level "${d.level}" とファイル名が一致しません`);

  const seenWord = new Map();
  (d.vocab || []).forEach((w, i) => {
    const p = `vocab[${i}]${w.word ? `(${w.word})` : ""}`;
    ["id", "word", "phonetic", "pos", "meaning"].forEach((k) => {
      if (!w[k] || !String(w[k]).trim()) err(file, p, `${k} が空です`);
    });
    if (!w.example || !w.example.en || !w.example.ja) {
      err(file, p, "example.en / example.ja が必要です");
    } else {
      // 例文に見出し語が入っているかを大まかに確認する。
      // 熟語（スペースを含む見出し語）は活用で形が変わるためチェックしない。
      const word = String(w.word).toLowerCase();
      if (!word.includes(" ")) {
        const stem = word.slice(0, Math.max(4, word.length - 3));
        if (stem.length >= 3 && !w.example.en.toLowerCase().includes(stem)) {
          warn(file, p, `例文に見出し語が見当たりません（例文: ${w.example.en}）`);
        }
      }
    }
    if (w.id) {
      if (allIds.has(w.id)) err(file, p, `id "${w.id}" が他と重複しています`);
      allIds.add(w.id);
    }
    const key = String(w.word || "").toLowerCase();
    if (key) {
      if (seenWord.has(key)) err(file, p, `同じ級に "${w.word}" が重複しています（${seenWord.get(key)}）`);
      else seenWord.set(key, w.id);
      if (!wordLevels.has(key)) wordLevels.set(key, []);
      wordLevels.get(key).push(d.level);
    }
  });

  // リスニングは英検の出題形式ごとに形が違う。形式に合わない問題を弾く。
  //   response = 会話の応答文選択（質問文なし・3択・会話スクリプト）
  //   dialogue = 会話の内容一致選択（質問文あり・4択・会話スクリプト）
  //   passage  = 文の内容一致選択（質問文あり・4択・1本の英文）
  //   reallife / interview = 準1級以上（質問文あり・4択・1本の英文）
  const LISTENING_FORMATS = {
    response: { question: false, choices: 3, script: "array" },
    dialogue: { question: true, choices: 4, script: "array" },
    passage: { question: true, choices: 4, script: "string" },
    reallife: { question: true, choices: 4, script: "string" },
    interview: { question: true, choices: 4, script: "array" },
  };
  (d.listening || []).forEach((l, i) => {
    const p2 = `listening[${i}](${l.id || "?"})`;
    const fmt = LISTENING_FORMATS[l.part];
    if (!fmt) {
      err(file, p2, `part が不正です（${l.part ?? "未設定"}）。${Object.keys(LISTENING_FORMATS).join(" / ")} のいずれかにしてください`);
      return;
    }
    const isArray = Array.isArray(l.script);
    if (fmt.script === "array" && !isArray) err(file, p2, `part=${l.part} のスクリプトは会話（配列）である必要があります`);
    if (fmt.script === "string" && isArray) err(file, p2, `part=${l.part} のスクリプトは1本の英文（文字列）である必要があります`);
    if (isArray) {
      l.script.forEach((line, j) => {
        if (!["A", "B", "N"].includes(line.speaker)) err(file, p2, `script[${j}] の speaker が不正です（${line.speaker}）`);
        if (!line.text || !String(line.text).trim()) err(file, p2, `script[${j}] のセリフが空です`);
      });
    } else if (!l.script || !String(l.script).trim()) {
      err(file, p2, "script が空です");
    }
    if (fmt.question && !l.question) err(file, p2, `part=${l.part} には question が必要です`);
    if (!fmt.question && l.question) err(file, p2, `part=${l.part}（応答文選択）に question は置きません`);
    if (!l.translation) err(file, p2, "translation がありません");
    const ch = l.choices || [];
    if (ch.length !== fmt.choices) err(file, p2, `part=${l.part} の選択肢は${fmt.choices}つです（現在${ch.length}つ）`);
    if (ch.filter((c) => c.correct).length !== 1) err(file, p2, "correct: true がちょうど1つではありません");
    if (new Set(ch.map((c) => c.text)).size !== ch.length) err(file, p2, "選択肢のテキストが重複しています");
    ch.forEach((c, j) => {
      if (!c.explain) err(file, p2, `choices[${j}] に explain がありません`);
    });
  });

  const n = (d.vocab || []).length;
  summary.push({
    級: d.levelLabel,
    単語: n,
    出題範囲: `${Math.ceil(n / UNIT_SIZE)}組`,
    文法: (d.grammar || []).length,
    読解: (d.reading || []).reduce((s, r) => s + r.questions.length, 0),
    リスニング: (d.listening || []).length,
    会話: (d.dialogue || []).length,
  });
}

// 級をまたいだ単語の重複（上位級と下位級で同じ単語を出すのは避ける）
const crossLevel = [...wordLevels.entries()].filter(([, lv]) => lv.length > 1);
crossLevel.forEach(([word, lv]) => warn("(全体)", word, `${lv.join(" / ")} に重複しています`));

console.log(`\n検証したファイル：${files.length}件\n`);
console.table(summary);
console.log(`単語の総数：${summary.reduce((s, r) => s + r.単語, 0)}語`);

if (warnings.length) {
  console.log(`\n⚠ 警告 ${warnings.length}件`);
  warnings.slice(0, 40).forEach((w) => console.log("  - " + w));
  if (warnings.length > 40) console.log(`  …ほか ${warnings.length - 40}件`);
}
if (errors.length) {
  console.log(`\n❌ エラー ${errors.length}件`);
  errors.forEach((e) => console.log("  - " + e));
  process.exit(1);
}
console.log("\n✅ エラーはありません。\n");
