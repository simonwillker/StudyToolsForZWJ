/* ============================================================
   CCAO-F 頻出単語：学習記録と復習リスト

   問題演習の記録（ccaofProgress.js）とは別のキーに置く。
   単語テストの結果でドメイン別の正答率や弱点判定が動くと困るため。

   ルール（英検の復習リスト eikenReview.js と同じ）：
   - テストで間違えた、または単語カードで「まだ」を押したら復習リストに入る
   - 復習リストの単語は、2回連続で正解したら「克服」として外れる
   - 2回連続で正解した単語は「習熟」。間違えたらまた未習熟に戻る
   ============================================================ */

import { learnerKey } from "./learner";
import { recordStudy } from "./studyLog";

export const VOCAB_KEY = "ccaofVocabV1";
const MASTERY_STREAK = 2;
const STUDY_APP = "CCAO-F 対策";

function emptyStore() {
  return { words: {}, review: {}, updatedAt: null };
}

export function loadVocabStore() {
  try {
    const raw = window.localStorage.getItem(learnerKey(VOCAB_KEY));
    if (!raw) return emptyStore();
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return emptyStore();
    return { words: parsed.words || {}, review: parsed.review || {}, updatedAt: parsed.updatedAt || null };
  } catch (e) {
    return emptyStore();
  }
}

function save(store) {
  store.updatedAt = new Date().toISOString();
  try {
    window.localStorage.setItem(learnerKey(VOCAB_KEY), JSON.stringify(store));
  } catch (e) {
    // localStorage が使えない環境では記録を諦める。出題そのものは動き続ける
  }
}

function addToReview(store, id, at) {
  const r = store.review[id] || { wrongCount: 0, streak: 0, lastWrongAt: null };
  r.wrongCount += 1;
  r.streak = 0;
  r.lastWrongAt = at;
  store.review[id] = r;
}

/** テストで1問答えるたびに呼ぶ。studyLabel は勉強履歴に出す内容 */
export function recordVocabAnswer(id, isCorrect, studyLabel) {
  recordStudy(STUDY_APP, studyLabel || "頻出単語", isCorrect);
  const store = loadVocabStore();
  const at = new Date().toISOString();
  const w = store.words[id] || { seen: 0, correct: 0, streak: 0 };
  w.seen += 1;
  w.lastAt = at;
  if (isCorrect) {
    w.correct += 1;
    w.streak = (w.streak || 0) + 1;
    const r = store.review[id];
    if (r) {
      r.streak += 1;
      if (r.streak >= MASTERY_STREAK) delete store.review[id];
    }
  } else {
    w.streak = 0;
    addToReview(store, id, at);
  }
  store.words[id] = w;
  save(store);
}

/** 単語カードの「覚えた／まだ」。テストの正誤とは数えない */
export function markStudied(id, known) {
  const store = loadVocabStore();
  const at = new Date().toISOString();
  const w = store.words[id] || { seen: 0, correct: 0, streak: 0 };
  w.studiedAt = at;
  w.known = !!known;
  store.words[id] = w;
  if (!known) addToReview(store, id, at);
  save(store);
}

export function isMastered(entry) {
  return !!entry && (entry.streak || 0) >= MASTERY_STREAK;
}

/** 復習リストの単語 id。間違いが多い順、同じなら最近まちがえた順 */
export function getVocabReviewIds() {
  const review = loadVocabStore().review;
  return Object.keys(review).sort(
    (a, b) =>
      review[b].wrongCount - review[a].wrongCount ||
      String(review[b].lastWrongAt || "").localeCompare(String(review[a].lastWrongAt || ""))
  );
}

/** 一度でも学習した（カードを見た・テストに出た）のに、まだ習熟していない単語 id */
export function getUnmasteredIds() {
  const words = loadVocabStore().words;
  return Object.keys(words).filter((id) => !isMastered(words[id]));
}

/** 画面に出す集計。total は収録語数（vocab.json を読むまで分からないので渡してもらう） */
export function getVocabSummary() {
  const store = loadVocabStore();
  let attempted = 0;
  let correct = 0;
  let mastered = 0;
  let touched = 0;
  Object.values(store.words).forEach((w) => {
    attempted += w.seen || 0;
    correct += w.correct || 0;
    if (isMastered(w)) mastered += 1;
    touched += 1;
  });
  return { attempted, correct, mastered, touched, reviewCount: Object.keys(store.review).length };
}

export function resetVocabProgress() {
  save(emptyStore());
}
