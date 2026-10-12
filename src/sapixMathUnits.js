/* ============================================================
   Sapix 算数：単元ごとの遅延読み込みと、答えの判定

   ccaofDomains.js と同じ作り。単元一覧と学習記録が使うメタ情報
   （ID・名前・分類）は meta.json から同期で持ち、問題本体は
   import() で単元ごとに読む。英検や CCAO-F を使う日に算数の
   問題まで読み込まないようにするため。
   ============================================================ */

import META from "./data/sapixMath/meta.json";

export const CATEGORIES = META.categories;
export const UNITS = META.units.map((u) => ({
  ...u,
  color: (META.categories.find((c) => c.id === u.category) || {}).color || "#2F5D8A",
}));

/* 単元ファイルは meta.json の file で決まる。glob で拾っておけば、
   単元を足すときに meta.json と JSON を置くだけですむ */
const FILES = import.meta.glob(["./data/sapixMath/*.json", "!./data/sapixMath/meta.json"], { import: "default" });

const cache = new Map();
const pending = new Map();

export function findUnit(id) {
  return UNITS.find((u) => u.id === id) || null;
}

export function peekUnitQuestions(id) {
  return cache.get(id) || null;
}

export function loadUnitQuestions(id) {
  if (cache.has(id)) return Promise.resolve(cache.get(id));
  if (pending.has(id)) return pending.get(id);
  const unit = findUnit(id);
  const loader = unit && FILES[`./data/sapixMath/${unit.file}`];
  if (!loader) return Promise.resolve([]);
  const p = loader()
    .then((data) => {
      const qs = (data && data.questions) || [];
      cache.set(id, qs);
      pending.delete(id);
      return qs;
    })
    .catch((e) => {
      pending.delete(id);
      throw e;
    });
  pending.set(id, p);
  return p;
}

/* ---------- 答えの判定 ---------- */

/** 全角の数字・小数点・マイナスを半角にし、カンマと空白を取る */
export function normalizeNumber(text) {
  return String(text ?? "")
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[．。]/g, ".")
    .replace(/[－ー−]/g, "-")
    .replace(/[,，\s]/g, "");
}

/** 数として読めれば数、読めなければ null */
export function parseNumber(text) {
  const s = normalizeNumber(text);
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  return Number(s);
}

function gcd(a, b) {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) [a, b] = [b, a % b];
  return a;
}

/** "19/12" → { n: 19, d: 12 } */
export function parseFraction(s) {
  const m = /^(\d+)\/(\d+)$/.exec(String(s));
  return m ? { n: Number(m[1]), d: Number(m[2]) } : null;
}

/** 仮分数を帯分数の部品に分ける。{ whole, n, d }（n が 0 なら整数） */
export function toMixed({ n, d }) {
  return { whole: Math.floor(n / d), n: n % d, d };
}

/** 入力欄が空かどうか（答え合わせボタンを押せるかの判定に使う） */
export function isAnswerEmpty(q, input) {
  if (!input) return true;
  if (q.type === "choice") return input.choice === undefined || input.choice === null;
  if (q.type === "fraction") return !normalizeNumber(input.n) && !normalizeNumber(input.whole);
  return !normalizeNumber(input.value);
}

/**
 * 答えを判定する。{ ok, reason } を返す。
 * reason は不正解のときに出す一言（約分わすれ・形ちがいなど）。
 */
export function checkAnswer(q, input) {
  if (q.type === "choice") return { ok: input.choice === q.answer };
  if (q.type === "number") {
    const v = parseNumber(input.value);
    if (v === null) return { ok: false, reason: "数字で答えましょう。" };
    return { ok: Math.abs(v - q.answer) < 1e-9 };
  }
  // 分数：整数部分（なくてもよい）・分子・分母
  const ans = parseFraction(q.answer);
  const whole = normalizeNumber(input.whole) ? parseNumber(input.whole) : 0;
  const hasFrac = !!(normalizeNumber(input.n) || normalizeNumber(input.d));
  const n = hasFrac ? parseNumber(input.n) : 0;
  const d = hasFrac ? parseNumber(input.d) : 1;
  if ([whole, n, d].some((x) => x === null || !Number.isInteger(x) || x < 0) || d === 0)
    return { ok: false, reason: "整数・分子・分母を、0 以上の整数で入れましょう。" };
  const total = whole * d + n; // 入力した値 ＝ total / d
  const equal = total * ans.d === ans.n * d;
  if (!equal) return { ok: false };
  if (hasFrac && n > 0 && gcd(n, d) !== 1) return { ok: false, reason: "答えは合っていますが、約分できます。約分して答えましょう。" };
  if (q.form === "mixed" && (n >= d || (whole === 0 && ans.n > ans.d)))
    return { ok: false, reason: "答えは合っていますが、帯分数で答えましょう。" };
  if (q.form === "improper" && whole > 0) return { ok: false, reason: "答えは合っていますが、仮分数で答えましょう。" };
  return { ok: true };
}
