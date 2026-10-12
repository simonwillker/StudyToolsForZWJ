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

/**
 * 1問ぶんを記録する。
 * @param {string} app   アプリ名（例：「英検マスター」）
 * @param {string} label 内容（例：「3級 単語・熟語」）
 */
export function recordStudy(app, label, isCorrect) {
  const store = loadStudyLog();
  const now = new Date();
  const date = localDateKey(now);
  const at = now.toISOString();
  const day = store.days[date] || (store.days[date] = { entries: {} });
  const key = `${app}｜${label}`;
  const e = day.entries[key] || (day.entries[key] = { app, label, attempted: 0, correct: 0, firstAt: at, lastAt: at });
  e.attempted += 1;
  if (isCorrect) e.correct += 1;
  e.lastAt = at;

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
 * 勉強履歴を記録し始める前の日を、各アプリの既存の記録から組み立てる。
 * 英検マスターは問題ごとの履歴（級・モード・時刻つき、各100問まで）から内訳を作り、
 * 履歴に残っていない分は日別合計との差を「内訳なし」としてまとめる。
 * CCAO-F は日別合計しかないので合計だけ。
 */
function legacyDays(learner) {
  const out = {};
  const add = (date, entry) => {
    const day = out[date] || (out[date] = { entries: {} });
    const key = `${entry.app}｜${entry.label}`;
    const e = day.entries[key] || (day.entries[key] = { app: entry.app, label: entry.label, attempted: 0, correct: 0, firstAt: entry.at, lastAt: entry.at, legacy: true });
    e.attempted += entry.attempted;
    e.correct += entry.correct;
    if (entry.at && (!e.firstAt || entry.at < e.firstAt)) e.firstAt = entry.at;
    if (entry.at && (!e.lastAt || entry.at > e.lastAt)) e.lastAt = entry.at;
  };

  const eiken = readJson(learnerKey("eikenProgressV1", learner));
  if (eiken && eiken.levels) {
    const counted = {};
    Object.entries(eiken.levels).forEach(([level, modes]) => {
      const levelLabel = (LEVEL_META.find((l) => l.level === level) || {}).levelLabel || level;
      Object.entries(modes || {}).forEach(([mode, bucket]) => {
        (bucket.history || []).forEach((h) => {
          if (!h.at) return;
          const date = localDateKey(new Date(h.at));
          const c = counted[date] || (counted[date] = { attempted: 0, correct: 0 });
          c.attempted += 1;
          if (h.correct) c.correct += 1;
          add(date, { app: "英検マスター", label: `${levelLabel} ${EIKEN_MODE_LABELS[mode] || mode}`, attempted: 1, correct: h.correct ? 1 : 0, at: h.at });
        });
      });
    });
    Object.entries(eiken.daily || {}).forEach(([date, d]) => {
      const c = counted[date] || { attempted: 0, correct: 0 };
      const rest = (d.attempted || 0) - c.attempted;
      const restCorrect = Math.min(rest, Math.max(0, (d.correct || 0) - c.correct));
      if (rest > 0) add(date, { app: "英検マスター", label: "（内訳なし）", attempted: rest, correct: restCorrect, at: null });
    });
  }

  const ccaof = readJson(learnerKey("ccaofProgressV1", learner));
  Object.entries((ccaof && ccaof.daily) || {}).forEach(([date, d]) => {
    if (d.attempted) add(date, { app: "CCAO-F 対策", label: "（内訳なし）", attempted: d.attempted, correct: d.correct || 0, at: null });
  });
  return out;
}

/** 画面表示用：新しい日から順に、その日の合計と内容の一覧 */
export function getDailySummaries(learner) {
  const log = loadStudyLog(learner).days;
  // 記録を始めた日より前だけ、既存の記録から補う（同じ日を二重に数えないため）
  const started = Object.keys(log).sort()[0] || "9999-99-99";
  const days = { ...log };
  Object.entries(legacyDays(learner)).forEach(([date, d]) => {
    if (date < started) days[date] = d;
  });
  return Object.keys(days)
    .sort()
    .reverse()
    .map((date) => {
      // 時刻順。時刻のない「内訳なし」は最後
      const entries = Object.values(days[date].entries || {}).sort((a, b) => {
        const x = a.firstAt || "~";
        const y = b.firstAt || "~";
        return x < y ? -1 : x > y ? 1 : 0;
      });
      const attempted = entries.reduce((s, e) => s + e.attempted, 0);
      const correct = entries.reduce((s, e) => s + e.correct, 0);
      const firstAt = entries.reduce((m, e) => (e.firstAt && (!m || e.firstAt < m) ? e.firstAt : m), null);
      const lastAt = entries.reduce((m, e) => (e.lastAt && (!m || e.lastAt > m) ? e.lastAt : m), null);
      const legacy = entries.some((e) => e.legacy);
      return { date, entries, attempted, correct, firstAt, lastAt, legacy };
    });
}
