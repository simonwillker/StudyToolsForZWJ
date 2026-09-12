/* ============================================================
   英検 模擬テスト：受験結果の保存（localStorage）
   1回受験するごとに1件のレコードを追加する。
   ============================================================ */

const STORAGE_KEY = "eikenTestResultsV1";
const MAX_RESULTS_PER_LEVEL = 30;

function emptyStore() {
  return { levels: {}, updatedAt: null };
}

export function loadResults() {
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

function save(store) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch (e) {
    // localStorageが使えない環境では静かに諦める
  }
}

/**
 * 受験結果を1件保存する。
 * @param {string} level   級ID（"5" / "4" / "3" / "pre2" / "2" / "pre1" / "1"）
 * @param {object} result  { examMode, correct, total, percent, sections: [{id,part,title,correct,total}], elapsedSec }
 */
export function saveTestResult(level, result) {
  const store = loadResults();
  if (!store.levels[level]) store.levels[level] = [];
  const record = { ...result, at: new Date().toISOString() };
  store.levels[level].unshift(record);
  if (store.levels[level].length > MAX_RESULTS_PER_LEVEL) {
    store.levels[level].length = MAX_RESULTS_PER_LEVEL;
  }
  store.updatedAt = record.at;
  save(store);
  return record;
}

export function getTestResults(level) {
  const store = loadResults();
  return store.levels[level] || [];
}

export function getBestResult(level) {
  const list = getTestResults(level);
  if (!list.length) return null;
  return list.reduce((best, r) => (r.percent > best.percent ? r : best), list[0]);
}

export function resetTestResults(level) {
  const store = loadResults();
  if (level) delete store.levels[level];
  else store.levels = {};
  store.updatedAt = new Date().toISOString();
  save(store);
}

export function formatDateTime(iso) {
  try {
    const d = new Date(iso);
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  } catch (e) {
    return iso;
  }
}
