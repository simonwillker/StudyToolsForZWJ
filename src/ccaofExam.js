/* ============================================================
   CCAO-F 模擬試験

   本番は 60問 / 120分 / 100〜1000のスケールドスコアで 720点合格。
   出題はブループリントの配点比率どおりに各ドメインから抜く。

   採点について：
   本番のスケールドスコアの換算方法は公表されていない。ここでは
   正答率を 100〜1000 に一次変換した「目安」を出すだけで、本番の
   得点を再現するものではない。画面にもそう書くこと。
   ============================================================ */

import { DOMAINS, EXAM_FORMAT, examBlueprintCounts, loadAllDomainItems } from "./ccaofDomains";

const RESULTS_KEY = "ccaofExamResultsV1";
const PROGRESS_KEY = "ccaofExamInProgressV1";
/** 保存する受験履歴の件数。増やしすぎると localStorage を圧迫する */
const MAX_RESULTS = 20;

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * ブループリントの配点どおりに60問を選ぶ。
 * 選択肢のシャッフルは「開始時に1回だけ」。採点は下標で行うので、
 * 途中で並べ替えると答えがずれる（英検アプリで実際に起きた事故）。
 */
export async function buildExam(total = EXAM_FORMAT.items) {
  const all = await loadAllDomainItems();
  const counts = examBlueprintCounts(total);
  const byDomain = new Map(DOMAINS.map((d) => [d.id, []]));
  all.forEach((item) => {
    const list = byDomain.get(item.domain);
    if (list) list.push(item);
  });

  const picked = [];
  DOMAINS.forEach((d) => {
    const pool = shuffle(byDomain.get(d.id) || []);
    picked.push(...pool.slice(0, counts[d.id]));
  });

  // ドメインごとに固まらないよう、最後に全体を混ぜる
  return shuffle(picked).map((item) => ({
    id: item.id,
    domain: item.domain,
    stem: item.stem,
    stemZh: item.stemZh,
    material: item.material,
    selectCount: item.selectCount || 1,
    commentaryZh: item.commentaryZh,
    reference: item.reference,
    // 選択肢はここで1回だけ並べ替える。以降この順が正
    choices: shuffle(item.choices),
  }));
}

/** 複数選択は完全一致のみ正解。本番も部分点は無い */
export function isCorrect(question, picked) {
  const answer = question.choices
    .map((c, i) => (c.correct ? i : -1))
    .filter((i) => i >= 0);
  if (!picked || picked.length !== answer.length) return false;
  return answer.every((i) => picked.includes(i));
}

/**
 * 正答率を 100〜1000 の目安に直す。
 * 本番の換算式は非公開なので、これは学習の目安であって予測ではない。
 */
export function scaledScore(correct, total) {
  if (!total) return EXAM_FORMAT.scaleMin;
  const { scaleMin, scaleMax } = EXAM_FORMAT;
  return Math.round(scaleMin + (scaleMax - scaleMin) * (correct / total));
}

/** 合格の目安となる正答率（720点に相当する割合） */
export function passRatio() {
  const { scaleMin, scaleMax, passScaled } = EXAM_FORMAT;
  return (passScaled - scaleMin) / (scaleMax - scaleMin);
}

export function gradeExam(questions, answers) {
  const perDomain = {};
  DOMAINS.forEach((d) => {
    perDomain[d.id] = { attempted: 0, correct: 0 };
  });

  let correct = 0;
  const details = questions.map((q, i) => {
    const ok = isCorrect(q, answers[i]);
    if (ok) correct += 1;
    const bucket = perDomain[q.domain];
    if (bucket) {
      bucket.attempted += 1;
      if (ok) bucket.correct += 1;
    }
    return { id: q.id, domain: q.domain, correct: ok, picked: answers[i] || [] };
  });

  const scaled = scaledScore(correct, questions.length);
  return {
    finishedAt: Date.now(),
    total: questions.length,
    correct,
    scaled,
    passed: scaled >= EXAM_FORMAT.passScaled,
    perDomain,
    details,
  };
}

/* ---------- 受験履歴 ---------- */

export function loadResults() {
  try {
    const raw = window.localStorage.getItem(RESULTS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

export function saveResult(result) {
  const list = loadResults();
  // 新しい順。詳細まで残すと重いので、履歴には集計だけを入れる
  list.unshift({
    finishedAt: result.finishedAt,
    total: result.total,
    correct: result.correct,
    scaled: result.scaled,
    passed: result.passed,
    perDomain: result.perDomain,
  });
  try {
    window.localStorage.setItem(RESULTS_KEY, JSON.stringify(list.slice(0, MAX_RESULTS)));
  } catch (e) {
    // 保存できなくても採点結果の表示は続ける
  }
}

export function clearResults() {
  try {
    window.localStorage.removeItem(RESULTS_KEY);
  } catch (e) {
    // 何もしない
  }
}

/* ---------- 受験中の状態 ----------
   120分の試験なので、誤って再読み込みしても続きから戻れるようにする。 */

export function saveInProgress(state) {
  try {
    window.localStorage.setItem(PROGRESS_KEY, JSON.stringify(state));
  } catch (e) {
    // 保存できなくても受験自体は続けられる
  }
}

export function loadInProgress() {
  try {
    const raw = window.localStorage.getItem(PROGRESS_KEY);
    if (!raw) return null;
    const state = JSON.parse(raw);
    if (!state || !Array.isArray(state.questions) || !state.startedAt) return null;
    // 制限時間を過ぎていたら復元しない（再開しても0分では意味が無い）
    if (Date.now() - state.startedAt >= EXAM_FORMAT.minutes * 60 * 1000) {
      clearInProgress();
      return null;
    }
    return state;
  } catch (e) {
    return null;
  }
}

export function clearInProgress() {
  try {
    window.localStorage.removeItem(PROGRESS_KEY);
  } catch (e) {
    // 何もしない
  }
}

export function remainingMs(startedAt) {
  return Math.max(0, startedAt + EXAM_FORMAT.minutes * 60 * 1000 - Date.now());
}

export function formatClock(ms) {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}
