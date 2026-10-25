/* ============================================================
   英検アプリ：まちがえた問題の錯題本（今日の復習・localStorage）

   v1.41.0 から CCAO-F（Claude 認定）と同じ錯題本にした。
   - まちがえた問題は 1日後に出す。期限が来てから正解すると 3日後、
     その次は 7日後。2回続けて正解したら外れる（克服）。
   - 期限前の正解は数えない（直後に解き直して正解しても、覚えたかは
     わからないため）。まちがえたら 1日後に戻る。
   - 間隔の計算は claudeCert/studyCore.js の関数をそのまま使う。

   保存は eikenMistakesV1：{ version, migratedReview, levels: { 級: { items: { "mode::itemId": {...} } } } }
   v1.40.0 までの復習リスト（eikenReviewV1。2回連続正解で消える）は、
   初めて読むときに「きょうが期限」の錯題として一度だけ移す。
   旧リストは消さずに残す（古いバックアップとの互換のため）。

   関数名は以前のまま（recordReviewResult など）なので、呼ぶ側は変えなくてよい。
   ============================================================ */

import { learnerKey } from "./learner";
import { applyMistakeAnswer, dateKeyOf, normalizeMistakes, REVIEW_INTERVALS, GRADUATE_STREAK } from "./claudeCert/studyCore";

export { REVIEW_INTERVALS, GRADUATE_STREAK };

const STORAGE_KEY = "eikenReviewV1";
export const MISTAKES_KEY = "eikenMistakesV1";

/** 復習ドリルとして出題し直せるモードだけを対象にする。
 *  発音練習（採点が主観的）と模擬テスト（問題IDが通し番号）は対象外。 */
const REVIEWABLE_MODES = ["vocab", "phrases", "grammar", "reading", "listening", "dialogue"];

/* ---------- v1.40.0 までの復習リスト（読むだけ） ---------- */

function emptyStore() {
  return { levels: {}, updatedAt: null };
}

/** 単語の itemId は以前 "v3-001-en2ja" のように出題方向つきで記録していた。
 *  単語の id（"v3-001"）にそろえ、同じ単語が両方向で入っていたら1件にまとめる。 */
const DIRECTION_SUFFIX = /-(en2ja|ja2en)$/;

function migrateVocabIds(store) {
  Object.keys(store.levels).forEach((level) => {
    const list = store.levels[level];
    if (!Array.isArray(list) || !list.some((e) => e.mode === "vocab" && DIRECTION_SUFFIX.test(String(e.itemId)))) return;
    const merged = [];
    const byKey = new Map();
    list.forEach((e) => {
      const itemId = e.mode === "vocab" ? String(e.itemId).replace(DIRECTION_SUFFIX, "") : e.itemId;
      const key = keyOf(e.mode, itemId);
      const found = byKey.get(key);
      if (!found) {
        const entry = { ...e, key, itemId };
        byKey.set(key, entry);
        merged.push(entry);
        return;
      }
      found.wrongCount += e.wrongCount || 0;
      found.streak = Math.min(found.streak || 0, e.streak || 0);
      if ((e.lastWrongAt || "") > (found.lastWrongAt || "")) found.lastWrongAt = e.lastWrongAt;
    });
    store.levels[level] = merged;
  });
  return store;
}

function loadLegacy() {
  try {
    const raw = window.localStorage.getItem(learnerKey(STORAGE_KEY));
    if (!raw) return emptyStore();
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !parsed.levels) return emptyStore();
    return migrateVocabIds(parsed);
  } catch (e) {
    return emptyStore();
  }
}

function keyOf(mode, itemId) {
  return `${mode}::${itemId}`;
}

/* ---------- 錯題本 ---------- */

export function todayKey(d = new Date()) {
  return dateKeyOf(d);
}

function emptyMistakes() {
  return { version: 1, migratedReview: false, levels: {} };
}

function saveMistakes(store) {
  try {
    window.localStorage.setItem(learnerKey(MISTAKES_KEY), JSON.stringify(store));
  } catch (e) {
    // localStorageが使えない環境では静かに諦める（進捗記録と同じ方針）
  }
}

/** 旧リストを錯題本に移した store を返す（一度だけ） */
export function migrateLegacyReview(store, legacy, today) {
  const next = { ...store, levels: { ...store.levels } };
  if (next.migratedReview) return next;
  Object.entries((legacy && legacy.levels) || {}).forEach(([level, list]) => {
    if (!Array.isArray(list)) return;
    const lv = normalizeMistakes(next.levels[level]);
    list.forEach((e) => {
      if (!e || !isReviewableMode(e.mode) || e.itemId == null) return;
      const key = keyOf(e.mode, e.itemId);
      if (lv.items[key]) return;
      lv.items[key] = { domain: e.mode, addedAt: today, lastAt: today, due: today, streak: 0, corrects: 0, wrongCount: e.wrongCount || 1, migrated: true };
    });
    next.levels[level] = { items: lv.items };
  });
  next.migratedReview = true;
  return next;
}

export function loadMistakes(today = todayKey()) {
  let store = emptyMistakes();
  try {
    const raw = window.localStorage.getItem(learnerKey(MISTAKES_KEY));
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === "object" && parsed.levels && typeof parsed.levels === "object") {
      store = { version: 1, migratedReview: !!parsed.migratedReview, levels: parsed.levels };
    }
  } catch (e) {
    // 壊れていたら空から
  }
  if (store.migratedReview) return store;
  const migrated = migrateLegacyReview(store, loadLegacy(), today);
  saveMistakes(migrated);
  return migrated;
}

function levelItems(store, level) {
  return normalizeMistakes(store.levels[level]).items;
}

export function isReviewableMode(mode) {
  return REVIEWABLE_MODES.includes(mode);
}

/**
 * 1問答えるたびに、進捗記録と並べて呼ぶ。復習対象外のモードでは何もしない。
 * まちがえたら錯題本に入れて 1日後。期限が来てからの正解で間をのばし、2回続けて正解で外す。
 */
export function recordReviewResult(level, mode, itemId, isCorrect, today = todayKey()) {
  if (!isReviewableMode(mode) || itemId == null) return;
  const store = loadMistakes(today);
  const lv = normalizeMistakes(store.levels[level]);
  const next = applyMistakeAnswer(lv, { id: keyOf(mode, itemId), domain: mode }, isCorrect, today);
  store.levels = { ...store.levels, [level]: { items: next.items } };
  saveMistakes(store);
}

function toEntry(key, e) {
  const i = key.indexOf("::");
  return { key, mode: e.domain || key.slice(0, i), itemId: key.slice(i + 2), wrongCount: e.wrongCount || 1, streak: e.streak || 0, due: e.due };
}

/** そのレベルの錯題本の全件。期限の早い順、同じなら間違いが多い順 */
export function getReviewEntries(level, today = todayKey()) {
  const items = levelItems(loadMistakes(today), level);
  return Object.entries(items)
    .map(([k, e]) => toEntry(k, e))
    .sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : b.wrongCount - a.wrongCount));
}

/** きょうが期限（期限切れも含む）のものだけ。「今日の復習」で出す */
export function getDueReviewEntries(level, today = todayKey()) {
  return getReviewEntries(level, today).filter((e) => e.due <= today);
}

/** そのレベル・そのモードの錯題本にある問題ID（Set）。期限に関係なく全部 */
export function getReviewItemIds(level, mode, today = todayKey()) {
  return new Set(getReviewEntries(level, today).filter((e) => e.mode === mode).map((e) => e.itemId));
}

export function getReviewCount(level, today = todayKey()) {
  return Object.keys(levelItems(loadMistakes(today), level)).length;
}

/** { total, due, next }。next は due が 0 のときに次に期限が来る日 */
export function getReviewSummary(level, today = todayKey()) {
  const all = getReviewEntries(level, today);
  const due = all.filter((e) => e.due <= today).length;
  const later = all.filter((e) => e.due > today).map((e) => e.due);
  return { total: all.length, due, next: later[0] || null };
}

/** モードごとの件数。{ grammar: 3, vocab: 1, ... }。dueOnly ならきょう出す分だけ */
export function getReviewCountByMode(level, dueOnly = false, today = todayKey()) {
  const counts = {};
  getReviewEntries(level, today).forEach((e) => {
    if (dueOnly && e.due > today) return;
    counts[e.mode] = (counts[e.mode] || 0) + 1;
  });
  return counts;
}

export function clearLevelReview(level) {
  const store = loadMistakes();
  const levels = { ...store.levels };
  delete levels[level];
  saveMistakes({ ...store, levels });
}

export function clearAllReview() {
  saveMistakes({ version: 1, migratedReview: true, levels: {} });
}
