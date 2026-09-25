/* ============================================================
   弱点ドメインの割り出し

   どこを重点的にやるかは、当てずっぽうではなく実績から決める。
   材料は2つ。

   1. 模擬試験のドメイン別採点（ccaofExamResultsV1）
      本番に近い条件で解いた結果なので信頼度が高い。
   2. 通常の演習の記録（ccaofProgressV1）
      件数は多いが、同じ問題を繰り返すと正答率が上がるだけなので
      模試より軽く見る。

   優先度は「弱さ × 配点比率」で決める。同じだけ苦手でも、
   配点の重いドメイン（D2 は 21%）を先に埋めたほうが点が伸びるため。

   データが足りないときは順位を出さない。数問の結果から
   「あなたの弱点は D5 です」と言うのは、助けではなく害になる。
   ============================================================ */

import { DOMAINS } from "./ccaofDomains";
import { loadResults } from "./ccaofExam";
import { loadProgress } from "./ccaofProgress";

/** これ未満の解答数では、そのドメインの正答率を信用しない */
export const MIN_ATTEMPTS = 8;
/** 模試の結果を演習の何倍に重みづけするか */
const EXAM_WEIGHT = 3;

function read(key) {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

/**
 * ドメインごとの実績を集める。
 * 模試ぶんは EXAM_WEIGHT 倍して数えるので、attempted は「重みつきの件数」。
 * 画面に出す実件数は rawAttempted を使う。
 */
export function collectDomainRecord() {
  const out = {};
  DOMAINS.forEach((d) => {
    out[d.id] = { id: d.id, name: d.name, weight: d.weight, attempted: 0, correct: 0, rawAttempted: 0, examAttempted: 0 };
  });

  const progress = loadProgress();
  Object.entries(progress.domains || {}).forEach(([id, b]) => {
    if (!out[id]) return;
    out[id].attempted += b.attempted || 0;
    out[id].correct += b.correct || 0;
    out[id].rawAttempted += b.attempted || 0;
  });

  (loadResults() || []).forEach((r) => {
    Object.entries(r.perDomain || {}).forEach(([id, b]) => {
      if (!out[id]) return;
      out[id].attempted += (b.attempted || 0) * EXAM_WEIGHT;
      out[id].correct += (b.correct || 0) * EXAM_WEIGHT;
      out[id].rawAttempted += b.attempted || 0;
      out[id].examAttempted += b.attempted || 0;
    });
  });

  return out;
}

/**
 * 弱い順にドメインを並べる。
 * 返り値の ready が false のときは順位を出さず、理由を添える。
 */
export function analyseWeakness() {
  const record = collectDomainRecord();
  const rows = DOMAINS.map((d) => {
    const r = record[d.id];
    const pct = r.attempted > 0 ? Math.round((r.correct / r.attempted) * 100) : null;
    return {
      id: d.id,
      name: d.name,
      weight: d.weight,
      rawAttempted: r.rawAttempted,
      examAttempted: r.examAttempted,
      pct,
      /* 弱さ（100 - 正答率）に配点比率を掛ける。判断できないドメインは 0 */
      priority: pct === null ? 0 : ((100 - pct) * d.weight) / 100,
    };
  });

  const judgeable = rows.filter((r) => r.rawAttempted >= MIN_ATTEMPTS);
  if (judgeable.length < 3) {
    return {
      ready: false,
      reason: `まだ判断できません。7つのドメインのうち少なくとも3つで、それぞれ${MIN_ATTEMPTS}問以上解いてください（今は${judgeable.length}つ）。`,
      rows,
    };
  }

  const ranked = [...judgeable].sort((a, b) => b.priority - a.priority);
  const hasExam = rows.some((r) => r.examAttempted > 0);
  return {
    ready: true,
    rows,
    ranked,
    /* 上位3つを重点対象にする。全部やると「重点」ではなくなる */
    focus: ranked.slice(0, 3).map((r) => r.id),
    hasExam,
  };
}

/**
 * 重点演習に出す問題を選ぶ。
 * 優先順位は、まちがえたまま残っている問題 → まだ解いていない問題 →
 * 一度は正解した問題。同じ問題ばかりにならないようにする。
 */
export function pickFocusItems(itemsByDomain, focusIds, limit) {
  const progress = loadProgress();
  const review = read("ccaofReviewV1") || {};
  const wrong = [];
  const unseen = [];
  const seen = [];

  focusIds.forEach((domainId) => {
    const items = itemsByDomain[domainId] || [];
    const stats = (progress.domains && progress.domains[domainId] && progress.domains[domainId].items) || {};
    const reviewIds = Array.isArray(review[domainId]) ? review[domainId] : [];
    items.forEach((item) => {
      const s = stats[item.id];
      if (reviewIds.includes(item.id)) wrong.push(item);
      else if (!s || !s.seen) unseen.push(item);
      else seen.push(item);
    });
  });

  const shuffled = (arr) => {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };

  return [...shuffled(wrong), ...shuffled(unseen), ...shuffled(seen)].slice(0, limit);
}
