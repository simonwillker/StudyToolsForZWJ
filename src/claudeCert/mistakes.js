/* ============================================================
   Claude 認定：錯題本（まちがえた問題の間隔復習）の保存

   計算は studyCore.js、ここは localStorage との出し入れだけ。
   勉強者ごと・資格ごとに別キー（learnerKey＋certKey）。バックアップの対象（backup.js）。
   CCAO-F のキーは v1.31.0 までと同じ ccaofMistakesV1。

   ドメイン画面の「復習する」（ccaofReviewV1。1回正解で外れる）は
   そのまま残す。錯題本は日をあけて出し直すための別の仕組み。
   初めて読むときに、ccaofReviewV1 に残っている問題を移す。
   ============================================================ */

import { learnerKey } from "../learner";
import { certKey } from "./certState";
import {
  applyMistakeAnswer,
  dateKeyOf,
  dueMistakeIds,
  emptyMistakes,
  migrateMistakes,
  normalizeMistakes,
} from "./studyCore";

/** いま開いている資格の錯題本のキー（CCAO-F は "ccaofMistakesV1"） */
export const mistakesKey = () => certKey("MistakesV1");
const oldReviewKey = () => certKey("ReviewV1");

function readRaw(key) {
  try {
    const raw = window.localStorage.getItem(learnerKey(key));
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function write(store) {
  try {
    window.localStorage.setItem(learnerKey(mistakesKey()), JSON.stringify(store));
  } catch (e) {
    // 保存できなくても出題は続ける
  }
}

export function todayKey() {
  return dateKeyOf(new Date());
}

/** 錯題本を読む。旧形式の復習リストがまだ移されていなければ、ここで移す */
export function loadMistakes(today = todayKey()) {
  const raw = readRaw(mistakesKey());
  const store = normalizeMistakes(raw);
  if (store.migratedReview) return store;
  const migrated = migrateMistakes(store, readRaw(oldReviewKey()), today);
  write(migrated);
  return migrated;
}

/** 1問の答えを反映する。模擬試験・領域練習・考点練習・今日の復習のどこからでも呼ぶ */
export function recordMistakeAnswer(item, isCorrect, today = todayKey()) {
  if (!item || !item.id) return;
  write(applyMistakeAnswer(loadMistakes(today), item, isCorrect, today));
}

export function getDueMistakeIds(today = todayKey()) {
  return dueMistakeIds(loadMistakes(today), today);
}

export function getMistakeSummary(today = todayKey()) {
  const store = loadMistakes(today);
  const ids = Object.keys(store.items);
  return {
    total: ids.length,
    due: dueMistakeIds(store, today).length,
    ids: new Set(ids),
    store,
  };
}

export function resetMistakes() {
  // 旧リストも同時に消されるので、移行済みの印をつけた空の状態にする
  write({ ...emptyMistakes(), migratedReview: true });
}
