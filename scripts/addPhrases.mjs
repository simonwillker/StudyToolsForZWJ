/* ============================================================
   英検マスター：常用短句（よく使う英語フレーズ）を一括追加するスクリプト
   使い方：node scripts/addPhrases.mjs <級> <追加するフレーズのJSONファイル>
     例：node scripts/addPhrases.mjs 5 tmp/phrases-5.json
         node scripts/addPhrases.mjs 5 - < tmp/phrases-5.json（標準入力）

   - src/data/eikenApp/<級>.json の phrases 配列に追記する
     （phrases がまだ無ければ vocab の直後に作る）
   - 同じ級・他の級に同じフレーズがあればスキップする
     （大文字小文字と文末の . ! ? の違いは同じとみなす）
   - id は p<級>-001 形式で通し番号を振り直す
   - 既存ファイルと同じ整形（JSON.stringify(…, null, 2) ＋末尾改行）で
     書き出すので、git diff には追加したフレーズだけが出る
   ============================================================ */

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, dirname, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const [, , level, sourcePath] = process.argv;

if (!level || !sourcePath) {
  console.error("使い方: node scripts/addPhrases.mjs <級> <追加するフレーズのJSONファイル>");
  process.exit(1);
}

const dataDir = join(ROOT, "src", "data", "eikenApp");
const targetPath = join(dataDir, `${level}.json`);
const data = JSON.parse(readFileSync(targetPath, "utf8"));
const existing = data.phrases || [];
// "-" を指定すると標準入力から読む
const source = sourcePath === "-" ? 0 : isAbsolute(sourcePath) ? sourcePath : join(ROOT, sourcePath);
const incoming = JSON.parse(readFileSync(source, "utf8"));

const keyOf = (s) => String(s || "").trim().toLowerCase().replace(/[.!?]+$/, "").trim();
const seen = new Set(existing.map((p) => keyOf(p.phrase)));

// 他の級に登録済みのフレーズ（級をまたいだ重複は入れない方針）
const elsewhere = new Map();
for (const f of readdirSync(dataDir).filter((f) => f.endsWith(".json") && f !== `${level}.json`)) {
  const other = JSON.parse(readFileSync(join(dataDir, f), "utf8"));
  (other.phrases || []).forEach((p) => elsewhere.set(keyOf(p.phrase), other.levelLabel));
}

const added = [];
const skipped = [];
const otherLevel = [];
for (const p of incoming) {
  const key = keyOf(p.phrase);
  if (!key) continue;
  if (seen.has(key)) {
    skipped.push(p.phrase);
    continue;
  }
  if (elsewhere.has(key)) {
    otherLevel.push(`${p.phrase}（${elsewhere.get(key)}）`);
    continue;
  }
  seen.add(key);
  added.push(p);
}

const merged = [...existing, ...added].map((p, i) => ({
  id: `p${level}-${String(i + 1).padStart(3, "0")}`,
  phrase: p.phrase,
  meaning: p.meaning,
  note: p.note,
  example: { en: p.example.en, ja: p.example.ja },
}));

// phrases が無いときは vocab の直後に置く（キーの並びをそろえるため）
const out = {};
for (const [k, v] of Object.entries(data)) {
  if (k === "phrases") continue;
  out[k] = v;
  if (k === "vocab") out.phrases = merged;
}
if (!out.phrases) out.phrases = merged;
writeFileSync(targetPath, `${JSON.stringify(out, null, 2)}\n`, "utf8");

console.log(`${level}.json: 短句 ${existing.length}個 → ${merged.length}個（追加 ${added.length} / 重複スキップ ${skipped.length + otherLevel.length}）`);
if (skipped.length) console.log(`  同じ級に登録済み: ${skipped.join(", ")}`);
if (otherLevel.length) console.log(`  他の級に登録済み: ${otherLevel.join(", ")}`);
