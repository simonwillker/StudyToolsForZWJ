/* ============================================================
   Claude 認定：考点（objective）・錯題本・合格予測・模試の組み立ての計算

   画面や localStorage から切り離した純粋な関数だけを置く。
   JSON も window も読まないので、node のテスト
   （scripts/testClaudeCertStudy.mjs）からそのまま呼べる。

   - 考点：meta.json の 30 objectives。id は "D1-1" のように
     ドメイン内の並び順から作る（文章を id にすると長すぎる）。
     CCAO-F は 30、CCAR-F は 30（task statement）。
   - 錯題本：まちがえた問題を間隔をあけて出し直す。
   - 合格予測：模擬試験と考点別の正答率から目安の点数を出す。
   ============================================================ */

/* ---------- 日付 ---------- */

export function dateKeyOf(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** "YYYY-MM-DD" に n 日足す。時差やサマータイムで日付がずれないよう正午で計算する */
export function addDays(dateKey, n) {
  const [y, m, d] = dateKey.split("-").map(Number);
  const dt = new Date(y, m - 1, d, 12);
  dt.setDate(dt.getDate() + n);
  return dateKeyOf(dt);
}

/* ---------- 考点 ---------- */

/** meta.json から 30 考点の一覧を作る */
export function buildObjectives(meta) {
  const out = [];
  meta.domains.forEach((d) => {
    d.objectives.forEach((text, i) => {
      out.push({ id: `${d.id}-${i + 1}`, domain: d.id, text, weight: d.weight });
    });
  });
  return out;
}

/**
 * 問題の objective（英文）→ 考点 id の対応表。
 * 問題の一部は Exam Guide 第2章の資格レベルの能力（competencies）に
 * 紐づいている。讲义の relatedObjectives に書いたものは、その考点の
 * 問題として数える（例：エスカレーション → D4-5）。
 */
export function buildObjectiveIndex(meta, lessons = []) {
  const index = new Map();
  buildObjectives(meta).forEach((o) => index.set(o.text, o.id));
  lessons.forEach((l) => {
    (l.relatedObjectives || []).forEach((text) => {
      if (!index.has(text)) index.set(text, l.id);
    });
  });
  return index;
}

/**
 * 考点ごとの成績。問題ごとの記録（ccaofProgressV1 の domains[*].items）を
 * 考点ごとに足し上げる。記録は問題単位で残っているので、考点別の
 * 保存先を新しく作らなくても、これまでに解いた分がそのまま反映される。
 */
export function collectObjectiveStats(items, progress, objectiveIndex) {
  const stats = {};
  objectiveIndex.forEach((id) => {
    if (!stats[id]) stats[id] = { attempted: 0, correct: 0, seenItems: 0, totalItems: 0 };
  });
  const domains = (progress && progress.domains) || {};
  items.forEach((item) => {
    const id = objectiveIndex.get(item.objective);
    if (!id) return;
    const s = stats[id];
    s.totalItems += 1;
    const rec = domains[item.domain] && domains[item.domain].items && domains[item.domain].items[item.id];
    if (rec && rec.seen) {
      s.attempted += rec.seen;
      s.correct += rec.correct || 0;
      s.seenItems += 1;
    }
  });
  return stats;
}

export function pctOf(s) {
  return s && s.attempted ? Math.round((s.correct / s.attempted) * 100) : null;
}

/** これ未満の解答数の考点は、正答率で弱点と決めつけない */
export const MIN_OBJECTIVE_ATTEMPTS = 5;

/**
 * 弱い考点を count 個選ぶ。
 * 1. 解答数が MIN_OBJECTIVE_ATTEMPTS 以上の考点を、正答率の低い順
 *    （同率なら配点比率の高いドメインを先）。
 * 2. それで足りないときは、解答数の少ない考点で埋める（reason: "few"）。
 *    数問の結果で「弱い」と言うのは害になるので、理由を分けて画面に出す。
 */
export function rankWeakObjectives(objectives, stats, { count = 3, minAttempts = MIN_OBJECTIVE_ATTEMPTS } = {}) {
  const rows = objectives.map((o) => {
    const s = stats[o.id] || { attempted: 0, correct: 0 };
    return { ...o, attempted: s.attempted, correct: s.correct, pct: pctOf(s) };
  });
  const judgeable = rows
    .filter((r) => r.attempted >= minAttempts)
    .sort((a, b) => a.pct - b.pct || b.weight - a.weight || a.id.localeCompare(b.id));
  const picks = judgeable.slice(0, count).map((r) => ({ ...r, reason: "weak" }));
  if (picks.length < count) {
    const few = rows
      .filter((r) => r.attempted < minAttempts)
      .sort((a, b) => a.attempted - b.attempted || b.weight - a.weight || a.id.localeCompare(b.id));
    few.slice(0, count - picks.length).forEach((r) => picks.push({ ...r, reason: "few" }));
  }
  return { picks, judgeableCount: judgeable.length };
}

/**
 * 練習に出す問題を選ぶ。まちがえたまま残っている問題 → まだ解いていない問題
 * → 一度は解いた問題 の順。shuffle は呼び出し側から渡す（テストで固定できるように）。
 */
export function pickPracticeItems(items, progress, mistakeIds, limit, shuffle = (a) => a) {
  const wrong = [];
  const unseen = [];
  const seen = [];
  const domains = (progress && progress.domains) || {};
  items.forEach((item) => {
    const rec = domains[item.domain] && domains[item.domain].items && domains[item.domain].items[item.id];
    if (mistakeIds.has(item.id)) wrong.push(item);
    else if (!rec || !rec.seen) unseen.push(item);
    else seen.push(item);
  });
  return [...shuffle(wrong), ...shuffle(unseen), ...shuffle(seen)].slice(0, limit);
}

/* ---------- 錯題本（間隔をあけた復習） ----------

   まちがえた問題は「1日後」に出す。期限が来てから正解すると次は
   3日後、その次は 7日後。2回続けて正解したら錯題本から外す。

   - まちがえるたびに連続正解は 0 に戻り、次は 1日後。
   - 期限前に（ふだんの演習で）正解しても数えない。間をあけて
     思い出せたかを見たいので、直後の正解は記憶の確認にならない。
   - 間隔は「これまでの正解回数」で決める。まちがえて戻ってきた問題は
     次に正解したとき 7日後まで空けてから、最後の確認をする。 */

export const REVIEW_INTERVALS = [1, 3, 7];
export const GRADUATE_STREAK = 2;

export function emptyMistakes() {
  return { version: 1, migratedReview: false, items: {} };
}

export function normalizeMistakes(raw) {
  if (!raw || typeof raw !== "object" || !raw.items || typeof raw.items !== "object") return emptyMistakes();
  return { version: 1, migratedReview: !!raw.migratedReview, items: { ...raw.items } };
}

/** 1問の答えを錯題本に反映した新しい store を返す（元の store は変えない） */
export function applyMistakeAnswer(store, item, isCorrect, today) {
  const next = normalizeMistakes(store);
  const prev = next.items[item.id];
  if (!isCorrect) {
    const e = prev
      ? { ...prev }
      : { domain: item.domain, addedAt: today, corrects: 0, wrongCount: 0 };
    e.domain = item.domain || e.domain;
    e.streak = 0;
    e.wrongCount = (e.wrongCount || 0) + 1;
    e.lastAt = today;
    e.due = addDays(today, REVIEW_INTERVALS[0]);
    next.items[item.id] = e;
    return next;
  }
  if (!prev || prev.due > today) return next;
  const e = { ...prev, streak: (prev.streak || 0) + 1, corrects: (prev.corrects || 0) + 1, lastAt: today };
  if (e.streak >= GRADUATE_STREAK) {
    delete next.items[item.id];
    return next;
  }
  e.due = addDays(today, REVIEW_INTERVALS[Math.min(e.corrects, REVIEW_INTERVALS.length - 1)]);
  next.items[item.id] = e;
  return next;
}

export function dueMistakeIds(store, today) {
  const s = normalizeMistakes(store);
  return Object.keys(s.items)
    .filter((id) => s.items[id].due <= today)
    .sort((a, b) => (s.items[a].due < s.items[b].due ? -1 : s.items[a].due > s.items[b].due ? 1 : a.localeCompare(b)));
}

/**
 * 旧形式からの移行。v1.30.0 までの復習リスト（ccaofReviewV1：
 * { D1: [id, ...], ... }）にある問題を、きょうが期限の錯題として入れる。
 * 一度だけ行う（migratedReview）。旧リストそのものは消さない
 * （ドメイン画面の「復習する」は今までどおり使う）。
 */
export function migrateMistakes(store, oldReview, today) {
  const next = normalizeMistakes(store);
  if (next.migratedReview) return next;
  Object.entries(oldReview || {}).forEach(([domain, list]) => {
    if (!Array.isArray(list)) return;
    list.forEach((id) => {
      if (typeof id !== "string" || next.items[id]) return;
      next.items[id] = { domain, addedAt: today, lastAt: today, due: today, streak: 0, corrects: 0, wrongCount: 1, migrated: true };
    });
  });
  next.migratedReview = true;
  return next;
}

/* ---------- 模擬試験の組み立て ---------- */

/** 配点比率から total 問の内訳を決める（最大剰余法で合計を total に合わせる） */
export function blueprintCounts(domains, total) {
  const raw = domains.map((d) => ({ id: d.id, exact: (total * d.weight) / 100 }));
  const counts = {};
  let assigned = 0;
  raw.forEach((r) => {
    counts[r.id] = Math.floor(r.exact);
    assigned += counts[r.id];
  });
  const byRemainder = [...raw].sort((a, b) => (b.exact - Math.floor(b.exact)) - (a.exact - Math.floor(a.exact)));
  let i = 0;
  while (assigned < total && byRemainder.length) {
    counts[byRemainder[i % byRemainder.length].id] += 1;
    assigned += 1;
    i += 1;
  }
  return counts;
}

/**
 * シナリオ形式の模試（CCAR-F）。本番は「6 シナリオから 4 つを抽選し、
 * 各シナリオに複数の問題」。シナリオあたりの問題数は公表されていないので
 * total を均等に割る（60 ÷ 4 = 15）。
 * 各シナリオの中では、配点比率に対して足りていないドメインから順に取る
 * （シナリオを交互に回して 1 問ずつ取るので、偏りが 1 か所に寄らない）。
 * 返り値はシナリオごとにまとまった並び（シナリオの中だけ混ぜる）。
 */
export function pickScenarioExam(items, { scenarios, domains, scenariosPerExam, total, shuffle = (a) => a }) {
  const byScenario = new Map();
  items.forEach((it) => {
    if (!it.scenario) return;
    if (!byScenario.has(it.scenario)) byScenario.set(it.scenario, []);
    byScenario.get(it.scenario).push(it);
  });
  const n = Math.max(1, scenariosPerExam);
  const quota = Math.floor(total / n);
  const usable = scenarios.filter((s) => (byScenario.get(s.id) || []).length >= quota).map((s) => s.id);
  const chosen = shuffle(usable).slice(0, n);
  const quotas = chosen.map((_, i) => quota + (i < total - quota * chosen.length ? 1 : 0));
  const target = blueprintCounts(domains, total);
  const weight = Object.fromEntries(domains.map((d) => [d.id, d.weight]));
  const got = Object.fromEntries(domains.map((d) => [d.id, 0]));
  const pools = chosen.map((sid) => {
    const m = new Map();
    shuffle(byScenario.get(sid)).forEach((it) => {
      if (!m.has(it.domain)) m.set(it.domain, []);
      m.get(it.domain).push(it);
    });
    return m;
  });
  const picked = chosen.map(() => []);
  let progress = true;
  while (progress) {
    progress = false;
    chosen.forEach((_, si) => {
      if (picked[si].length >= quotas[si]) return;
      const pool = pools[si];
      const doms = [...pool.keys()].filter((d) => pool.get(d).length);
      if (!doms.length) return;
      doms.sort((a, b) => ((target[b] || 0) - (got[b] || 0)) - ((target[a] || 0) - (got[a] || 0)) || (weight[b] || 0) - (weight[a] || 0) || a.localeCompare(b));
      const d = doms[0];
      picked[si].push(pool.get(d).pop());
      got[d] = (got[d] || 0) + 1;
      progress = true;
    });
  }
  return picked.flatMap((list) => shuffle(list));
}

/* ---------- 模試の解答ペース ----------
   本番は英語で 120分。英文を読む速さが足りないと最後まで届かないので、
   1問ごとにかかった時間を集計して「1問あたりの目安」と比べる。
   timeSpent[i] は i 問目を開いていた合計ミリ秒（行き来した分も足す）。 */

/** 時間がかかった問題として結果に出す数 */
export const SLOWEST_COUNT = 5;

export function paceSummary(questions, timeSpent = [], examFormat) {
  const targetMs = Math.round((examFormat.minutes * 60 * 1000) / examFormat.items);
  const perDomain = {};
  let totalMs = 0;
  let seen = 0;
  let overCount = 0;
  const rows = questions.map((q, i) => {
    const ms = Math.max(0, Number(timeSpent[i]) || 0);
    totalMs += ms;
    if (ms > 0) seen += 1;
    if (ms > targetMs) overCount += 1;
    const d = perDomain[q.domain] || (perDomain[q.domain] = { count: 0, ms: 0, avgMs: 0 });
    if (ms > 0) {
      d.count += 1;
      d.ms += ms;
    }
    return { no: i + 1, id: q.id, domain: q.domain, ms };
  });
  Object.values(perDomain).forEach((d) => {
    d.avgMs = d.count ? Math.round(d.ms / d.count) : 0;
  });
  const slowest = rows
    .filter((r) => r.ms > 0)
    .sort((a, b) => b.ms - a.ms)
    .slice(0, SLOWEST_COUNT);
  return {
    targetMs,
    totalMs,
    // 平均は開いた問題だけで割る（途中で提出・時間切れでも、読む速さそのものを見たい）
    avgMs: seen ? Math.round(totalMs / seen) : 0,
    seen,
    overCount,
    slowest,
    perDomain,
  };
}

/** 秒数を「1分05秒」の形に（結果画面用） */
export function formatSeconds(ms) {
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}分${String(s % 60).padStart(2, "0")}秒` : `${s}秒`;
}

/* ---------- 合格予測 ---------- */

export function scaleFromRatio(ratio, examFormat) {
  const { scaleMin, scaleMax } = examFormat;
  return Math.round(scaleMin + (scaleMax - scaleMin) * Math.max(0, Math.min(1, ratio)));
}

/** 演習からの予測に使うには、配点の何%ぶんのドメインに材料が要るか */
export const MIN_COVERED_WEIGHT = 60;
/** 直近の模試の重み（新しい順） */
const EXAM_RECENCY = [3, 2, 1];
/** 模試と演習の両方があるときの模試の比重。模試は本番に近い条件なので重く見る */
const EXAM_SHARE = 0.6;

/**
 * 予測スコア。
 * - 模試：直近 3 回の目安スコアを新しいほど重く平均。
 * - 演習：ドメインごとに、解答数が足りている考点の正答率を平均し、
 *   そのドメインの考点の半分以上に材料があれば「判断できる」とする。
 *   判断できるドメインが配点の MIN_COVERED_WEIGHT% 以上あれば、配点で
 *   加重した正答率を 100〜1000 に直す。
 * - 両方あれば 6:4 で混ぜる。どちらも無ければ ready: false。
 */
export function predictScore({ results = [], objectives, objectiveStats, domains, examFormat, minAttempts = MIN_OBJECTIVE_ATTEMPTS }) {
  const recent = (results || []).slice(0, EXAM_RECENCY.length);
  let examScaled = null;
  if (recent.length) {
    let w = 0;
    let s = 0;
    recent.forEach((r, i) => {
      w += EXAM_RECENCY[i];
      s += EXAM_RECENCY[i] * r.scaled;
    });
    examScaled = Math.round(s / w);
  }

  let coveredWeight = 0;
  let weighted = 0;
  const perDomain = {};
  domains.forEach((d) => {
    const objs = objectives.filter((o) => o.domain === d.id);
    const judge = objs.filter((o) => (objectiveStats[o.id] || {}).attempted >= minAttempts);
    const ok = judge.length > 0 && judge.length >= Math.ceil(objs.length / 2);
    const acc = ok
      ? judge.reduce((n, o) => n + objectiveStats[o.id].correct / objectiveStats[o.id].attempted, 0) / judge.length
      : null;
    perDomain[d.id] = { judged: judge.length, total: objs.length, acc };
    if (ok) {
      coveredWeight += d.weight;
      weighted += d.weight * acc;
    }
  });
  const practiceReady = coveredWeight >= MIN_COVERED_WEIGHT;
  const practiceScaled = practiceReady ? scaleFromRatio(weighted / coveredWeight, examFormat) : null;

  // CCDV-F の配点は小数（14.7% など）なので、表示用に小数第 1 位で丸める
  coveredWeight = Math.round(coveredWeight * 10) / 10;
  const base = { examScaled, examCount: (results || []).length, practiceScaled, coveredWeight, perDomain };
  if (examScaled === null && practiceScaled === null) {
    return {
      ...base,
      ready: false,
      reason: `まだ予測できません。模擬試験を1回受けるか、配点の${MIN_COVERED_WEIGHT}%以上を占めるドメインで、考点の半分以上をそれぞれ${minAttempts}問以上解いてください（いま配点の${coveredWeight}%ぶん）。`,
    };
  }

  const predicted =
    examScaled !== null && practiceScaled !== null
      ? Math.round(EXAM_SHARE * examScaled + (1 - EXAM_SHARE) * practiceScaled)
      : examScaled !== null
        ? examScaled
        : practiceScaled;

  let confidence = "低";
  if (recent.length >= 2 && practiceReady) confidence = "高";
  else if (recent.length >= 1 && (practiceReady || recent.length >= 2)) confidence = "中";

  const perQuestion = (examFormat.scaleMax - examFormat.scaleMin) / examFormat.items;
  const gap = examFormat.passScaled - predicted;
  return {
    ...base,
    ready: true,
    predicted,
    confidence,
    gap,
    questionsShort: gap > 0 ? Math.ceil(gap / perQuestion) : 0,
  };
}

/**
 * 次にやること（最大3行）。日本語の短い文で返す。
 * weak は rankWeakObjectives の picks、titles は 考点 id → 讲义の題名。
 */
export function nextActions({ prediction, dueCount, weak = [], titles = {}, untouchedCount = 0 }) {
  const lines = [];
  if (dueCount > 0) lines.push(`今日の復習が ${dueCount} 問あります。先に片づけると定着します。`);
  const weakOnes = weak.filter((w) => w.reason === "weak");
  if (weakOnes.length) {
    const w = weakOnes[0];
    lines.push(`いちばん弱い考点は ${w.id}「${titles[w.id] || w.text}」（正答率 ${w.pct}%）。讲义を読んでから練習しましょう。`);
  } else if (untouchedCount > 0) {
    lines.push(`まだ解いていない考点が ${untouchedCount} 個あります。讲义から順に始めましょう。`);
  }
  if (!prediction || !prediction.examCount) {
    lines.push("模擬試験を1回受けると、合格予測の精度が上がります。");
  } else if (prediction.ready && prediction.gap > 0 && lines.length < 3) {
    lines.push(`合格ラインまで、目安で約 ${prediction.questionsShort} 問ぶん。弱い考点の練習を続けましょう。`);
  } else if (prediction.ready && prediction.gap <= 0 && lines.length < 3) {
    lines.push("合格ラインに届いています。模擬試験で安定して取れるか確かめましょう。");
  }
  return lines.slice(0, 3);
}
