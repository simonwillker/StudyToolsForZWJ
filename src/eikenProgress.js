/* ============================================================
   英検アプリ：学習進捗の記録（localStorage）
   正解・不正解にかかわらず、必ず記録する。
   ============================================================ */

const STORAGE_KEY = "eikenProgressV1";
const MAX_HISTORY_PER_BUCKET = 100;
/** 日ごとの記録を残す日数。これを超えた古い日付は捨てる。 */
const MAX_DAILY_DAYS = 180;

function emptyStore() {
  return { levels: {}, daily: {}, updatedAt: null };
}

/** その端末のローカル日付を YYYY-MM-DD で返す。
 *  UTCで切ると日本時間の朝9時までが前日扱いになってしまうため、必ずローカルで切る。 */
export function localDateKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function loadProgress() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyStore();
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !parsed.levels) return emptyStore();
    // daily は後から追加したので、それ以前の記録には存在しない
    if (!parsed.daily || typeof parsed.daily !== "object") parsed.daily = {};
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

  if (!store.daily) store.daily = {};
  const dayKey = localDateKey();
  const day = store.daily[dayKey] || { attempted: 0, correct: 0 };
  day.attempted += 1;
  if (isCorrect) day.correct += 1;
  store.daily[dayKey] = day;

  const days = Object.keys(store.daily).sort();
  if (days.length > MAX_DAILY_DAYS) {
    days.slice(0, days.length - MAX_DAILY_DAYS).forEach((k) => delete store.daily[k]);
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

/** 直近 days 日ぶんを古い順に返す。学習していない日も 0 として埋める。 */
export function getDailySeries(days = 14) {
  const daily = loadProgress().daily || {};
  const out = [];
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const key = localDateKey(d);
    const rec = daily[key] || { attempted: 0, correct: 0 };
    out.push({ date: key, day: d.getDate(), weekday: d.getDay(), ...rec });
  }
  return out;
}

/** 連続学習日数。今日まだやっていなくても、昨日まで続いていればその記録を保つ。 */
export function getStreak() {
  const daily = loadProgress().daily || {};
  const today = new Date();
  let cursor = new Date(today);
  // 今日がまだ0問なら、昨日から数え始める（その日のうちに再開できる猶予）
  if (!daily[localDateKey(cursor)]) cursor.setDate(cursor.getDate() - 1);
  let n = 0;
  while (daily[localDateKey(cursor)] && daily[localDateKey(cursor)].attempted > 0) {
    n += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return n;
}

export function getTodayStats() {
  const daily = loadProgress().daily || {};
  return daily[localDateKey()] || { attempted: 0, correct: 0 };
}

/** モード別に全レベルを合算する。どの分野が弱いかを見るため。 */
export function getModeTotals() {
  const store = loadProgress();
  const totals = {};
  Object.values(store.levels || {}).forEach((modes) => {
    Object.entries(modes).forEach(([mode, b]) => {
      if (!totals[mode]) totals[mode] = { attempted: 0, correct: 0 };
      totals[mode].attempted += b.attempted;
      totals[mode].correct += b.correct;
    });
  });
  return totals;
}

export function accuracyPercent(stats) {
  if (!stats || !stats.attempted) return null;
  return Math.round((stats.correct / stats.attempted) * 100);
}
