/* ============================================================
   Sapix 国語・社会・理科 問題データの検査

   算数（validateSapixMath.mjs）と同じ形のデータだが、正解を計算で
   確かめられない教科なので、検算のかわりに形と整合性を厳しく見る。

   - 必須項目・id の一意（3教科をまたいで）・各単元ちょうど20問・易→難
   - choice：選択肢 2〜5 個・重複なし・answer が範囲内
   - text（記述）：accepted が1つ以上、空文字なし。読み問題はひらがなだけ
   - number：answer が数値
   - passage（読解の本文）：参照先が単元ファイルの passages にあり、
     使われていない本文がない
   - 同じ単元に同じ問題文がない
   ============================================================ */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const SUBJECTS = [
  { dir: "sapixKokugo", label: "国語", prefix: "sk-" },
  { dir: "sapixShakai", label: "社会", prefix: "ss-" },
  { dir: "sapixRika", label: "理科", prefix: "sr-" },
];
const UNIT_SIZE = 20;
const LEVELS = ["基本", "標準", "発展"];
const TYPES = ["choice", "text", "number"];

const errors = [];
const warnings = [];
const seenIds = new Set();
const table = [];
let total = 0;

for (const subj of SUBJECTS) {
  const dataDir = join(here, "..", "src", "data", subj.dir);
  const meta = JSON.parse(readFileSync(join(dataDir, "meta.json"), "utf8"));
  const catIds = new Set(meta.categories.map((c) => c.id));
  const unitIds = new Set();

  for (const u of meta.units) {
    const where = `${subj.dir}/meta.json`;
    if (!u.id || !u.label || !u.category || !u.file) errors.push(`${where}: 単元 ${u.id || "?"} に id/label/category/file のどれかが無い`);
    if (unitIds.has(u.id)) errors.push(`${where}: 単元 id ${u.id} が重複`);
    unitIds.add(u.id);
    if (!catIds.has(u.category)) errors.push(`${where}: 単元 ${u.id} の category "${u.category}" が categories に無い`);

    let data;
    try {
      data = JSON.parse(readFileSync(join(dataDir, u.file), "utf8"));
    } catch (e) {
      errors.push(`${subj.dir}/${u.file}: 読めない（${e.message}）`);
      continue;
    }
    const file = `${subj.dir}/${u.file}`;
    if (data.unit !== u.id) errors.push(`${file}: unit "${data.unit}" が meta.json の id "${u.id}" と違う`);
    const qs = data.questions || [];
    if (qs.length !== UNIT_SIZE) errors.push(`${file}: 問題数が ${qs.length}（${UNIT_SIZE}問であるべき）`);

    const passages = data.passages || {};
    const usedPassages = new Set();
    Object.entries(passages).forEach(([pid, p]) => {
      if (!p || !p.title || !p.text || p.text.length < 100) errors.push(`${file}: 本文 ${pid} に title/text が無いか短すぎる`);
    });

    const levelCount = { 基本: 0, 標準: 0, 発展: 0 };
    const seenQ = new Set();
    let lastLevel = 0;
    let choiceCount = 0;

    qs.forEach((q, i) => {
      const at = `${file}[${i}] ${q.id || "(id なし)"}`;
      total += 1;
      if (!q.id) errors.push(`${at}: id が無い`);
      else {
        if (seenIds.has(q.id)) errors.push(`${at}: id が重複している`);
        seenIds.add(q.id);
        if (!q.id.startsWith(subj.prefix)) errors.push(`${at}: id は "${subj.prefix}" で始める`);
      }
      if (!LEVELS.includes(q.level)) errors.push(`${at}: level は 基本/標準/発展 のどれか`);
      else {
        levelCount[q.level] += 1;
        const lv = LEVELS.indexOf(q.level);
        if (lv < lastLevel) errors.push(`${at}: 易→難の順になっていない`);
        lastLevel = Math.max(lastLevel, lv);
      }
      if (!q.q || typeof q.q !== "string") errors.push(`${at}: 問題文 q が無い`);
      else {
        const key = `${q.passage || ""}|${q.q}`;
        if (seenQ.has(key)) errors.push(`${at}: 同じ問題文が単元内にある`);
        seenQ.add(key);
      }
      if (!q.explain || q.explain.length < 15) errors.push(`${at}: 解説 explain が無いか短すぎる`);
      if (q.passage !== undefined) {
        if (!passages[q.passage]) errors.push(`${at}: passage "${q.passage}" が passages に無い`);
        usedPassages.add(q.passage);
      }
      if (!TYPES.includes(q.type)) {
        errors.push(`${at}: type は choice / text / number のどれか`);
        return;
      }
      if (q.type === "choice") {
        choiceCount += 1;
        if (!Array.isArray(q.choices) || q.choices.length < 2 || q.choices.length > 5) errors.push(`${at}: choices は 2〜5 個`);
        else {
          if (new Set(q.choices).size !== q.choices.length) errors.push(`${at}: choices に同じものがある`);
          if (q.choices.some((c) => typeof c !== "string" || !c.trim())) errors.push(`${at}: 空の選択肢がある`);
          if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer >= q.choices.length) errors.push(`${at}: answer は choices の番号（0から）`);
        }
        if (q.fixedOrder !== undefined && typeof q.fixedOrder !== "boolean") errors.push(`${at}: fixedOrder は true/false`);
      } else if (q.choices !== undefined) errors.push(`${at}: choices は choice のときだけ`);
      if (q.type === "text") {
        if (!Array.isArray(q.accepted) || !q.accepted.length || q.accepted.some((a) => typeof a !== "string" || !a.trim()))
          errors.push(`${at}: text の accepted は空でない文字列の配列`);
        // 読みの問題（「ひらがなで」）の正解はひらがなだけ
        if (/ひらがなで/.test(q.q) && q.accepted && q.accepted.some((a) => !/^[ぁ-ゖー]+$/.test(a)))
          errors.push(`${at}: 読みの正解はひらがなだけで書く`);
        // 書きの問題の正解はカタカナを残さない
        if (/漢字に直しましょう/.test(q.q) && q.accepted && q.accepted.some((a) => /[ァ-ヶ]/.test(a)))
          errors.push(`${at}: 書きの正解にカタカナが残っている`);
      }
      if (q.type === "number" && (typeof q.answer !== "number" || !Number.isFinite(q.answer))) errors.push(`${at}: number の answer は数値`);
      if (q.figure !== undefined && (typeof q.figure !== "string" || !q.figure.trim().startsWith("<svg") || /<script|\son\w+=/i.test(q.figure)))
        errors.push(`${at}: figure は <svg>（スクリプトなし）`);
    });

    Object.keys(passages).forEach((pid) => {
      if (!usedPassages.has(pid)) warnings.push(`${file}: 本文 ${pid} がどの問題にも使われていない`);
    });
    // 正解を choices[0] に書いてよいのは、画面で選択肢を並べかえるから。
    // fixedOrder の問題は並べかえないので、正解の位置が片よらないようにする
    const fixed = qs.filter((q) => q.type === "choice" && q.fixedOrder);
    const fixedZero = fixed.filter((q) => q.answer === 0).length;
    if (fixed.length >= 4 && fixedZero * 2 > fixed.length)
      warnings.push(`${file}: fixedOrder の問題 ${fixed.length} 問のうち ${fixedZero} 問の正解が先頭（位置が片よっている）`);
    if (levelCount.基本 < 6 || levelCount.発展 < 3 || levelCount.発展 > 6)
      warnings.push(`${file}: 難易度の配分が 基本${levelCount.基本}・標準${levelCount.標準}・発展${levelCount.発展}（目安 8・8・4）`);
    table.push({ 教科: subj.label, 単元: u.label, 問題数: qs.length, 基本: levelCount.基本, 標準: levelCount.標準, 発展: levelCount.発展, 選択: choiceCount, 本文: Object.keys(passages).length });
  }
}

console.log("\nSapix 国語・社会・理科 問題データ\n");
console.table(table);
console.log(`合計 ${table.length} 単元 / ${total} 問`);
if (warnings.length) {
  console.log(`\n⚠ 警告 ${warnings.length}件`);
  warnings.slice(0, 30).forEach((w) => console.log("  - " + w));
}
if (errors.length) {
  console.log(`\n❌ エラー ${errors.length}件`);
  errors.slice(0, 60).forEach((e) => console.log("  - " + e));
  process.exit(1);
}
console.log("\n✅ エラーはありません。\n");
