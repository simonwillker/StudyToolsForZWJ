/* ============================================================
   Sapix：錯題本（間隔復習）とまとめテスト

   CCAO-F（Claude 認定）と同じしくみ。間隔の決め方は
   claudeCert/studyCore.js の関数をそのまま使う（ルールを 1 か所にするため）。

   ■ 錯題本（<科目>MistakesV1）
   - まちがえた問題は 1日後に出す。期限が来てから正解すると 3日後、
     その次は 7日後。2回続けて正解したら外れる。
   - 期限前の正解は数えない（直後に解き直して正解しても、覚えたかは
     わからないため）。
   - v1.40.0 までの復習リスト（<科目>ReviewV1：{ 単元: [id, ...] }）は、
     初めて読むときに「きょうが期限」の錯題として移す。復習リストは
     それ以降は書きかえない（消さずに残すのでバックアップの互換は保たれる）。

   ■ まとめテスト（<科目>TestResultsV1）
   - 単元をえらんで、問題数・制限時間を決めて受ける。答えている間は
     正解を出さず、最後にまとめて採点する。
   - 結果は新しい順に 50 回まで残し、得点推移を出す。

   画面にも Vite にも頼らない（import.meta を使わない）ので、
   node のテスト（scripts/testSapixStudy.mjs）からそのまま読める。
   ============================================================ */

import { learnerKey } from "./learner";
import {
  applyMistakeAnswer,
  dateKeyOf,
  dueMistakeIds,
  migrateMistakes,
  normalizeMistakes,
  REVIEW_INTERVALS,
  GRADUATE_STREAK,
} from "./claudeCert/studyCore";

export { REVIEW_INTERVALS, GRADUATE_STREAK };

function read(key) {
  try {
    const raw = window.localStorage.getItem(learnerKey(key));
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function write(key, value) {
  try {
    window.localStorage.setItem(learnerKey(key), JSON.stringify(value));
  } catch (e) {
    // 保存できなくても出題は続ける
  }
}

export function todayKey(d = new Date()) {
  return dateKeyOf(d);
}

/* ---------- 錯題本 ---------- */

/** 錯題本を読む。旧形式の復習リストがまだ移されていなければ、ここで移す */
export function loadMistakes(subject, today = todayKey()) {
  const store = normalizeMistakes(read(subject.mistakesKey));
  if (store.migratedReview) return store;
  const migrated = migrateMistakes(store, read(subject.reviewKey), today);
  write(subject.mistakesKey, migrated);
  return migrated;
}

/** 1問の答えを反映する。単元練習・今日の復習・まとめテストのどこからでも呼ぶ */
export function recordMistakeAnswer(subject, unitId, itemId, isCorrect, today = todayKey()) {
  const next = applyMistakeAnswer(loadMistakes(subject, today), { id: itemId, domain: unitId }, isCorrect, today);
  write(subject.mistakesKey, next);
  return next;
}

/** 錯題本にある問題の id（その単元だけ／全部）。期限の早い順 */
export function mistakeIds(subject, unitId = null, today = todayKey()) {
  const s = loadMistakes(subject, today);
  return Object.keys(s.items)
    .filter((id) => !unitId || s.items[id].domain === unitId)
    .sort((a, b) => (s.items[a].due < s.items[b].due ? -1 : s.items[a].due > s.items[b].due ? 1 : a.localeCompare(b)));
}

/** きょうが期限（期限切れも含む）の問題。{ id, unitId } の配列、期限の早い順 */
export function dueMistakes(subject, today = todayKey()) {
  const s = loadMistakes(subject, today);
  return dueMistakeIds(s, today).map((id) => ({ id, unitId: s.items[id].domain }));
}

/** 件数のまとめ。total：錯題本の全件、due：きょう出す件数、next：次に期限が来る日（due が 0 のとき） */
export function mistakeSummary(subject, today = todayKey()) {
  const s = loadMistakes(subject, today);
  const all = Object.values(s.items);
  const due = all.filter((e) => e.due <= today).length;
  const later = all.filter((e) => e.due > today).map((e) => e.due).sort();
  return { total: all.length, due, next: later[0] || null };
}

/** 単元ごとの錯題の件数 { 単元: n } */
export function mistakeCountByUnit(subject, today = todayKey()) {
  const counts = {};
  Object.values(loadMistakes(subject, today).items).forEach((e) => {
    counts[e.domain] = (counts[e.domain] || 0) + 1;
  });
  return counts;
}

export function resetMistakes(subject) {
  write(subject.mistakesKey, { version: 1, migratedReview: true, items: {} });
}

/* ---------- まとめテスト ---------- */

export const TEST_COUNTS = [10, 20, 30];
/** 制限時間（分）。0 は時間なし */
export const TEST_MINUTES = [0, 10, 20, 30];

function shuffle(arr, rand = Math.random) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * えらんだ単元から count 問を選ぶ。単元ごとにかたよらないよう、
 * 単元をまわりながら 1 問ずつ取る（単元の中はばらばらの順）。
 * 返す問題には _unit（単元 id）をつける。最後に全体を混ぜる。
 * @param {{ unitId: string, questions: object[] }[]} pools
 */
export function pickTestQuestions(pools, count, rand = Math.random) {
  const queues = shuffle(
    pools.filter((p) => p.questions.length).map((p) => ({ unitId: p.unitId, list: shuffle(p.questions, rand) })),
    rand
  );
  const picked = [];
  let i = 0;
  while (picked.length < count && queues.some((q) => q.list.length)) {
    const q = queues[i % queues.length];
    if (q.list.length) picked.push({ ...q.list.shift(), _unit: q.unitId });
    i += 1;
  }
  return shuffle(picked, rand);
}

/**
 * 採点。check(q, input) は sapixSubjects.js の checkAnswer（{ ok } を返す）。
 * 未解答（answers[i] が空）は不正解。
 */
export function gradeTest(questions, answers, check, isEmpty) {
  const marks = questions.map((q, i) => {
    const a = answers[i];
    if (!a || (isEmpty && isEmpty(q, a))) return false;
    return !!check(q, a).ok;
  });
  const perUnit = {};
  questions.forEach((q, i) => {
    const u = perUnit[q._unit] || (perUnit[q._unit] = { correct: 0, total: 0 });
    u.total += 1;
    if (marks[i]) u.correct += 1;
  });
  const correct = marks.filter(Boolean).length;
  const total = questions.length;
  const unanswered = questions.filter((q, i) => !answers[i] || (isEmpty && isEmpty(q, answers[i]))).length;
  return {
    marks,
    correct,
    total,
    unanswered,
    percent: total ? Math.round((correct / total) * 100) : 0,
    perUnit,
    wrongIds: questions.filter((_, i) => !marks[i]).map((q) => q.id),
  };
}

const MAX_RESULTS = 50;

export function loadTestResults(subject) {
  const v = read(subject.testKey);
  return v && Array.isArray(v.results) ? v.results : [];
}

/** 1回ぶんを保存する（新しい順、50回まで） */
export function saveTestResult(subject, result) {
  const list = loadTestResults(subject);
  const record = { ...result, at: result.at || new Date().toISOString() };
  list.unshift(record);
  if (list.length > MAX_RESULTS) list.length = MAX_RESULTS;
  write(subject.testKey, { version: 1, results: list });
  return record;
}

/** 得点推移のグラフ用：古い順に直近 n 回 */
export function testTrend(subject, n = 20) {
  return loadTestResults(subject).slice(0, n).reverse();
}

export function resetTestResults(subject) {
  write(subject.testKey, { version: 1, results: [] });
}

/** 秒を「m:ss」に */
export function formatClock(sec) {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
