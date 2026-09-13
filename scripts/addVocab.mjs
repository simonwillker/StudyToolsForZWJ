/* ============================================================
   英検マスター：単語データを一括追加するスクリプト
   使い方：node scripts/addVocab.mjs <級> <追加する単語のJSONファイル>
     例：node scripts/addVocab.mjs 5 tmp/vocab-5.json
         node scripts/addVocab.mjs 5 - < tmp/vocab-5.json（標準入力）

   - src/data/eikenApp/<級>.json の vocab 配列に追記する
   - すでに同じ単語（大文字小文字を無視）があればスキップする
   - id は v<級>-001 形式で通し番号を振り直す
   - vocab 以外（grammar / reading / listening / dialogue）は
     1バイトも変更しない（差分を最小にするため）
   ============================================================ */

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, dirname, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const [, , level, sourcePath] = process.argv;

if (!level || !sourcePath) {
  console.error("使い方: node scripts/addVocab.mjs <級> <追加する単語のJSONファイル>");
  process.exit(1);
}

const targetPath = join(ROOT, "src", "data", "eikenApp", `${level}.json`);
const text = readFileSync(targetPath, "utf8");

/** "vocab": [ ... ] の範囲を、括弧の対応をとって特定する */
function findArrayRange(src, key) {
  const marker = `"${key}":`;
  const keyAt = src.indexOf(marker);
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
// "-" を指定すると標準入力から読む（例：node scripts/addVocab.mjs 5 - < words.json）
const source = sourcePath === "-" ? 0 : isAbsolute(sourcePath) ? sourcePath : join(ROOT, sourcePath);
const incoming = JSON.parse(readFileSync(source, "utf8"));

const seen = new Set(existing.map((w) => w.word.toLowerCase()));
const added = [];
const skipped = [];
const otherLevel = [];

// 他の級に登録済みの単語（級をまたいだ重複は入れない方針）
const dataDir = join(ROOT, "src", "data", "eikenApp");
const elsewhere = new Map();
for (const f of readdirSync(dataDir).filter((f) => f.endsWith(".json") && f !== `${level}.json`)) {
  const other = JSON.parse(readFileSync(join(dataDir, f), "utf8"));
  other.vocab.forEach((w) => elsewhere.set(w.word.toLowerCase(), other.levelLabel));
}

for (const w of incoming) {
  const key = String(w.word || "").toLowerCase();
  if (!key) continue;
  if (seen.has(key)) {
    skipped.push(w.word);
    continue;
  }
  if (elsewhere.has(key)) {
    otherLevel.push(`${w.word}（${elsewhere.get(key)}）`);
    continue;
  }
  seen.add(key);
  added.push(w);
}

const merged = [...existing, ...added].map((w, i) => ({
  id: `v${level}-${String(i + 1).padStart(3, "0")}`,
  word: w.word,
  phonetic: w.phonetic,
  pos: w.pos,
  meaning: w.meaning,
  example: { en: w.example.en, ja: w.example.ja },
}));

/** 既存ファイルと同じく「1単語＝1行」で書き出す */
const body = merged.map((w) => `    ${JSON.stringify(w)}`).join(",\n");
const out = `${text.slice(0, range.start)}[\n${body}\n  ]${text.slice(range.end)}`;
writeFileSync(targetPath, out, "utf8");

console.log(`${level}.json: ${existing.length}語 → ${merged.length}語（追加 ${added.length} / 重複スキップ ${skipped.length + otherLevel.length}）`);
if (skipped.length) console.log(`  同じ級に登録済み: ${skipped.join(", ")}`);
if (otherLevel.length) console.log(`  他の級に登録済み: ${otherLevel.join(", ")}`);
