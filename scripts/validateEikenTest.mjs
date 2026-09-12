/* ============================================================
   英検 模擬テストデータの検証スクリプト
   使い方：node scripts/validateEikenTest.mjs
   src/data/eikenTest/*.json がアプリの想定するスキーマを
   満たしているかをチェックする（問題追加後に実行すること）。
   ============================================================ */

import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "data", "eikenTest");
const errors = [];
const warnings = [];
const seenIds = new Set();

function err(file, path, msg) {
  errors.push(`${file} ${path}: ${msg}`);
}
function warn(file, path, msg) {
  warnings.push(`${file} ${path}: ${msg}`);
}

function normalize(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9' ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function checkId(file, path, id) {
  if (!id) return err(file, path, "id がありません");
  if (seenIds.has(id)) err(file, path, `id "${id}" が重複しています`);
  seenIds.add(id);
}

function checkChoices(file, path, choices, { expect } = {}) {
  if (!Array.isArray(choices) || choices.length < 2) {
    return err(file, path, "choices が配列ではないか、選択肢が足りません");
  }
  if (expect && choices.length !== expect) {
    warn(file, path, `選択肢が${choices.length}個です（本番は${expect}個）`);
  }
  const correct = choices.filter((c) => c.correct === true);
  if (correct.length !== 1) err(file, path, `correct: true の選択肢が${correct.length}個あります（1個にしてください）`);
  choices.forEach((c, i) => {
    if (typeof c.text !== "string" || !c.text.trim()) err(file, path, `choices[${i}].text が空です`);
    if (typeof c.explain !== "string" || !c.explain.trim()) err(file, path, `choices[${i}].explain が空です`);
  });
  const texts = choices.map((c) => normalize(c.text));
  if (new Set(texts).size !== texts.length) err(file, path, "同じ内容の選択肢が複数あります");
}

function checkSection(file, sec, si) {
  const p = `sections[${si}](${sec.id || "?"})`;
  ["id", "phase", "part", "title", "type", "instruction"].forEach((k) => {
    if (!sec[k]) err(file, p, `${k} がありません`);
  });
  if (!["written", "listening"].includes(sec.phase)) err(file, p, `phase は "written" か "listening"`);
  if (typeof sec.officialCount !== "number") err(file, p, "officialCount（本番の問題数）がありません");

  switch (sec.type) {
    case "gapfill":
      (sec.questions || []).forEach((q, i) => {
        const qp = `${p}.questions[${i}]`;
        checkId(file, qp, q.id);
        if (!q.sentence) err(file, qp, "sentence がありません");
        if (!/（　）|\(\s*\)/.test(q.sentence)) warn(file, qp, "空所（　）が見当たりません");
        if (!q.ja) warn(file, qp, "ja（訳）がありません");
        if (!q.point) warn(file, qp, "point（解説）がありません");
        checkChoices(file, qp, q.choices, { expect: 4 });
      });
      break;

    case "dialogue":
      (sec.questions || []).forEach((q, i) => {
        const qp = `${p}.questions[${i}]`;
        checkId(file, qp, q.id);
        if (!Array.isArray(q.lines) || q.lines.length < 2) err(file, qp, "lines が足りません");
        if (typeof q.blankIndex !== "number" || !q.lines || !q.lines[q.blankIndex]) {
          err(file, qp, "blankIndex が lines の範囲外です");
        }
        if (!q.translation) warn(file, qp, "translation（訳）がありません");
        checkChoices(file, qp, q.choices, { expect: 4 });
      });
      break;

    case "ordering":
      (sec.questions || []).forEach((q, i) => {
        const qp = `${p}.questions[${i}]`;
        checkId(file, qp, q.id);
        if (!q.ja) err(file, qp, "ja（日本文）がありません");
        if (!q.sentence) err(file, qp, "sentence（正解の英文）がありません");
        if (!Array.isArray(q.chunks) || q.chunks.length < 3) err(file, qp, "chunks が足りません");
        if (q.chunks && q.sentence) {
          // chunks を並べかえれば sentence になるか（語の多重集合が一致するか）を検証する
          const a = normalize(q.chunks.join(" ")).split(" ").sort();
          const b = normalize(q.sentence).split(" ").sort();
          if (a.join("|") !== b.join("|")) {
            err(file, qp, `chunks を並べても sentence になりません\n    chunks: ${a.join(" ")}\n    sentence: ${b.join(" ")}`);
          }
        }
      });
      break;

    case "reading":
    case "cloze":
      (sec.passages || []).forEach((pa, pi) => {
        const pp = `${p}.passages[${pi}]`;
        checkId(file, pp, pa.id);
        if (!pa.title) err(file, pp, "title がありません");
        if (!pa.passage) err(file, pp, "passage（本文）がありません");
        if (!pa.translation) warn(file, pp, "translation（本文の訳）がありません");
        (pa.questions || []).forEach((q, i) => {
          const qp = `${pp}.questions[${i}]`;
          checkId(file, qp, q.id);
          if (sec.type === "cloze") {
            if (typeof q.blank !== "number") err(file, qp, "blank（空所番号）がありません");
            else if (!new RegExp(`\\(\\s*${q.blank}\\s*\\)`).test(pa.passage)) {
              err(file, qp, `本文に空所 (${q.blank}) が見つかりません`);
            }
          } else if (!q.q) {
            err(file, qp, "q（設問文）がありません");
          }
          checkChoices(file, qp, q.choices, { expect: 4 });
        });
      });
      break;

    case "listening":
      if (typeof sec.playLimit !== "number") warn(file, p, "playLimit（本番の放送回数）がありません");
      (sec.questions || []).forEach((q, i) => {
        const qp = `${p}.questions[${i}]`;
        checkId(file, qp, q.id);
        if (!q.script) err(file, qp, "script がありません");
        if (Array.isArray(q.script)) {
          q.script.forEach((l, li) => {
            if (!l.text) err(file, qp, `script[${li}].text が空です`);
          });
        }
        if (sec.listeningStyle !== "response" && !q.question) {
          err(file, qp, "question（設問文）がありません");
        }
        if (!q.translation) warn(file, qp, "translation（訳）がありません");
        checkChoices(file, qp, q.choices, { expect: sec.listeningStyle === "response" ? 3 : 4 });
      });
      break;

    case "writing":
      (sec.prompts || []).forEach((q, i) => {
        const qp = `${p}.prompts[${i}]`;
        checkId(file, qp, q.id);
        ["instruction", "topic", "wordCount", "modelAnswer"].forEach((k) => {
          if (!q[k]) err(file, qp, `${k} がありません`);
        });
        if (!q.modelTranslation) warn(file, qp, "modelTranslation がありません");
        if (!Array.isArray(q.checklist) || !q.checklist.length) warn(file, qp, "checklist がありません");
      });
      break;

    default:
      err(file, p, `未知の type "${sec.type}"`);
  }
}

function countQuestions(sec) {
  if (sec.type === "reading" || sec.type === "cloze") {
    return (sec.passages || []).reduce((n, p) => n + (p.questions || []).length, 0);
  }
  if (sec.type === "writing") return (sec.prompts || []).length;
  return (sec.questions || []).length;
}

const files = readdirSync(DIR).filter((f) => f.endsWith(".json")).sort();
const summary = [];

for (const file of files) {
  let data;
  try {
    data = JSON.parse(readFileSync(join(DIR, file), "utf8"));
  } catch (e) {
    errors.push(`${file}: JSONとして読めません — ${e.message}`);
    continue;
  }
  ["level", "levelLabel", "levelSub", "color", "exam", "sections"].forEach((k) => {
    if (!data[k]) err(file, "(root)", `${k} がありません`);
  });
  if (data.level && file !== `${data.level}.json`) err(file, "(root)", `level "${data.level}" とファイル名が一致しません`);
  if (data.exam) {
    ["writtenMinutes", "listeningMinutes", "passRate"].forEach((k) => {
      if (typeof data.exam[k] !== "number") err(file, "exam", `${k} が数値ではありません`);
    });
  }
  (data.sections || []).forEach((sec, si) => checkSection(file, sec, si));

  const written = (data.sections || []).filter((s) => s.phase === "written");
  const listening = (data.sections || []).filter((s) => s.phase === "listening");
  const total = (data.sections || []).reduce((n, s) => n + countQuestions(s), 0);
  const graded = (data.sections || []).filter((s) => s.type !== "writing").reduce((n, s) => n + countQuestions(s), 0);
  summary.push({
    級: data.levelLabel,
    筆記: written.reduce((n, s) => n + countQuestions(s), 0),
    リスニング: listening.reduce((n, s) => n + countQuestions(s), 0),
    自動採点: graded,
    収録合計: total,
    大問数: (data.sections || []).length,
  });
}

console.log(`\n検証したファイル：${files.length}件（${files.join(", ")}）\n`);
console.table(summary);

if (warnings.length) {
  console.log(`\n⚠ 警告 ${warnings.length}件`);
  warnings.forEach((w) => console.log("  - " + w));
}
if (errors.length) {
  console.log(`\n❌ エラー ${errors.length}件`);
  errors.forEach((e) => console.log("  - " + e));
  process.exit(1);
}
console.log("\n✅ エラーはありません。\n");
