/* ============================================================
   CCAO-F：学習記録と復習リスト

   英検側（eikenProgress.js / eikenReview.js）と同じ考え方だが、
   軸が「級 × モード」ではなく「ドメイン」だけなので作り直した。
   保存先も別キーにして、英検の記録と混ざらないようにしてある。
   ============================================================ */

const PROGRESS_KEY = "ccaofProgressV1";
const REVIEW_KEY = "ccaofReviewV1";

function read(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch (e) {
    return fallback;
  }
}

function write(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    // localStorage が使えない環境（プライベートブラウズ等）では記録を諦める。
    // 出題そのものは動き続ける。
  }
}

export function localDateKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function loadProgress() {
  return read(PROGRESS_KEY, { domains: {}, daily: {} });
}

export function recordAnswer(domainId, itemId, isCorrect) {
  const store = loadProgress();
  const d = store.domains[domainId] || { attempted: 0, correct: 0, items: {} };
  d.attempted += 1;
  if (isCorrect) d.correct += 1;
  const it = d.items[itemId] || { seen: 0, correct: 0 };
  it.seen += 1;
  if (isCorrect) it.correct += 1;
  d.items[itemId] = it;
  store.domains[domainId] = d;

  const key = localDateKey();
  const day = store.daily[key] || { attempted: 0, correct: 0 };
  day.attempted += 1;
  if (isCorrect) day.correct += 1;
  store.daily[key] = day;

  write(PROGRESS_KEY, store);
}

export function getDomainStats(domainId) {
  const d = loadProgress().domains[domainId];
  return { attempted: d ? d.attempted : 0, correct: d ? d.correct : 0 };
}

export function getAllDomainStats(ids) {
  const store = loadProgress();
  return ids.map((id) => {
    const d = store.domains[id];
    return { id, attempted: d ? d.attempted : 0, correct: d ? d.correct : 0 };
  });
}

export function accuracyPercent(stats) {
  if (!stats || !stats.attempted) return null;
  return Math.round((stats.correct / stats.attempted) * 100);
}

export function getStreak() {
  const daily = loadProgress().daily;
  let streak = 0;
  const d = new Date();
  // きょうまだ解いていない場合も連続を切らさないよう、きのうから数える
  if (!daily[localDateKey(d)]) d.setDate(d.getDate() - 1);
  for (;;) {
    const key = localDateKey(d);
    if (daily[key] && daily[key].attempted > 0) {
      streak += 1;
      d.setDate(d.getDate() - 1);
    } else break;
  }
  return streak;
}

export function getTodayStats() {
  const day = loadProgress().daily[localDateKey()];
  return day || { attempted: 0, correct: 0 };
}

export function resetProgress() {
  write(PROGRESS_KEY, { domains: {}, daily: {} });
  write(REVIEW_KEY, {});
}

/* ---------- 復習リスト（間違えた問題だけ集める） ---------- */

export function loadReview() {
  return read(REVIEW_KEY, {});
}

export function recordReviewResult(domainId, itemId, isCorrect) {
  const store = loadReview();
  const list = store[domainId] || [];
  const idx = list.indexOf(itemId);
  if (isCorrect) {
    // 正解したら外す。2回連続を待つ作りにはしていない（問題数が少ないうちは
    // 同じ問題が居座ると復習が単調になるため）
    if (idx >= 0) list.splice(idx, 1);
  } else if (idx < 0) {
    list.push(itemId);
  }
  store[domainId] = list;
  write(REVIEW_KEY, store);
}

export function getReviewIds(domainId) {
  return loadReview()[domainId] || [];
}

export function getReviewCount(domainId) {
  return getReviewIds(domainId).length;
}

export function getTotalReviewCount() {
  const store = loadReview();
  return Object.values(store).reduce((n, list) => n + (list ? list.length : 0), 0);
}

export function clearDomainReview(domainId) {
  const store = loadReview();
  delete store[domainId];
  write(REVIEW_KEY, store);
}
