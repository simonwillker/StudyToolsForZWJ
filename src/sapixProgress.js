/* ============================================================
   Sapix（学年×科目）：学習記録と復習リスト

   claudeCert/progress.js と同じ考え方。軸は「単元」。教科ごとに別のキー
   （sapixStorage.js の storageKeys。4年は以前からのキーのまま）に保存して、
   ほかのアプリや教科の記録と混ざらないようにする。勉強者ごとに
   分けるのも同じ（learnerKey）。
   ============================================================ */

import { learnerKey } from "./learner";
import { findUnit } from "./sapixSubjects";
import { recordStudy } from "./studyLog";

function read(key, fallback) {
  try {
    const raw = window.localStorage.getItem(learnerKey(key));
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch (e) {
    return fallback;
  }
}

function write(key, value) {
  try {
    window.localStorage.setItem(learnerKey(key), JSON.stringify(value));
  } catch (e) {
    // localStorage が使えない環境では記録をあきらめる。出題は続けられる。
  }
}

export function localDateKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function loadProgress(subject) {
  const p = read(subject.progressKey, null);
  if (!p || !p.units || !p.daily) return { units: {}, daily: {} };
  return p;
}

/** 1問答えるごとに呼ぶ。review は「まちがえた問題だけ」で解いているとき */
export function recordAnswer(subject, unitId, itemId, isCorrect, review = false) {
  const unit = findUnit(subject, unitId);
  const label = unit ? unit.label : unitId;
  recordStudy(subject.logTitle, review ? `${label}（復習）` : label, isCorrect);

  const store = loadProgress(subject);
  const u = store.units[unitId] || { attempted: 0, correct: 0, lastAt: null, items: {} };
  u.attempted += 1;
  if (isCorrect) u.correct += 1;
  u.lastAt = new Date().toISOString();
  const it = u.items[itemId] || { seen: 0, correct: 0 };
  it.seen += 1;
  if (isCorrect) it.correct += 1;
  it.last = isCorrect ? "o" : "x";
  u.items[itemId] = it;
  store.units[unitId] = u;

  const key = localDateKey();
  const day = store.daily[key] || { attempted: 0, correct: 0 };
  day.attempted += 1;
  if (isCorrect) day.correct += 1;
  store.daily[key] = day;
  write(subject.progressKey, store);

  // 復習リスト：まちがえたら入れ、正解したら外す
  const rv = loadReview(subject);
  const list = rv[unitId] || [];
  const idx = list.indexOf(itemId);
  if (isCorrect && idx >= 0) list.splice(idx, 1);
  if (!isCorrect && idx < 0) list.push(itemId);
  rv[unitId] = list;
  write(subject.reviewKey, rv);
}

/** 20問を通して解き終えたときの点数を残す（単元一覧に「前回」として出す） */
export function recordRun(subject, unitId, correct, total) {
  const store = loadProgress(subject);
  const u = store.units[unitId];
  if (!u) return;
  u.lastRun = { correct, total, at: new Date().toISOString() };
  if (!u.bestRun || correct > u.bestRun.correct) u.bestRun = { correct, total };
  write(subject.progressKey, store);
}

export function getUnitStats(subject, unitId) {
  const u = loadProgress(subject).units[unitId];
  return {
    attempted: u ? u.attempted : 0,
    correct: u ? u.correct : 0,
    lastAt: u ? u.lastAt : null,
    lastRun: u ? u.lastRun || null : null,
    bestRun: u ? u.bestRun || null : null,
    items: u ? u.items : {},
  };
}

export function accuracyPercent(stats) {
  if (!stats || !stats.attempted) return null;
  return Math.round((stats.correct / stats.attempted) * 100);
}

export function getStreak(subject) {
  const daily = loadProgress(subject).daily;
  let streak = 0;
  const d = new Date();
  // きょうまだ解いていなくても連続を切らさないよう、きのうから数える
  if (!daily[localDateKey(d)]) d.setDate(d.getDate() - 1);
  for (;;) {
    const k = localDateKey(d);
    if (daily[k] && daily[k].attempted > 0) {
      streak += 1;
      d.setDate(d.getDate() - 1);
    } else break;
  }
  return streak;
}

export function getTodayStats(subject) {
  return loadProgress(subject).daily[localDateKey()] || { attempted: 0, correct: 0 };
}

export function loadReview(subject) {
  return read(subject.reviewKey, {});
}

export function getReviewIds(subject, unitId) {
  return loadReview(subject)[unitId] || [];
}

export function getTotalReviewCount(subject) {
  return Object.values(loadReview(subject)).reduce((n, list) => n + (Array.isArray(list) ? list.length : 0), 0);
}

export function resetProgress(subject) {
  write(subject.progressKey, { units: {}, daily: {} });
  write(subject.reviewKey, {});
}
