/* ============================================================
   Sapix：学年 → 科目 → 単元 の定義、単元ごとの遅延読み込み、答えの判定

   ccaofDomains.js と同じ作り。単元一覧と学習記録が使うメタ情報
   （ID・名前・分類）は meta.json から同期で持ち、問題本体は
   import() で単元ごとに読む。

   データは src/data/sapix/g<学年>/<科目>/ に置く（科目の ID は
   sapixStorage.js の SUBJECT_DEFS）。meta.json を置けば、その学年・科目が
   自動で画面に出る。コードの変更はいらない。

   保存キーは sapixStorage.js の storageKeys で決まる。4年は
   学年別にする前のキー（sapixMathProgressV1 など）のまま。
   ============================================================ */

import { GRADES, SUBJECT_DEFS, courseId, storageKeys, logTitle } from "./sapixStorage";

const METAS = import.meta.glob("./data/sapix/g*/*/meta.json", { eager: true, import: "default" });

function withColors(meta) {
  return meta.units.map((u) => ({
    ...u,
    color: (meta.categories.find((c) => c.id === u.category) || {}).color || "#2F5D8A",
  }));
}

function buildCourse(grade, def, meta) {
  return {
    id: courseId(grade, def.id),
    grade,
    subjectId: def.id,
    subjectLabel: def.label,
    dir: `sapix/g${grade}/${def.id}`,
    title: `Sapix ${grade}年 ${def.label}`,
    logTitle: logTitle(grade, def.id),
    eyebrow: meta.eyebrow || `SAPIX — ${grade}年 ${def.label}`,
    target: meta.target || "",
    accent: def.accent,
    card: def.card,
    lead: meta.lead || "単元を選んで 20 問。1 問ずつ答え合わせをして、解説を読みながら進めよう。",
    ...storageKeys(grade, def.id),
    shuffleChoices: def.shuffleChoices, // 算数は曜日・色などの選択肢の並び順に意味があるので並べかえない
    fractions: def.fractions, // 問題文の「a/b」を縦書きの分数で表示する
    categories: meta.categories,
    units: withColors(meta),
  };
}

/** 学年×科目のすべて（データがあるものだけ）。並びは学年順 → 科目順 */
export const COURSES = GRADES.flatMap((grade) =>
  SUBJECT_DEFS.flatMap((def) => {
    const meta = METAS[`./data/sapix/g${grade}/${def.id}/meta.json`];
    return meta ? [buildCourse(grade, def, meta)] : [];
  })
);

/** 問題がある学年だけ */
export const AVAILABLE_GRADES = GRADES.filter((g) => COURSES.some((c) => c.grade === g));

export function coursesOfGrade(grade) {
  return COURSES.filter((c) => c.grade === grade);
}

export function getCourse(grade, subjectId) {
  return COURSES.find((c) => c.grade === grade && c.subjectId === subjectId) || null;
}

export function findUnit(subject, unitId) {
  return subject.units.find((u) => u.id === unitId) || null;
}

/* 単元ファイルは meta.json の file で決まる。glob で拾っておけば、
   単元を足すときに meta.json と JSON を置くだけですむ */
const FILES = import.meta.glob(["./data/sapix/g*/*/*.json", "!./data/sapix/g*/*/meta.json"], { import: "default" });

const cache = new Map();
const pending = new Map();

/** 読み込み済みなら { questions, passages }、まだなら null */
export function peekUnit(subject, unitId) {
  return cache.get(`${subject.dir}/${unitId}`) || null;
}

export function loadUnit(subject, unitId) {
  const key = `${subject.dir}/${unitId}`;
  if (cache.has(key)) return Promise.resolve(cache.get(key));
  if (pending.has(key)) return pending.get(key);
  const unit = findUnit(subject, unitId);
  const loader = unit && FILES[`./data/${subject.dir}/${unit.file}`];
  if (!loader) return Promise.resolve({ questions: [], passages: {} });
  const p = loader()
    .then((data) => {
      const value = { questions: (data && data.questions) || [], passages: (data && data.passages) || {} };
      cache.set(key, value);
      pending.delete(key);
      return value;
    })
    .catch((e) => {
      pending.delete(key);
      throw e;
    });
  pending.set(key, p);
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

/** 記述の答えをそろえる：空白・句点を取り、全角半角・大文字小文字をそろえ、カタカナはひらがなにする */
export function normalizeText(text) {
  return String(text ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s　。．.、,]/g, "")
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
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
  if (q.type === "text") return !normalizeText(input.value);
  return !normalizeNumber(input.value);
}

/**
 * 答えを判定する。{ ok, reason } を返す。
 * reason は不正解のときに出す一言（約分わすれ・形ちがいなど）。
 * choice の input.choice は、並べかえる前の（データの）選択肢番号。
 */
export function checkAnswer(q, input) {
  if (q.type === "choice") return { ok: input.choice === q.answer };
  if (q.type === "text") {
    const v = normalizeText(input.value);
    return { ok: (q.accepted || []).some((a) => normalizeText(a) === v) };
  }
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

/** 選択肢を出す順番（データの番号の並び）。並べかえない教科・問題はそのまま */
export function choiceOrder(subject, q) {
  const order = q.choices.map((_, i) => i);
  if (!subject.shuffleChoices || q.fixedOrder) return order;
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}
