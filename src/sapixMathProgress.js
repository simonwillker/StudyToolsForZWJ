/* ============================================================
   Sapix 算数：学習記録と復習リスト

   ccaofProgress.js と同じ考え方。軸は「単元」。
   英検・CCAO-F とは別のキーに保存して、記録が混ざらないようにする。
   勉強者ごとに分けるのも同じ（learnerKey）。
   ============================================================ */

import { learnerKey } from "./learner";
import { findUnit } from "./sapixMathUnits";
import { recordStudy } from "./studyLog";

export const PROGRESS_KEY = "sapixMathProgressV1";
export const REVIEW_KEY = "sapixMathReviewV1";
const APP_LABEL = "Sapix 算数";

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

export function loadProgress() {
  const p = read(PROGRESS_KEY, null);
  if (!p || !p.units || !p.daily) return { units: {}, daily: {} };
  return p;
}

/** 1問答えるごとに呼ぶ。review は「まちがえた問題だけ」で解いているとき */
export function recordAnswer(unitId, itemId, isCorrect, review = false) {
  const unit = findUnit(unitId);
  const label = unit ? unit.label : unitId;
  recordStudy(APP_LABEL, review ? `${label}（復習）` : label, isCorrect);

  const store = loadProgress();
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
  write(PROGRESS_KEY, store);

  // 復習リスト：まちがえたら入れ、正解したら外す
  const rv = loadReview();
  const list = rv[unitId] || [];
  const idx = list.indexOf(itemId);
  if (isCorrect && idx >= 0) list.splice(idx, 1);
  if (!isCorrect && idx < 0) list.push(itemId);
  rv[unitId] = list;
  write(REVIEW_KEY, rv);
}

/** 20問を通して解き終えたときの点数を残す（単元一覧に「前回」として出す） */
export function recordRun(unitId, correct, total) {
  const store = loadProgress();
  const u = store.units[unitId];
  if (!u) return;
  u.lastRun = { correct, total, at: new Date().toISOString() };
  if (!u.bestRun || correct > u.bestRun.correct) u.bestRun = { correct, total };
  write(PROGRESS_KEY, store);
}

export function getUnitStats(unitId) {
  const u = loadProgress().units[unitId];
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

export function getStreak() {
  const daily = loadProgress().daily;
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

export function getTodayStats() {
  return loadProgress().daily[localDateKey()] || { attempted: 0, correct: 0 };
}

export function loadReview() {
  return read(REVIEW_KEY, {});
}

export function getReviewIds(unitId) {
  return loadReview()[unitId] || [];
}

export function getTotalReviewCount() {
  return Object.values(loadReview()).reduce((n, list) => n + (Array.isArray(list) ? list.length : 0), 0);
}

export function resetProgress() {
  write(PROGRESS_KEY, { units: {}, daily: {} });
  write(REVIEW_KEY, {});
}
