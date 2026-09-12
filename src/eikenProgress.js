/* ============================================================
   英検アプリ：学習進捗の記録（localStorage）
   正解・不正解にかかわらず、必ず記録する。
   ============================================================ */

const STORAGE_KEY = "eikenProgressV1";
const MAX_HISTORY_PER_BUCKET = 100;

function emptyStore() {
  return { levels: {}, updatedAt: null };
}

export function loadProgress() {
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

function saveProgress(store) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch (e) {
    // localStorageが使えない環境（プライベートブラウズ等）では静かに諦める
  }
}

function getBucket(store, level, mode) {
  if (!store.levels[level]) store.levels[level] = {};
  if (!store.levels[level][mode]) {
    store.levels[level][mode] = { attempted: 0, correct: 0, lastStudied: null, history: [] };
  }
  return store.levels[level][mode];
}

/**
 * 1問答えるたびに呼ぶ。正解でも不正解でも必ず記録する。
 */
export function recordAnswer(level, mode, itemId, isCorrect) {
  const store = loadProgress();
  const bucket = getBucket(store, level, mode);
  const now = new Date().toISOString();

  bucket.attempted += 1;
  if (isCorrect) bucket.correct += 1;
  bucket.lastStudied = now;
  bucket.history.unshift({ itemId, correct: !!isCorrect, at: now });
  if (bucket.history.length > MAX_HISTORY_PER_BUCKET) {
    bucket.history.length = MAX_HISTORY_PER_BUCKET;
  }

  store.updatedAt = now;
  saveProgress(store);
  return { attempted: bucket.attempted, correct: bucket.correct, lastStudied: bucket.lastStudied };
}

export function getModeStats(level, mode) {
  const store = loadProgress();
  const bucket = store.levels[level] && store.levels[level][mode];
  if (!bucket) return { attempted: 0, correct: 0, lastStudied: null };
  return { attempted: bucket.attempted, correct: bucket.correct, lastStudied: bucket.lastStudied };
}

export function getLevelStats(level) {
  const store = loadProgress();
  const modes = store.levels[level] || {};
  let attempted = 0;
  let correct = 0;
  let lastStudied = null;
  Object.values(modes).forEach((bucket) => {
    attempted += bucket.attempted;
    correct += bucket.correct;
    if (bucket.lastStudied && (!lastStudied || bucket.lastStudied > lastStudied)) {
      lastStudied = bucket.lastStudied;
    }
  });
  return { attempted, correct, lastStudied, modes };
}

export function getAllStats(levels) {
  return levels.map((level) => ({ level, ...getLevelStats(level) }));
}

export function resetProgress() {
  saveProgress(emptyStore());
}

export function resetLevelProgress(level) {
  const store = loadProgress();
  delete store.levels[level];
  store.updatedAt = new Date().toISOString();
  saveProgress(store);
}

export function accuracyPercent(stats) {
  if (!stats || !stats.attempted) return null;
  return Math.round((stats.correct / stats.attempted) * 100);
}
