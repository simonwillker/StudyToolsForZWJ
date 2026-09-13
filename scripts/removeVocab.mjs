/* ============================================================
   英検マスター：指定した単語を級から取り除くスクリプト
   使い方：node scripts/removeVocab.mjs <級> <単語> [単語...]
     例：node scripts/removeVocab.mjs 2 empirical meticulous

   級をまたいで同じ単語が登録されてしまったときに、
   ふさわしくないほうの級から取り除くために使う。
   取り除いたあとは id を振り直す。vocab 以外は変更しない。
   ============================================================ */

import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const [, , level, ...words] = process.argv;

if (!level || !words.length) {
  console.error("使い方: node scripts/removeVocab.mjs <級> <単語> [単語...]");
  process.exit(1);
}

const targetPath = join(ROOT, "src", "data", "eikenApp", `${level}.json`);
const text = readFileSync(targetPath, "utf8");

function findArrayRange(src, key) {
  const keyAt = src.indexOf(`"${key}":`);
  if (keyAt < 0) throw new Error(`${key} が見つかりません`);
  const start = src.indexOf("[", keyAt);
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < src.length; i++) {
    const ch = src[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "[") depth += 1;
    else if (ch === "]") {
      depth -= 1;
      if (depth === 0) return { start, end: i + 1 };
    }
  }
  throw new Error(`${key} の配列が閉じていません`);
}

const range = findArrayRange(text, "vocab");
const existing = JSON.parse(text.slice(range.start, range.end));
const targets = new Set(words.map((w) => w.toLowerCase()));

const kept = existing.filter((w) => !targets.has(w.word.toLowerCase()));
const removed = existing.filter((w) => targets.has(w.word.toLowerCase())).map((w) => w.word);
const notFound = words.filter((w) => !removed.some((r) => r.toLowerCase() === w.toLowerCase()));

const renumbered = kept.map((w, i) => ({
  id: `v${level}-${String(i + 1).padStart(3, "0")}`,
  word: w.word,
  phonetic: w.phonetic,
  pos: w.pos,
  meaning: w.meaning,
  example: { en: w.example.en, ja: w.example.ja },
}));

const body = renumbered.map((w) => `    ${JSON.stringify(w)}`).join(",\n");
writeFileSync(targetPath, `${text.slice(0, range.start)}[\n${body}\n  ]${text.slice(range.end)}`, "utf8");

console.log(`${level}.json: ${existing.length}語 → ${renumbered.length}語（削除 ${removed.length}）`);
if (removed.length) console.log(`  削除: ${removed.join(", ")}`);
if (notFound.length) console.log(`  ⚠ 見つからなかった単語: ${notFound.join(", ")}`);
