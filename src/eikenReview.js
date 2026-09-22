/* ============================================================
   英検アプリ：間違えた問題の記録（復習リスト・localStorage）

   eikenProgress.js が「何問やったか」を記録するのに対し、
   こちらは「どの問題をまだ克服していないか」を記録する。

   ルール：
   - 間違えたら復習リストに入る（すでに入っていれば間違い回数を+1）
   - 正解しても、2回連続で正解するまではリストに残る
   - 2回連続で正解したら「克服」としてリストから消える
   ============================================================ */

const STORAGE_KEY = "eikenReviewV1";

/** 復習ドリルとして出題し直せるモードだけを対象にする。
 *  発音練習（採点が主観的）と模擬テスト（問題IDが通し番号）は対象外。 */
const REVIEWABLE_MODES = ["vocab", "grammar", "reading", "listening", "dialogue"];

/** 2回連続正解で克服とみなす */
const MASTERY_STREAK = 2;

/** 1レベルあたりの上限。古い（最後に間違えてから時間が経った）ものから捨てる。 */
const MAX_ENTRIES_PER_LEVEL = 300;

export function isReviewableMode(mode) {
  return REVIEWABLE_MODES.includes(mode);
}

function emptyStore() {
  return { levels: {}, updatedAt: null };
}

function loadStore() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyStore();
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !parsed.levels) return emptyStore();
    return parsed;
  } catch (e) {
    return emptyStore();
  }
}

function saveStore(store) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch (e) {
    // localStorageが使えない環境では静かに諦める（進捗記録と同じ方針）
  }
}

function keyOf(mode, itemId) {
  return `${mode}::${itemId}`;
}

function trim(list) {
  if (list.length <= MAX_ENTRIES_PER_LEVEL) return list;
  const sorted = [...list].sort((a, b) => (b.lastWrongAt || "").localeCompare(a.lastWrongAt || ""));
  return sorted.slice(0, MAX_ENTRIES_PER_LEVEL);
}

/**
 * 1問答えるたびに、進捗記録と並べて呼ぶ。
 * 復習対象外のモードでは何もしない。
 */
export function recordReviewResult(level, mode, itemId, isCorrect) {
  if (!isReviewableMode(mode) || itemId == null) return;

  const store = loadStore();
  const list = store.levels[level] || [];
  const key = keyOf(mode, itemId);
  const at = new Date().toISOString();
  const found = list.find((e) => e.key === key);

  if (!isCorrect) {
    if (found) {
      found.wrongCount += 1;
      found.streak = 0;
      found.lastWrongAt = at;
    } else {
      list.push({ key, mode, itemId, wrongCount: 1, streak: 0, lastWrongAt: at });
    }
    store.levels[level] = trim(list);
  } else if (found) {
    found.streak += 1;
    if (found.streak >= MASTERY_STREAK) {
      // 克服したのでリストから外す
      store.levels[level] = list.filter((e) => e.key !== key);
    } else {
      store.levels[level] = list;
    }
  } else {
    // 一度も間違えていない問題に正解しただけ。記録することはない。
    return;
  }

  store.updatedAt = at;
  saveStore(store);
}

/** そのレベルの復習リスト全件。間違いが多い順、同数なら最近間違えた順。 */
export function getReviewEntries(level) {
  const list = loadStore().levels[level] || [];
  return [...list].sort(
    (a, b) => b.wrongCount - a.wrongCount || (b.lastWrongAt || "").localeCompare(a.lastWrongAt || "")
  );
}

/** そのレベル・そのモードで復習待ちの問題ID（Set） */
export function getReviewItemIds(level, mode) {
  return new Set(getReviewEntries(level).filter((e) => e.mode === mode).map((e) => e.itemId));
}

export function getReviewCount(level) {
  return (loadStore().levels[level] || []).length;
}

/** モードごとの件数。{ grammar: 3, vocab: 1, ... } */
export function getReviewCountByMode(level) {
  const counts = {};
  (loadStore().levels[level] || []).forEach((e) => {
    counts[e.mode] = (counts[e.mode] || 0) + 1;
  });
  return counts;
}

export function clearLevelReview(level) {
  const store = loadStore();
  delete store.levels[level];
  store.updatedAt = new Date().toISOString();
  saveStore(store);
}

export function clearAllReview() {
  saveStore(emptyStore());
}
