/* ============================================================
   勉強者（だれが勉強しているか）

   起動するたびに勉強者を選んでから始める。選んだ人はそのタブの
   sessionStorage に持つので、タブを閉じるとまた選び直しになる。

   学習記録（localStorage）は勉強者ごとに別のキーへ保存する。
   ZWJ は以前からのキーをそのまま使うので、これまでの記録は
   移しかえなしで ZWJ の記録として残る。ほかの人は "<キー>::<名前>"。
   ============================================================ */

export const LEARNERS = [
  { id: "ZWJ", label: "ZWJ", color: "#2F7A4F" },
  { id: "ZY", label: "ZY", color: "#2F5D8A" },
  { id: "Guest", label: "Guest", color: "#6B7280" },
];

/** これまでの記録の持ち主。この人だけはキーに名前をつけない */
const DEFAULT_LEARNER = "ZWJ";
const SESSION_KEY = "studyToolsLearner";
/** 前回選んだ人。選択画面で目立たせるだけに使う */
const LAST_KEY = "studyToolsLastLearner";

function isLearner(id) {
  return LEARNERS.some((l) => l.id === id);
}

/** このタブで選ばれている勉強者。まだ選んでいなければ null */
export function getLearner() {
  try {
    const id = window.sessionStorage.getItem(SESSION_KEY);
    return isLearner(id) ? id : null;
  } catch (e) {
    return null;
  }
}

export function setLearner(id) {
  if (!isLearner(id)) return;
  try {
    window.sessionStorage.setItem(SESSION_KEY, id);
    window.localStorage.setItem(LAST_KEY, id);
  } catch (e) {
    // 保存できなくても、この画面のあいだは選んだ人で動く
  }
}

export function clearLearner() {
  try {
    window.sessionStorage.removeItem(SESSION_KEY);
  } catch (e) {
    // 無視
  }
}

export function getLastLearner() {
  try {
    const id = window.localStorage.getItem(LAST_KEY);
    return isLearner(id) ? id : null;
  } catch (e) {
    return null;
  }
}

/** 勉強者 id の localStorage キー。learner を省くと今選ばれている人 */
export function learnerKey(baseKey, learner = getLearner()) {
  if (!learner || learner === DEFAULT_LEARNER) return baseKey;
  return `${baseKey}::${learner}`;
}
