/* ============================================================
   CCAO-F 問題データの検査

   英検側（validateEikenApp.mjs）と同じ役割だが、この資格特有の
   チェックがふたつある。

   1. 出典（reference）と最終確認日（reviewedAt）が必須。
      CCAO-F は「製品の使い方」を問う試験なので、Claude の仕様が
      変われば正解が間違いになる。英検（言語）との決定的な違い。
   2. 180日以上見直していない問題を洗い出す。
      放っておくと、古い仕様のまま正解として教え続けることになる。
   3. 中国語（設問訳・選択肢訳・解答後の注解）が全問にあるか。
      ユーザーの指示で、問題は中国語訳つき・解答後に中文注解を出す。
   ============================================================ */

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, "..", "src", "data", "ccaof");
const STALE_DAYS = 180;

const errors = [];
const warnings = [];

const meta = JSON.parse(readFileSync(join(dataDir, "meta.json"), "utf8"));

const weightSum = meta.domains.reduce((n, d) => n + d.weight, 0);
if (weightSum !== 100) errors.push(`meta.json: 配点比率の合計が ${weightSum}%（100% であるべき）`);

const domainIds = new Set(meta.domains.map((d) => d.id));
const objectivesByDomain = new Map(meta.domains.map((d) => [d.id, new Set(d.objectives)]));
/* Exam Guide 第2章の資格レベルの能力（エスカレーションなど）は
   どのドメインの問題にも紐づけてよい */
const competencies = new Set(meta.competencies || []);

const files = readdirSync(dataDir).filter((f) => f.endsWith(".json") && f !== "meta.json").sort();

const seenIds = new Set();
const seenStems = new Map();
const counts = {};
let stale = 0;
const today = new Date();

for (const file of files) {
  const data = JSON.parse(readFileSync(join(dataDir, file), "utf8"));
  const dom = data.domain;
  if (!domainIds.has(dom)) {
    errors.push(`${file}: domain "${dom}" は meta.json に無い`);
    continue;
  }
  counts[dom] = (data.items || []).length;

  (data.items || []).forEach((it, i) => {
    const at = `${file}[${i}] ${it.id || "(id なし)"}`;

    if (!it.id) errors.push(`${at}: id が無い`);
    else if (seenIds.has(it.id)) errors.push(`${at}: id が重複している`);
    else seenIds.add(it.id);

    if (it.domain !== dom) errors.push(`${at}: domain が ${it.domain}（ファイルは ${dom}）`);
    if (!it.stem || it.stem.length < 20) errors.push(`${at}: stem が無い、または短すぎる`);
    if (!it.stemZh || it.stemZh.length < 10) errors.push(`${at}: stemZh（設問の中国語訳）が無い`);
    if (!it.commentaryZh || it.commentaryZh.length < 30)
      errors.push(`${at}: commentaryZh（解答後の中文注解）が無い、または短すぎる`);
    /* 選択肢はシャッフルして出すので、注解で「B は」と指すと画面とずれる。
       内容で指すこと（実際にずれていたので機械で止める）。 */
    if (it.commentaryZh && /(?<![A-Za-z0-9])[A-E](?![A-Za-z0-9])/.test(it.commentaryZh))
      errors.push(`${at}: commentaryZh が選択肢を記号（A〜E）で指している。出題時にシャッフルするのでずれる`);

    const key = (it.stem || "").trim().toLowerCase();
    if (key) {
      if (seenStems.has(key)) errors.push(`${at}: 設問文が ${seenStems.get(key)} と同じ`);
      else seenStems.set(key, it.id);
    }

    const choices = it.choices || [];
    if (choices.length < 3) errors.push(`${at}: 選択肢が ${choices.length} 個（3つ以上必要）`);
    const correct = choices.filter((c) => c.correct).length;
    const selectCount = it.selectCount || 1;
    if (correct === 0) errors.push(`${at}: 正解が無い`);
    if (correct !== selectCount)
      errors.push(`${at}: selectCount=${selectCount} だが正解は ${correct} 個`);
    if (selectCount > 1 && it.type !== "multi")
      warnings.push(`${at}: 複数選択なのに type が "${it.type}"`);
    choices.forEach((c, ci) => {
      if (!c.text) errors.push(`${at}: choices[${ci}] に text が無い`);
      // 全選択肢に解説を必須にする。なぜ他が不適かを書かないと復習にならない
      if (!c.explain || c.explain.length < 10)
        errors.push(`${at}: choices[${ci}] の explain が無い、または短すぎる`);
      if (!c.textZh) errors.push(`${at}: choices[${ci}] の textZh（中国語訳）が無い`);
    });

    // この資格特有のチェック
    if (!it.reference || !/^https?:\/\//.test(it.reference))
      errors.push(`${at}: reference（出典URL）が無い`);
    if (!it.reviewedAt || !/^\d{4}-\d{2}-\d{2}$/.test(it.reviewedAt)) {
      errors.push(`${at}: reviewedAt（最終確認日）が無い、または形式が YYYY-MM-DD でない`);
    } else {
      const days = Math.floor((today - new Date(it.reviewedAt)) / 86400000);
      if (days > STALE_DAYS) {
        stale += 1;
        warnings.push(`${at}: ${days}日間見直していない（${STALE_DAYS}日超）`);
      }
    }

    if (it.objective && !objectivesByDomain.get(dom).has(it.objective) && !competencies.has(it.objective))
      warnings.push(`${at}: objective が meta.json の出題目標に無い`);
  });
}

// 本番60問の配点どおりに出すには各ドメインに何問必要か
const target = {};
meta.domains.forEach((d) => { target[d.id] = Math.round((meta.examFormat.items * d.weight) / 100); });

console.log(`\nCCAO-F 問題データ（ブループリント v${meta.blueprintVersion} / ${meta.blueprintEffective}）\n`);
console.table(
  meta.domains.map((d) => ({
    ドメイン: `${d.id} ${d.label}`,
    配点: `${d.weight}%`,
    "模試1回分": target[d.id],
    収録: counts[d.id] ?? 0,
    "目標60問まで": Math.max(0, 60 - (counts[d.id] ?? 0)),
  }))
);
console.log(`合計 ${Object.values(counts).reduce((a, b) => a + b, 0)} 問 / 目標 420 問`);
if (stale) console.log(`⚠ ${STALE_DAYS}日以上見直していない問題が ${stale} 件あります`);

if (warnings.length) {
  console.log(`\n⚠ 警告 ${warnings.length}件`);
  warnings.slice(0, 20).forEach((w) => console.log("  - " + w));
  if (warnings.length > 20) console.log(`  …ほか ${warnings.length - 20} 件`);
}

if (errors.length) {
  console.log(`\n❌ エラー ${errors.length}件`);
  errors.slice(0, 40).forEach((e) => console.log("  - " + e));
  process.exit(1);
}
console.log("\n✅ エラーはありません。\n");
