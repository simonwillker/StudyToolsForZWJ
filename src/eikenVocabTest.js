/* ============================================================
   英検マスター：単語テスト（3級・準2級・2級）

   「単語・熟語」は 4 択で覚えるための練習（1問ごとに正誤と解説が出る）。
   こちらは範囲と問題数を決めて受ける採点式のテストで、
   回答中は正解を見せず、最後にまとめて採点する。

   この部品は画面に触らない（node のテストからも読める）。
   - 出題の組み立て：buildVocabTest()
   - 採点：gradeVocabTest()
   - 結果の保存：eikenVocabTestResultsV1（勉強者ごと、級ごとに新しい順）

   採点した答えは、呼び出し側（EikenVocabTest.jsx）で
   recordAnswer（学習記録・勉強履歴）と recordReviewResult（mode は "vocab"。
   まちがえた単語は「まちがえた問題の復習」に入る）にも渡す。
   ============================================================ */

import { learnerKey } from "./learner";

/** 単語テストを出す級。ほかの級には出さない */
export const VOCAB_TEST_LEVELS = ["3", "pre2", "2"];

export function hasVocabTest(level) {
  return VOCAB_TEST_LEVELS.includes(level);
}

/** 単語・熟語と同じ 20 語ずつの組（EikenApp.jsx の VOCAB_UNIT_SIZE と同じ） */
export const UNIT_SIZE = 20;

export const QUESTION_COUNTS = [10, 20, 50];

export const FORMATS = [
  { id: "en2ja", label: "英語 → 意味", short: "英→日" },
  { id: "ja2en", label: "意味 → 英語", short: "日→英" },
  { id: "spell", label: "スペルを書く", short: "スペル" },
  { id: "mix", label: "まぜる", short: "まぜる" },
];

export function formatLabel(id) {
  return (FORMATS.find((f) => f.id === id) || {}).label || id;
}

const STORAGE_KEY = "eikenVocabTestResultsV1";
const MAX_RESULTS_PER_LEVEL = 50;

function randInt(max, rand) {
  return Math.floor(rand() * max);
}

function shuffle(arr, rand = Math.random) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randInt(i + 1, rand);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function unitCount(vocab) {
  return Math.ceil(vocab.length / UNIT_SIZE);
}

/**
 * 出題範囲の単語。
 * range: { type: "units", from, to }（0始まり、両端を含む）／{ type: "all" }／{ type: "weak" }
 * （結果画面の「まちがえた単語をもう一度」は { type: "retry" } で、単語を直接わたす）
 * weakIds: 苦手な単語の id（復習リストの単語）
 */
export function wordsInRange(vocab, range, weakIds = new Set()) {
  if (!range || range.type === "all") return vocab;
  if (range.type === "weak") return vocab.filter((w) => weakIds.has(w.id));
  const last = unitCount(vocab) - 1;
  const from = Math.max(0, Math.min(range.from ?? 0, last));
  const to = Math.max(from, Math.min(range.to ?? from, last));
  return vocab.slice(from * UNIT_SIZE, (to + 1) * UNIT_SIZE);
}

export function rangeLabel(range) {
  if (!range || range.type === "all") return "すべて";
  if (range.type === "weak") return "苦手な単語";
  if (range.type === "retry") return "まちがえた単語";
  const from = range.from + 1;
  const to = range.to + 1;
  return from === to ? `${from}組` : `${from}〜${to}組`;
}

/** 意味を「、」「；」などで区切った部分。部分が1つでも重なる語は誤答の選択肢にしない */
function meaningParts(meaning) {
  return String(meaning)
    .split(/[、，,；;／/・]/)
    .map((s) => s.replace(/[（(].*?[）)]/g, "").trim())
    .filter(Boolean);
}

function meaningsOverlap(a, b) {
  if (a === b) return true;
  const pa = meaningParts(a);
  const pb = new Set(meaningParts(b));
  return pa.some((p) => pb.has(p));
}

/** 品詞の大分類（"名詞/動詞" は "名詞"）。同じ品詞の語を誤答に優先する */
function mainPos(pos) {
  return String(pos || "").split("/")[0];
}

/** 誤答 3 つ。同じ品詞を優先し、意味が重なる語・同じ綴りの語は使わない */
export function pickDistractors(word, vocab, rand = Math.random, n = 3) {
  const ok = vocab.filter(
    (x) => x.id !== word.id && x.word.toLowerCase() !== word.word.toLowerCase() && !meaningsOverlap(x.meaning, word.meaning)
  );
  const same = shuffle(ok.filter((x) => mainPos(x.pos) === mainPos(word.pos)), rand);
  const other = shuffle(ok.filter((x) => mainPos(x.pos) !== mainPos(word.pos)), rand);
  const out = [];
  const seenText = new Set([word.meaning, word.word.toLowerCase()]);
  for (const x of [...same, ...other]) {
    if (out.length >= n) break;
    // 選択肢の文字列が重ならないようにする（同じ意味の訳語・同じ綴りを二重に出さない）
    if (seenText.has(x.meaning) || seenText.has(x.word.toLowerCase())) continue;
    seenText.add(x.meaning);
    seenText.add(x.word.toLowerCase());
    out.push(x);
  }
  return out;
}

/** スペルの採点用。大小文字・前後の空白・空白の数・アポストロフィ・ハイフンの書き方の違いは見ない */
export function normalizeSpelling(s) {
  return String(s || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[’‘`´]/g, "'")
    .replace(/[‐‑‒–—―]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/** 例文の中の見出し語を ＿ に置きかえる。活用形などで見つからなければ null */
export function blankExample(word, en) {
  if (!en) return null;
  const esc = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  const re = new RegExp(`\\b${esc}\\b`, "i");
  if (!re.test(en)) return null;
  return en.replace(re, (m) => m.replace(/[A-Za-z]/g, "_"));
}

/** スペル問題のヒント：頭文字と文字数（熟語は語ごと） */
export function spellingHint(word) {
  return word
    .split(" ")
    .map((part) => part.split("").map((ch, i) => (i === 0 || !/[a-z]/i.test(ch) ? ch : "_")).join(" "))
    .join("   ");
}

/**
 * テストの問題を組み立てる。
 * @param {object[]} vocab   その級の全単語（誤答はここから選ぶ）
 * @param {object[]} words   出題範囲の単語
 * @param {object}   opts    { format, count }（count は数値か "all"）
 */
export function buildVocabTest(vocab, words, { format = "en2ja", count = 20 } = {}, rand = Math.random) {
  const n = count === "all" ? words.length : Math.min(Number(count) || 0, words.length);
  const picked = shuffle(words, rand).slice(0, n);
  const kinds = format === "mix" ? ["en2ja", "ja2en", "spell"] : [format];
  return picked.map((w, i) => {
    const kind = format === "mix" ? kinds[(i + randInt(3, rand)) % 3] : kinds[0];
    const q = { wordId: w.id, kind };
    if (kind === "spell") {
      // 同じ意味の別の語（例：chance／opportunity）を書いても正解にする
      q.accept = [
        ...new Set(
          [w, ...vocab.filter((x) => x.id !== w.id && x.meaning === w.meaning)].map((x) => normalizeSpelling(x.word))
        ),
      ];
      return q;
    }
    const wrongs = pickDistractors(w, vocab, rand);
    const field = kind === "en2ja" ? "meaning" : "word";
    q.choices = shuffle([w, ...wrongs], rand).map((x) => ({ text: x[field], wordId: x.id, correct: x.id === w.id }));
    return q;
  });
}

/** answers[i]：選択問題は選んだ番号、スペル問題は入力した文字列。未解答は null */
export function isAnswerCorrect(q, answer) {
  if (answer == null || answer === "") return false;
  if (q.kind === "spell") return q.accept.includes(normalizeSpelling(answer));
  const c = q.choices[answer];
  return !!(c && c.correct);
}

export function answerText(q, answer) {
  if (answer == null || answer === "") return "（未解答）";
  if (q.kind === "spell") return String(answer);
  return (q.choices[answer] || {}).text || "（未解答）";
}

export function gradeVocabTest(questions, answers) {
  const marks = questions.map((q, i) => isAnswerCorrect(q, answers[i]));
  const correct = marks.filter(Boolean).length;
  const total = questions.length;
  const unanswered = questions.filter((_, i) => answers[i] == null || answers[i] === "").length;
  return {
    marks,
    correct,
    total,
    unanswered,
    percent: total ? Math.round((correct / total) * 100) : 0,
    wrongIds: questions.filter((_, i) => !marks[i]).map((q) => q.wordId),
  };
}

/* ------------------------------------------------------------
   結果の保存
   ------------------------------------------------------------ */

function emptyStore() {
  return { levels: {}, updatedAt: null };
}

export function loadVocabTestResults() {
  try {
    const raw = window.localStorage.getItem(learnerKey(STORAGE_KEY));
    if (!raw) return emptyStore();
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !parsed.levels) return emptyStore();
    return parsed;
  } catch (e) {
    return emptyStore();
  }
}

/**
 * 1回ぶんを保存する（新しい順、級ごとに 50 回まで）。
 * result: { format, range, count, correct, total, percent, wrongIds, elapsedSec }
 */
export function saveVocabTestResult(level, result) {
  const store = loadVocabTestResults();
  const list = Array.isArray(store.levels[level]) ? store.levels[level] : [];
  const record = { ...result, at: result.at || new Date().toISOString() };
  list.unshift(record);
  if (list.length > MAX_RESULTS_PER_LEVEL) list.length = MAX_RESULTS_PER_LEVEL;
  store.levels[level] = list;
  store.updatedAt = record.at;
  try {
    window.localStorage.setItem(learnerKey(STORAGE_KEY), JSON.stringify(store));
  } catch (e) {
    // localStorage が使えない環境では静かに諦める（ほかの記録と同じ方針）
  }
  return record;
}

/** その級の結果。新しい順 */
export function getVocabTestResults(level) {
  const list = loadVocabTestResults().levels[level];
  return Array.isArray(list) ? list : [];
}

/** 得点推移のグラフ用：古い順に直近 n 回 */
export function getVocabTestTrend(level, n = 20) {
  return getVocabTestResults(level).slice(0, n).reverse();
}

export function summarizeVocabTests(level) {
  const list = getVocabTestResults(level);
  if (!list.length) return null;
  const best = list.reduce((b, r) => (r.percent > b.percent ? r : b), list[0]);
  const recent = list.slice(0, 5);
  const avg = Math.round(recent.reduce((s, r) => s + r.percent, 0) / recent.length);
  return { count: list.length, last: list[0], best, recentAvg: avg };
}
