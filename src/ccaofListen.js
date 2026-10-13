/* ============================================================
   CCAO-F 音声モードの学習記録（v1.32.0〜）

   聞いただけでは「解いた」ことにしない。正答率・弱点判定・錯題本・
   合格予測は答えた結果から出しているので、聞いた分を混ぜると壊れる。
   そこで別のキーに「何をいつ聞いたか」だけを残す。
   - 問題・讲义：このファイル（ccaofListenV1）
   - 頻出単語：単語の記録（ccaofVocabV1）にも listens を足す
     （聞いた単語が「学習した単語」「まだ習熟していない単語」に入り、
       あとでテストで確かめられるように。習熟は変えない）
   どちらもバックアップ（ccaofBackup.js）の対象。
   ============================================================ */

import { learnerKey } from "./learner";

export const LISTEN_KEY = "ccaofListenV1";
/** これより古い日の集計は捨てる（studyLog と同じ） */
const MAX_DAYS = 365;

function localDateKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function emptyStore() {
  return { items: {}, lessons: {}, words: {}, daily: {}, updatedAt: null };
}

export function loadListenStore() {
  try {
    const raw = window.localStorage.getItem(learnerKey(LISTEN_KEY));
    if (!raw) return emptyStore();
    const p = JSON.parse(raw);
    if (!p || typeof p !== "object") return emptyStore();
    return { items: p.items || {}, lessons: p.lessons || {}, words: p.words || {}, daily: p.daily || {}, updatedAt: p.updatedAt || null };
  } catch (e) {
    return emptyStore();
  }
}

function save(store) {
  try {
    window.localStorage.setItem(learnerKey(LISTEN_KEY), JSON.stringify(store));
  } catch (e) {
    // 保存できなくても聞くこと自体は続けられる
  }
}

const BUCKET = { item: "items", lesson: "lessons", word: "words" };

/** 1トラック（問題1問・讲义1つ・単語1語）を最後まで聞いたら呼ぶ */
export function recordListen(kind, id, now = new Date()) {
  const bucket = BUCKET[kind];
  if (!bucket || !id) return;
  const store = loadListenStore();
  const at = now.toISOString();
  const e = store[bucket][id] || { n: 0 };
  e.n += 1;
  e.lastAt = at;
  store[bucket][id] = e;
  const date = localDateKey(now);
  const d = store.daily[date] || (store.daily[date] = { items: 0, lessons: 0, words: 0 });
  d[bucket] = (d[bucket] || 0) + 1;
  const dates = Object.keys(store.daily).sort();
  dates.slice(0, Math.max(0, dates.length - MAX_DAYS)).forEach((k) => delete store.daily[k]);
  store.updatedAt = at;
  save(store);
}

/** 学習記録の画面に出す集計 */
export function getListenSummary(now = new Date()) {
  const store = loadListenStore();
  const today = store.daily[localDateKey(now)] || { items: 0, lessons: 0, words: 0 };
  return {
    items: Object.keys(store.items).length,
    lessons: Object.keys(store.lessons).length,
    words: Object.keys(store.words).length,
    today: (today.items || 0) + (today.lessons || 0) + (today.words || 0),
    days: Object.keys(store.daily).length,
  };
}

export function resetListen() {
  save(emptyStore());
}
