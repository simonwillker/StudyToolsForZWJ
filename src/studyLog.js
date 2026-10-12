/* ============================================================
   勉強履歴：毎日、何をどれだけ勉強したかの概要

   各アプリが1問答えるたびに recordStudy() を呼ぶ。日付ごと・
   「アプリ＋内容」ごとに、解いた数・正解数・最初と最後の時刻を
   まとめて残す（問題そのものは残さない）。勉強者ごとに別に保存する。
   ============================================================ */

import { learnerKey } from "./learner";
import { LEVEL_META } from "./eikenLevels";

/** 英検マスターのモード名。EikenApp.jsx の MODES と同じ表記 */
export const EIKEN_MODE_LABELS = {
  vocab: "単語・熟語",
  phrases: "常用短句",
  grammar: "文法・穴うめ",
  reading: "長文読解",
  listening: "リスニング",
  dialogue: "会話文",
  pronunciation: "発音練習",
  test: "模擬テスト",
};

const STORAGE_KEY = "studyLogV1";
/** これより古い日の記録は捨てる */
const MAX_DAYS = 365;

function localDateKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function emptyStore() {
  return { days: {}, updatedAt: null };
}

/** learner を省くと今選ばれている人の履歴 */
export function loadStudyLog(learner) {
  try {
    const raw = window.localStorage.getItem(learnerKey(STORAGE_KEY, learner));
    if (!raw) return emptyStore();
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !parsed.days) return emptyStore();
    return parsed;
  } catch (e) {
    return emptyStore();
  }
}

/** 次に答えた問題から新しい回（テスト1回ぶん）として記録する。各アプリが出題を始めるときに呼ぶ */
let forceNewSession = true;
export function newStudySession() {
  forceNewSession = true;
}

/** 呼び忘れても回が分かれるように、内容が変わったときと、これだけ間があいたときも新しい回にする */
const SESSION_GAP_MS = 30 * 60 * 1000;
/** 1回ぶんの ⭕❌ を何問まで残すか（「すべて」で500問解くような場合に備えて） */
const MAX_MARKS = 200;

/**
 * 1問ぶんを記録する。日ごとに「回」（sessions）として残し、
 * 各回に内容・始めと終わりの時刻・⭕❌の並びを持つ。
 * @param {string} app   アプリ名（例：「英検マスター」）
 * @param {string} label 内容（例：「3級 単語・熟語」）
 */
export function recordStudy(app, label, isCorrect) {
  const store = loadStudyLog();
  const now = new Date();
  const date = localDateKey(now);
  const at = now.toISOString();
  const day = store.days[date] || (store.days[date] = {});
  if (!Array.isArray(day.sessions)) day.sessions = [];

  let cur = day.sessions[day.sessions.length - 1];
  const continues =
    cur && !forceNewSession && cur.app === app && cur.label === label && now - new Date(cur.endAt) < SESSION_GAP_MS;
  if (!continues) {
    cur = { app, label, startAt: at, endAt: at, attempted: 0, correct: 0, marks: "" };
    day.sessions.push(cur);
  }
  forceNewSession = false;
  cur.attempted += 1;
  if (isCorrect) cur.correct += 1;
  cur.endAt = at;
  if (cur.marks.length < MAX_MARKS) cur.marks += isCorrect ? "o" : "x";

  const dates = Object.keys(store.days).sort();
  dates.slice(0, Math.max(0, dates.length - MAX_DAYS)).forEach((d) => delete store.days[d]);
  store.updatedAt = at;
  try {
    window.localStorage.setItem(learnerKey(STORAGE_KEY), JSON.stringify(store));
  } catch (e2) {
    // 保存できなくても学習そのものは続けられる
  }
}

function readJson(key) {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

/**
 * 勉強履歴を記録し始める前の日を、各アプリの既存の記録から組み立てる（日付 → 回の配列）。
 * 英検マスターは問題ごとの履歴（級・モード・正誤・時刻つき、各100問まで）があるので、
 * 30分以上あいだがあくか内容が変わるところで回に分け、⭕❌も復元する。
 * 履歴に残っていない分は日別合計との差を「内訳なし」としてまとめる。
 * CCAO-F は日別合計しかないので合計だけ。
 */
function legacyDays(learner) {
  const out = {};
  const push = (date, session) => (out[date] || (out[date] = [])).push({ ...session, legacy: true });

  const eiken = readJson(learnerKey("eikenProgressV1", learner));
  if (eiken && eiken.levels) {
    const counted = {};
    Object.entries(eiken.levels).forEach(([level, modes]) => {
      const levelLabel = (LEVEL_META.find((l) => l.level === level) || {}).levelLabel || level;
      Object.entries(modes || {}).forEach(([mode, bucket]) => {
        const label = `${levelLabel} ${EIKEN_MODE_LABELS[mode] || mode}`;
        // history は新しい順なので、古い順に並べ直して回に分ける
        const hs = (bucket.history || []).filter((h) => h.at).slice().reverse();
        let cur = null;
        let curDate = null;
        hs.forEach((h) => {
          const date = localDateKey(new Date(h.at));
          const c = counted[date] || (counted[date] = { attempted: 0, correct: 0 });
          c.attempted += 1;
          if (h.correct) c.correct += 1;
          if (!cur || curDate !== date || new Date(h.at) - new Date(cur.endAt) >= SESSION_GAP_MS) {
            cur = { app: "英検マスター", label, startAt: h.at, endAt: h.at, attempted: 0, correct: 0, marks: "" };
            curDate = date;
            push(date, cur);
            cur = out[date][out[date].length - 1];
          }
          cur.attempted += 1;
          if (h.correct) cur.correct += 1;
          cur.endAt = h.at;
          if (cur.marks.length < MAX_MARKS) cur.marks += h.correct ? "o" : "x";
        });
      });
    });
    Object.entries(eiken.daily || {}).forEach(([date, d]) => {
      const c = counted[date] || { attempted: 0, correct: 0 };
      const rest = (d.attempted || 0) - c.attempted;
      const restCorrect = Math.min(rest, Math.max(0, (d.correct || 0) - c.correct));
      if (rest > 0) push(date, { app: "英検マスター", label: "（内訳なし）", startAt: null, endAt: null, attempted: rest, correct: restCorrect, marks: null });
    });
  }

  const ccaof = readJson(learnerKey("ccaofProgressV1", learner));
  Object.entries((ccaof && ccaof.daily) || {}).forEach(([date, d]) => {
    if (d.attempted) push(date, { app: "CCAO-F 対策", label: "（内訳なし）", startAt: null, endAt: null, attempted: d.attempted, correct: d.correct || 0, marks: null });
  });
  return out;
}

/** 古い形（日ごとの合計 entries）を、⭕❌の並びのない「回」に直す */
function entriesToSessions(entries) {
  return Object.values(entries || {}).map((e) => ({
    app: e.app,
    label: e.label,
    startAt: e.firstAt || null,
    endAt: e.lastAt || null,
    attempted: e.attempted,
    correct: e.correct,
    marks: null,
    legacy: !!e.legacy,
  }));
}

/**
 * 画面表示用：新しい日から順に、その日の回の一覧と合計。
 * 各回には、その日のうちで同じ内容を何回目にやったか（round）をつける。
 */
export function getDailySummaries(learner) {
  const log = loadStudyLog(learner).days;
  // 記録を始めた日より前だけ、既存の記録から補う（同じ日を二重に数えないため）
  const started = Object.keys(log).sort()[0] || "9999-99-99";
  const days = {};
  Object.entries(log).forEach(([date, d]) => {
    days[date] = [...entriesToSessions(d.entries), ...(d.sessions || [])];
  });
  Object.entries(legacyDays(learner)).forEach(([date, sessions]) => {
    if (date < started) days[date] = sessions;
  });
  return Object.keys(days)
    .sort()
    .reverse()
    .map((date) => {
      // 時刻順。時刻のない「内訳なし」は最後
      const sessions = days[date].sort((a, b) => {
        const x = a.startAt || "~";
        const y = b.startAt || "~";
        return x < y ? -1 : x > y ? 1 : 0;
      });
      const rounds = {};
      sessions.forEach((x) => {
        const k = `${x.app}｜${x.label}`;
        rounds[k] = (rounds[k] || 0) + 1;
        x.round = rounds[k];
      });
      const attempted = sessions.reduce((n, x) => n + x.attempted, 0);
      const correct = sessions.reduce((n, x) => n + x.correct, 0);
      const firstAt = sessions.reduce((m, x) => (x.startAt && (!m || x.startAt < m) ? x.startAt : m), null);
      const lastAt = sessions.reduce((m, x) => (x.endAt && (!m || x.endAt > m) ? x.endAt : m), null);
      const legacy = sessions.some((x) => x.legacy);
      return { date, sessions, tests: sessions.length, attempted, correct, firstAt, lastAt, legacy };
    });
}
