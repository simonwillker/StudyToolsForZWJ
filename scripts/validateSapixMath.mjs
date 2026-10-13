/* ============================================================
   Sapix 算数 問題データの検査

   英検・CCAO-F の検証スクリプトと同じ役割。算数なので、
   形のチェックに加えて「正解が本当に正しいか」を計算で確かめる。

   - 必須項目・id の一意・各単元ちょうど20問・易→難の並び
   - 正解の型（number / fraction / choice）
   - calc（検算式）を実行し、answer と一致するか
     calc は解き方とは別に、ふつうの計算や総当たりで答えを出す式。
     分数は R("1/2+1/3") のように書くと約分済みの分数で計算する。
   - 図（figure）は <svg で始まり viewBox を持つか
   ============================================================ */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
// src/data/sapix/g<学年>/math/ をすべて検査する（学年を足すと自動でふえる）
const sapixDir = join(here, "..", "src", "data", "sapix");
const MATH_DIRS = readdirSync(sapixDir)
  .filter((g) => /^g[1-6]$/.test(g) && existsSync(join(sapixDir, g, "math", "meta.json")))
  .sort()
  .map((g) => ({ grade: g, dir: join(sapixDir, g, "math") }));
const UNIT_SIZE = 20;
const LEVELS = ["基本", "標準", "発展"];
const TYPES = ["number", "fraction", "choice"];

const errors = [];
const warnings = [];

/* ---------- 分数（有理数）の計算 ---------- */

function gcd(a, b) {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) [a, b] = [b, a % b];
  return a;
}
function lcm(a, b) {
  return (a / gcd(a, b)) * b;
}
function rat(n, d = 1) {
  if (d === 0) throw new Error("0 で割っている");
  if (d < 0) [n, d] = [-n, -d];
  const g = gcd(n, d) || 1;
  return { n: n / g, d: d / g, isRat: true };
}
const add = (a, b) => rat(a.n * b.d + b.n * a.d, a.d * b.d);
const sub = (a, b) => rat(a.n * b.d - b.n * a.d, a.d * b.d);
const mul = (a, b) => rat(a.n * b.n, a.d * b.d);
const div = (a, b) => rat(a.n * b.d, a.d * b.n);

/** "3/4-1/6+(2+1/3)" のような式を分数のまま計算する（整数・+ - * / ( ) だけ） */
function R(src) {
  const s = String(src).replace(/\s+/g, "").replace(/×/g, "*").replace(/÷/g, "/");
  let i = 0;
  const peek = () => s[i];
  function factor() {
    if (peek() === "(") {
      i += 1;
      const v = expr();
      if (s[i] !== ")") throw new Error(`R: ")" がない: ${src}`);
      i += 1;
      return v;
    }
    if (peek() === "-") {
      i += 1;
      return sub(rat(0), factor());
    }
    const m = /^\d+/.exec(s.slice(i));
    if (!m) throw new Error(`R: 数が読めない: ${src}`);
    i += m[0].length;
    return rat(Number(m[0]));
  }
  function term() {
    let v = factor();
    while (peek() === "*" || peek() === "/") {
      const op = s[i++];
      const w = factor();
      v = op === "*" ? mul(v, w) : div(v, w);
    }
    return v;
  }
  function expr() {
    let v = term();
    while (peek() === "+" || peek() === "-") {
      const op = s[i++];
      const w = term();
      v = op === "+" ? add(v, w) : sub(v, w);
    }
    return v;
  }
  const v = expr();
  if (i !== s.length) throw new Error(`R: 読み残しがある: ${src}`);
  return v;
}

/* ---------- calc で使える道具 ---------- */

const range = (a, b) => Array.from({ length: b - a + 1 }, (_, k) => a + k);
const sum = (arr) => arr.reduce((x, y) => x + y, 0);
const count = (arr, fn) => arr.filter(fn).length;
const divisors = (n) => range(1, n).filter((k) => n % k === 0);
/** a〜b の整数で fn を満たす最初の数（文章題の総当たり用） */
function find(fn, a = 0, b = 10000) {
  for (let x = a; x <= b; x += 1) if (fn(x)) return x;
  throw new Error("find: 条件を満たす数がない");
}
/** 並べ方を全部作る（場合の数の総当たり用） */
function perms(arr, k = arr.length) {
  if (k === 0) return [[]];
  const out = [];
  arr.forEach((x, idx) => {
    const rest = arr.filter((_, j) => j !== idx);
    perms(rest, k - 1).forEach((p) => out.push([x, ...p]));
  });
  return out;
}
/** 選び方を全部作る */
function combs(arr, k) {
  if (k === 0) return [[]];
  if (arr.length < k) return [];
  const [h, ...t] = arr;
  return [...combs(t, k - 1).map((c) => [h, ...c]), ...combs(t, k)];
}
const uniq = (arr) => [...new Set(arr.map((x) => JSON.stringify(x)))].length;
const DAYS = ["日", "月", "火", "水", "木", "金", "土"];

function runCalc(code) {
  // eslint-disable-next-line no-new-func
  const fn = new Function(
    "R", "gcd", "lcm", "range", "sum", "count", "divisors", "find", "perms", "combs", "uniq", "DAYS",
    `return (${code});`
  );
  return fn(R, gcd, lcm, range, sum, count, divisors, find, perms, combs, uniq, DAYS);
}

/** "19/12" → 分数。帯分数は書かない（約分済みの仮分数で持つ） */
function parseFractionAnswer(s) {
  const m = /^(\d+)\/(\d+)$/.exec(String(s));
  if (!m) return null;
  return { n: Number(m[1]), d: Number(m[2]) };
}

/* ---------- 検査本体 ---------- */

const seenIds = new Set();
const seenQ = new Map();
const table = [];
let total = 0;
let figures = 0;
let unitCount = 0;

for (const { grade, dir: dataDir } of MATH_DIRS) {
  const meta = JSON.parse(readFileSync(join(dataDir, "meta.json"), "utf8"));

  const unitIds = new Set();
  for (const u of meta.units) {
    if (!u.id || !u.label || !u.category || !u.file) errors.push(`meta.json: 単元 ${u.id || "?"} に id/label/category/file のどれかが無い`);
    if (unitIds.has(u.id)) errors.push(`meta.json: 単元 id ${u.id} が重複`);
    unitIds.add(u.id);
    if (!meta.categories.some((c) => c.id === u.category)) errors.push(`meta.json: 単元 ${u.id} の category "${u.category}" が categories に無い`);
  }

  for (const u of meta.units) {
    let data;
    try {
      data = JSON.parse(readFileSync(join(dataDir, u.file), "utf8"));
    } catch (e) {
      errors.push(`${u.file}: 読めない（${e.message}）`);
      continue;
    }
    if (data.unit !== u.id) errors.push(`${u.file}: unit "${data.unit}" が meta.json の id "${u.id}" と違う`);
    const qs = data.questions || [];
    if (qs.length !== UNIT_SIZE) errors.push(`${u.file}: 問題数が ${qs.length}（${UNIT_SIZE}問であるべき）`);
    const levelCount = { 基本: 0, 標準: 0, 発展: 0 };
    let lastLevel = 0;

    qs.forEach((q, i) => {
      const at = `${u.file}[${i}] ${q.id || "(id なし)"}`;
      total += 1;

      if (!q.id) errors.push(`${at}: id が無い`);
      else if (seenIds.has(q.id)) errors.push(`${at}: id が重複している`);
      else seenIds.add(q.id);

      if (!LEVELS.includes(q.level)) errors.push(`${at}: level は 基本/標準/発展 のどれか`);
      else {
        levelCount[q.level] += 1;
        const lv = LEVELS.indexOf(q.level);
        if (lv < lastLevel) errors.push(`${at}: 易→難の順になっていない（${q.level} が前の問題より易しい）`);
        lastLevel = Math.max(lastLevel, lv);
      }

      if (!q.q || typeof q.q !== "string") errors.push(`${at}: 問題文 q が無い`);
      else if (seenQ.has(q.q)) errors.push(`${at}: 問題文が ${seenQ.get(q.q)} と同じ`);
      else seenQ.set(q.q, q.id);
      if (!q.explain || q.explain.length < 15) errors.push(`${at}: 解説 explain が無いか短すぎる`);
      if (q.unit !== undefined && typeof q.unit !== "string") errors.push(`${at}: unit は文字列`);

      if (!TYPES.includes(q.type)) {
        errors.push(`${at}: type は number / fraction / choice のどれか`);
        return;
      }

      // 正解の型
      if (q.type === "number" && (typeof q.answer !== "number" || !Number.isFinite(q.answer)))
        errors.push(`${at}: number の answer は数値`);
      let frac = null;
      if (q.type === "fraction") {
        frac = parseFractionAnswer(q.answer);
        if (!frac) errors.push(`${at}: fraction の answer は "19/12" の形の文字列`);
        else {
          if (gcd(frac.n, frac.d) !== 1) errors.push(`${at}: answer "${q.answer}" が約分されていない`);
          if (frac.d === 1) errors.push(`${at}: 答えが整数なら type は number にする`);
        }
        if (q.form !== undefined && !["mixed", "improper"].includes(q.form)) errors.push(`${at}: form は mixed / improper`);
      }
      if (q.type === "choice") {
        if (!Array.isArray(q.choices) || q.choices.length < 2) errors.push(`${at}: choices が2つ以上必要`);
        else {
          if (new Set(q.choices).size !== q.choices.length) errors.push(`${at}: choices に同じものがある`);
          if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer >= q.choices.length)
            errors.push(`${at}: choice の answer は choices の番号（0から）`);
        }
      } else if (q.choices) errors.push(`${at}: choices は choice のときだけ`);

      // 検算
      if (!q.calc) {
        errors.push(`${at}: 検算式 calc が無い`);
      } else {
        let v;
        try {
          v = runCalc(q.calc);
        } catch (e) {
          errors.push(`${at}: calc を実行できない（${e.message}）`);
          return;
        }
        let ok = false;
        if (q.type === "number") {
          const num = v && v.isRat ? v.n / v.d : v;
          ok = typeof num === "number" && Math.abs(num - q.answer) < 1e-9;
        } else if (q.type === "fraction") {
          ok = !!(v && v.isRat && frac && v.n === frac.n && v.d === frac.d);
        } else {
          ok = Array.isArray(q.choices) && v === q.choices[q.answer];
        }
        if (!ok) errors.push(`${at}: 検算が合わない（calc=${v && v.isRat ? `${v.n}/${v.d}` : JSON.stringify(v)}, answer=${JSON.stringify(q.answer)}）`);
      }

      if (q.figure !== undefined) {
        figures += 1;
        if (typeof q.figure !== "string" || !q.figure.trim().startsWith("<svg") || !/viewBox=/.test(q.figure) || !q.figure.trim().endsWith("</svg>"))
          errors.push(`${at}: figure は viewBox つきの <svg>…</svg>`);
        if (/<script|\son\w+=/i.test(q.figure)) errors.push(`${at}: figure にスクリプトを入れない`);
        if (!q.figureAlt) warnings.push(`${at}: figureAlt（図の説明）が無い`);
      }
    });

    if (levelCount.基本 < 6 || levelCount.発展 < 3 || levelCount.発展 > 6)
      warnings.push(`${u.file}: 難易度の配分が 基本${levelCount.基本}・標準${levelCount.標準}・発展${levelCount.発展}（目安 8・8・4）`);
    table.push({ 学年: grade, 単元: u.label, 分類: u.category, 問題数: qs.length, 基本: levelCount.基本, 標準: levelCount.標準, 発展: levelCount.発展 });
  }
  unitCount += meta.units.length;
}

console.log("\nSapix 算数 問題データ\n");
console.table(table);
console.log(`合計 ${unitCount} 単元 / ${total} 問（図つき ${figures} 問）`);

if (warnings.length) {
  console.log(`\n⚠ 警告 ${warnings.length}件`);
  warnings.slice(0, 20).forEach((w) => console.log("  - " + w));
}
if (errors.length) {
  console.log(`\n❌ エラー ${errors.length}件`);
  errors.slice(0, 60).forEach((e) => console.log("  - " + e));
  process.exit(1);
}
console.log("\n✅ エラーはありません（全問の正解を検算済み）。\n");
