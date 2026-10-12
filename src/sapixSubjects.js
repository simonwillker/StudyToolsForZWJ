/* ============================================================
   Sapix 算数・国語・社会・理科・英語：教科の定義、単元ごとの遅延読み込み、
   答えの判定

   ccaofDomains.js と同じ作り。単元一覧と学習記録が使うメタ情報
   （ID・名前・分類）は meta.json から同期で持ち、問題本体は
   import() で単元ごとに読む。

   算数の保存キーは最初に作ったときのまま（sapixMathProgressV1 など）。
   ここを変えると、これまでの算数の記録が見えなくなる。
   ============================================================ */

import MATH_META from "./data/sapixMath/meta.json";
import KOKUGO_META from "./data/sapixKokugo/meta.json";
import SHAKAI_META from "./data/sapixShakai/meta.json";
import RIKA_META from "./data/sapixRika/meta.json";
import EIGO_META from "./data/sapixEigo/meta.json";

function withColors(meta) {
  return meta.units.map((u) => ({
    ...u,
    color: (meta.categories.find((c) => c.id === u.category) || {}).color || "#2F5D8A",
  }));
}

export const SUBJECTS = {
  sapixMath: {
    id: "sapixMath",
    dir: "sapixMath",
    title: "Sapix 算数",
    eyebrow: "SAPIX MATH — 4年 冬期講習",
    accent: "#2F5D8A",
    lead: "単元を選んで 20 問（基本 → 標準 → 発展の順）。1 問ずつ答え合わせをして、解き方を読みながら進めよう。まちがえた問題は「復習」でもう一度解けます。",
    progressKey: "sapixMathProgressV1",
    reviewKey: "sapixMathReviewV1",
    shuffleChoices: false, // 曜日・色などの選択肢は並び順に意味があるので並べかえない
    fractions: true, // 問題文の「a/b」を縦書きの分数で表示する
    categories: MATH_META.categories,
    units: withColors(MATH_META),
  },
  sapixKokugo: {
    id: "sapixKokugo",
    dir: "sapixKokugo",
    title: "Sapix 国語",
    eyebrow: "SAPIX JAPANESE — 4年 冬期講習",
    accent: "#8A3B2F",
    lead: "漢字の読み書き・言葉の知識・文法・読解の 10 単元。1 問ずつ答え合わせをして、解説を読みながら進めよう。読解は本文を読んでから答えます。",
    progressKey: "sapixKokugoProgressV1",
    reviewKey: "sapixKokugoReviewV1",
    shuffleChoices: true,
    fractions: false,
    categories: KOKUGO_META.categories,
    units: withColors(KOKUGO_META),
  },
  sapixShakai: {
    id: "sapixShakai",
    dir: "sapixShakai",
    title: "Sapix 社会",
    eyebrow: "SAPIX SOCIAL STUDIES — 4年 冬期講習",
    accent: "#2F7A4F",
    lead: "地図と国土・産業・くらしの 10 単元。1 問ずつ答え合わせをして、解説で理由まで確かめよう。",
    progressKey: "sapixShakaiProgressV1",
    reviewKey: "sapixShakaiReviewV1",
    shuffleChoices: true,
    fractions: false,
    categories: SHAKAI_META.categories,
    units: withColors(SHAKAI_META),
  },
  sapixRika: {
    id: "sapixRika",
    dir: "sapixRika",
    title: "Sapix 理科",
    eyebrow: "SAPIX SCIENCE — 4年 冬期講習",
    accent: "#5A3B8A",
    lead: "生物・地学・物理・化学の 10 単元。1 問ずつ答え合わせをして、解説で「なぜそうなるか」まで確かめよう。",
    progressKey: "sapixRikaProgressV1",
    reviewKey: "sapixRikaReviewV1",
    shuffleChoices: true,
    fractions: false,
    categories: RIKA_META.categories,
    units: withColors(RIKA_META),
  },
  sapixEigo: {
    id: "sapixEigo",
    dir: "sapixEigo",
    title: "Sapix 英語",
    eyebrow: "ENGLISH — 英検5級〜4級レベル",
    accent: "#2F7A8A",
    lead: "単語・文法・会話・読解の 10 単元（英検5級〜4級程度）。1 問ずつ答え合わせをして、解説と日本語訳で確かめよう。つづりを書く問題は、大文字・小文字のちがいは気にしなくてだいじょうぶです。",
    progressKey: "sapixEigoProgressV1",
    reviewKey: "sapixEigoReviewV1",
    shuffleChoices: true,
    fractions: false,
    categories: EIGO_META.categories,
    units: withColors(EIGO_META),
  },
};

export const SUBJECT_IDS = Object.keys(SUBJECTS);

export function getSubject(id) {
  return SUBJECTS[id] || SUBJECTS.sapixMath;
}

export function findUnit(subject, unitId) {
  return subject.units.find((u) => u.id === unitId) || null;
}

/* 単元ファイルは meta.json の file で決まる。glob で拾っておけば、
   単元を足すときに meta.json と JSON を置くだけですむ */
const FILES = import.meta.glob(["./data/sapix*/*.json", "!./data/sapix*/meta.json"], { import: "default" });

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
