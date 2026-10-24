/* ============================================================
   Claude 認定（CCAO-F / CCAR-F …）問題データの検査

     node scripts/validateClaudeCert.mjs            … 全資格
     node scripts/validateClaudeCert.mjs ccarf      … 指定した資格だけ

   英検側（validateEikenApp.mjs）と同じ役割だが、この資格特有の
   チェックがふたつある。

   1. 出典（reference）と最終確認日（reviewedAt）が必須。
      CCAO-F は「製品の使い方」を問う試験なので、Claude の仕様が
      変われば正解が間違いになる。英検（言語）との決定的な違い。
   2. 180日以上見直していない問題を洗い出す。
      放っておくと、古い仕様のまま正解として教え続けることになる。
   3. 中国語（設問訳・選択肢訳・解答後の注解）が全問にあるか。
      ユーザーの指示で、問題は中国語訳つき・解答後に中文注解を出す。
   4. 考点讲义（lessons.json）がすべての objectives にあるか。
      必須項目・本文の長さ・公式ドキュメントへのリンクの形式も見る。
   5. meta.json に scenarios がある資格（CCAR-F）だけ：
      各ドメインの問題数・難易度の偏り・シナリオ id・シナリオごとの
      問題数（模擬試験を組めるか）・reference が https か。
   ============================================================ */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const certRoot = join(here, "..", "src", "data", "claudeCert");
const STALE_DAYS = 180;

const args = process.argv.slice(2);
const certIds = args.length ? args : readdirSync(certRoot).filter((d) => existsSync(join(certRoot, d, "meta.json"))).sort();
let allOk = true;
/* 資格をまたいで同じ設問文が無いか（CCAR-F が CCAO-F の問題を使い回していないか） */
const stemOwner = new Map();
for (const id of certIds) {
  if (!validate(id)) allOk = false;
}
if (!allOk) process.exit(1);

function validate(certId) {
const dataDir = join(certRoot, certId);
const errors = [];
const warnings = [];

const meta = JSON.parse(readFileSync(join(dataDir, "meta.json"), "utf8"));

/* CCDV-F の配点は 14.7% のような小数なので、小数第 1 位で丸めて比べる */
const weightSum = Math.round(meta.domains.reduce((n, d) => n + d.weight, 0) * 10) / 10;
if (weightSum !== 100) errors.push(`meta.json: 配点比率の合計が ${weightSum}%（100% であるべき）`);

const domainIds = new Set(meta.domains.map((d) => d.id));
const objectivesByDomain = new Map(meta.domains.map((d) => [d.id, new Set(d.objectives)]));
/* Exam Guide 第2章の資格レベルの能力（エスカレーションなど）は
   どのドメインの問題にも紐づけてよい */
const competencies = new Set(meta.competencies || []);

/* 問題ファイルは d1-*.json〜d7-*.json。lessons.json（考点讲义）は下で別に検査する */
const files = readdirSync(dataDir).filter((f) => /^d\d+-.*\.json$/.test(f)).sort();

const seenIds = new Set();
const seenStems = new Map();
const counts = {};
let stale = 0;
const today = new Date();
/** objective（英文）→ その考点の問題で使っている出典 URL */
const refsByObjective = new Map();

for (const file of files) {
  const data = JSON.parse(readFileSync(join(dataDir, file), "utf8"));
  const dom = data.domain;
  if (!domainIds.has(dom)) {
    errors.push(`${file}: domain "${dom}" は meta.json に無い`);
    continue;
  }
  counts[dom] = (data.items || []).length;

  (data.items || []).forEach((it, i) => {
    const at = `${file}[${i}] ${it.id || "(id なし)"}`;

    if (!it.id) errors.push(`${at}: id が無い`);
    else if (seenIds.has(it.id)) errors.push(`${at}: id が重複している`);
    else seenIds.add(it.id);

    if (it.domain !== dom) errors.push(`${at}: domain が ${it.domain}（ファイルは ${dom}）`);
    if (!it.stem || it.stem.length < 20) errors.push(`${at}: stem が無い、または短すぎる`);
    if (!it.stemZh || it.stemZh.length < 10) errors.push(`${at}: stemZh（設問の中国語訳）が無い`);
    if (!it.commentaryZh || it.commentaryZh.length < 30)
      errors.push(`${at}: commentaryZh（解答後の中文注解）が無い、または短すぎる`);
    /* 選択肢はシャッフルして出すので、注解で「B は」と指すと画面とずれる。
       内容で指すこと（実際にずれていたので機械で止める）。 */
    if (it.commentaryZh && /(?<![A-Za-z0-9])[A-E](?![A-Za-z0-9])/.test(it.commentaryZh))
      errors.push(`${at}: commentaryZh が選択肢を記号（A〜E）で指している。出題時にシャッフルするのでずれる`);

    const key = (it.stem || "").trim().toLowerCase();
    if (key) {
      if (seenStems.has(key)) errors.push(`${at}: 設問文が ${seenStems.get(key)} と同じ`);
      else seenStems.set(key, it.id);
      if (stemOwner.has(key) && stemOwner.get(key) !== certId)
        errors.push(`${at}: 設問文が ${stemOwner.get(key)} の問題と同じ（資格をまたいだ重複）`);
      else stemOwner.set(key, certId);
    }

    const choices = it.choices || [];
    if (choices.length < 3) errors.push(`${at}: 選択肢が ${choices.length} 個（3つ以上必要）`);
    const correct = choices.filter((c) => c.correct).length;
    const selectCount = it.selectCount || 1;
    if (correct === 0) errors.push(`${at}: 正解が無い`);
    if (correct !== selectCount)
      errors.push(`${at}: selectCount=${selectCount} だが正解は ${correct} 個`);
    if (selectCount > 1 && it.type !== "multi")
      warnings.push(`${at}: 複数選択なのに type が "${it.type}"`);
    choices.forEach((c, ci) => {
      if (!c.text) errors.push(`${at}: choices[${ci}] に text が無い`);
      // 全選択肢に解説を必須にする。なぜ他が不適かを書かないと復習にならない
      /* 「不適。事実に反する。」程度（10文字）では、なぜ不適なのかが伝わらない。
         日本語は短くても意味が通るので上限は設けず、中身が無いものだけを弾く。 */
      if (!c.explain || c.explain.length < 12)
        errors.push(`${at}: choices[${ci}] の explain が無い、または短すぎる（12文字以上）`);
      if (!c.textZh) errors.push(`${at}: choices[${ci}] の textZh（中国語訳）が無い`);
    });

    // この資格特有のチェック
    if (!it.reference || !/^https?:\/\//.test(it.reference))
      errors.push(`${at}: reference（出典URL）が無い`);
    if (!it.reviewedAt || !/^\d{4}-\d{2}-\d{2}$/.test(it.reviewedAt)) {
      errors.push(`${at}: reviewedAt（最終確認日）が無い、または形式が YYYY-MM-DD でない`);
    } else {
      const days = Math.floor((today - new Date(it.reviewedAt)) / 86400000);
      if (days > STALE_DAYS) {
        stale += 1;
        warnings.push(`${at}: ${days}日間見直していない（${STALE_DAYS}日超）`);
      }
    }

    if (it.objective && it.reference) {
      if (!refsByObjective.has(it.objective)) refsByObjective.set(it.objective, new Set());
      refsByObjective.get(it.objective).add(it.reference);
    }

    if (it.objective && !objectivesByDomain.get(dom).has(it.objective) && !competencies.has(it.objective))
      warnings.push(`${at}: objective が meta.json の出題目標に無い`);
  });
}

/* ---------- 考点讲义（lessons.json） ---------- */

/* 讲义から張るリンクは Anthropic の公式サイトだけ */
const LESSON_HOSTS = new Set([
  "docs.claude.com",
  "support.claude.com",
  "support.anthropic.com",
  "www.anthropic.com",
  "claude.com",
  "platform.claude.com",
  "code.claude.com",
]);
/* 本文（中国語＋用語）の文字数。依頼は 1本 600〜1000字程度 */
const LESSON_MIN = 500;
const LESSON_MAX = 1300;
let lessonCount = 0;
const lessonsPath = join(dataDir, "lessons.json");
let lessonsDoc = null;
try {
  lessonsDoc = JSON.parse(readFileSync(lessonsPath, "utf8"));
} catch (e) {
  errors.push(`lessons.json: 読めない（${e.message}）`);
}
if (lessonsDoc) {
  const lessons = Array.isArray(lessonsDoc.lessons) ? lessonsDoc.lessons : [];
  const byId = new Map();
  lessons.forEach((l, i) => {
    const at = `lessons.json[${i}] ${l.id || "(id なし)"}`;
    if (!l.id || !/^D\d+-\d+$/.test(l.id)) errors.push(`${at}: id が "D1-1" の形でない`);
    else if (byId.has(l.id)) errors.push(`${at}: id が重複している`);
    else byId.set(l.id, l);
  });
  meta.domains.forEach((d) => {
    d.objectives.forEach((obj, i) => {
      const id = `${d.id}-${i + 1}`;
      const l = byId.get(id);
      if (!l) {
        errors.push(`lessons.json: ${id}「${obj}」の讲义が無い`);
        return;
      }
      lessonCount += 1;
      const at = `lessons.json ${id}`;
      if (l.domain !== d.id) errors.push(`${at}: domain が ${l.domain}（${d.id} であるべき）`);
      if (l.objective !== obj) errors.push(`${at}: objective が meta.json の文と一致しない`);
      ["titleZh", "summaryZh", "practiceZh"].forEach((k) => {
        if (typeof l[k] !== "string" || l[k].trim().length < (k === "titleZh" ? 4 : 30))
          errors.push(`${at}: ${k} が無い、または短すぎる`);
      });
      const concepts = Array.isArray(l.concepts) ? l.concepts : [];
      if (concepts.length < 3 || concepts.length > 5) errors.push(`${at}: 核心概念（concepts）は 3〜5 個（今は ${concepts.length}）`);
      concepts.forEach((c, ci) => {
        if (!c || !c.term || !c.zh || c.zh.length < 15) errors.push(`${at}: concepts[${ci}] に term と zh（15字以上）が要る`);
      });
      const ex = l.example || {};
      ["bad", "good", "whyZh"].forEach((k) => {
        if (!ex[k] || ex[k].length < 10) errors.push(`${at}: example.${k}（正例／反例）が無い、または短すぎる`);
      });
      ["pitfalls", "examTips"].forEach((k) => {
        if (!Array.isArray(l[k]) || l[k].length < 2 || l[k].some((t) => typeof t !== "string" || t.length < 10))
          errors.push(`${at}: ${k} は 10字以上の文を 2つ以上`);
      });
      const refs = Array.isArray(l.references) ? l.references : [];
      if (refs.length < 1) errors.push(`${at}: references（公式ドキュメント）が無い`);
      const used = refsByObjective.get(obj) || new Set();
      refs.forEach((r, ri) => {
        let url = null;
        try {
          url = new URL(r.url);
        } catch (e) {
          // 下でエラーにする
        }
        if (!r.title) errors.push(`${at}: references[${ri}] に title が無い`);
        if (!url || url.protocol !== "https:") errors.push(`${at}: references[${ri}] の url が https:// でない`);
        else if (!LESSON_HOSTS.has(url.hostname))
          errors.push(`${at}: references[${ri}] が公式サイト以外（${url.hostname}）`);
        else if (![...refsByObjective.values()].some((set) => set.has(r.url)))
          warnings.push(`${at}: references[${ri}] はどの問題の出典にも使われていない URL`);
      });
      if (refs.length && !refs.some((r) => used.has(r.url)))
        warnings.push(`${at}: この考点の問題の出典を 1つも再利用していない`);
      (l.relatedObjectives || []).forEach((rel) => {
        if (!competencies.has(rel)) errors.push(`${at}: relatedObjectives「${rel}」は meta.json の competencies に無い`);
      });
      const text = [
        l.titleZh,
        l.summaryZh,
        ...concepts.map((c) => `${c.term || ""}${c.zh || ""}`),
        ex.bad,
        ex.good,
        ex.whyZh,
        ...(l.pitfalls || []),
        ...(l.examTips || []),
        l.practiceZh,
      ].join("");
      if (text.length < LESSON_MIN || text.length > LESSON_MAX)
        errors.push(`${at}: 本文が ${text.length}字（${LESSON_MIN}〜${LESSON_MAX}字にする）`);
    });
  });
  byId.forEach((l, id) => {
    const [dom, n] = id.split("-");
    const d = meta.domains.find((x) => x.id === dom);
    if (!d || Number(n) < 1 || Number(n) > d.objectives.length) errors.push(`lessons.json ${id}: meta.json に無い考点`);
  });
  /* 問題の objective のうち、どの讲义からも練習できないものが無いか */
  const reachable = new Set([...meta.domains.flatMap((d) => d.objectives), ...lessons.flatMap((l) => l.relatedObjectives || [])]);
  refsByObjective.forEach((_, obj) => {
    if (!reachable.has(obj)) warnings.push(`問題の objective「${obj}」に対応する讲义が無い（考点練習に出ない）`);
  });
}

/* ---------- シナリオ形式の資格（CCAR-F）だけの検査 ---------- */
const MIN_PER_DOMAIN = 75;
if (meta.scenarios) {
  const scenarioIds = new Set(meta.scenarios.map((sc) => sc.id));
  if (meta.scenarios.length !== meta.examFormat.scenarioBank)
    errors.push(`meta.json: scenarios が ${meta.scenarios.length} 個（scenarioBank は ${meta.examFormat.scenarioBank}）`);
  meta.scenarios.forEach((sc) => {
    ["title", "titleZh", "description", "descriptionZh"].forEach((k) => {
      if (!sc[k] || sc[k].length < 5) errors.push(`meta.json scenario ${sc.id}: ${k} が無い`);
    });
    (sc.primaryDomains || []).forEach((d) => { if (!domainIds.has(d)) errors.push(`meta.json scenario ${sc.id}: primaryDomains に不明な ${d}`); });
  });
  (meta.sources || []).forEach((src, i) => {
    if (!/^https:\/\//.test(src.url || "")) errors.push(`meta.json sources[${i}]: url が https でない`);
    if (!["official", "unofficial"].includes(src.kind)) errors.push(`meta.json sources[${i}]: kind は official / unofficial`);
  });
  const perScenario = {};
  const diff = {};
  let total = 0;
  for (const file of files) {
    (JSON.parse(readFileSync(join(dataDir, file), "utf8")).items || []).forEach((it) => {
      total += 1;
      if (!/^https:\/\//.test(it.reference || "")) errors.push(`${it.id}: reference が https でない`);
      if (![1, 2, 3].includes(it.difficulty)) errors.push(`${it.id}: difficulty は 1〜3`);
      diff[it.difficulty] = (diff[it.difficulty] || 0) + 1;
      if (it.scenario !== undefined) {
        if (!scenarioIds.has(it.scenario)) errors.push(`${it.id}: scenario "${it.scenario}" は meta.json に無い`);
        perScenario[it.scenario] = (perScenario[it.scenario] || 0) + 1;
      }
      if (!["scenario", "mcq", "multi"].includes(it.type)) errors.push(`${it.id}: type は scenario / mcq / multi`);
      if (it.type === "scenario" && !it.scenario) errors.push(`${it.id}: type が scenario なのに scenario が無い`);
    });
  }
  meta.domains.forEach((d) => {
    if ((counts[d.id] || 0) < MIN_PER_DOMAIN) errors.push(`${d.id}: 問題が ${counts[d.id] || 0} 問（${MIN_PER_DOMAIN} 問以上）`);
  });
  const need = Math.ceil(meta.examFormat.items / meta.examFormat.scenariosPerExam);
  meta.scenarios.forEach((sc) => {
    if ((perScenario[sc.id] || 0) < need * 2)
      errors.push(`scenario ${sc.id}: 問題が ${perScenario[sc.id] || 0} 問（模擬試験を何回か組むには ${need * 2} 問以上）`);
  });
  [1, 2, 3].forEach((lv) => {
    const share = (diff[lv] || 0) / total;
    if (share < 0.15 || share > 0.6) errors.push(`難易度 ${lv} が ${Math.round(share * 100)}%（15〜60% にする）`);
  });
  console.log(`\nシナリオ別の問題数：${meta.scenarios.map((sc) => `${sc.id} ${perScenario[sc.id] || 0}`).join(" / ")}`);
  console.log(`難易度：${[1, 2, 3].map((lv) => `L${lv} ${diff[lv] || 0}`).join(" / ")}`);
}

// 本番60問の配点どおりに出すには各ドメインに何問必要か
const target = {};
meta.domains.forEach((d) => { target[d.id] = Math.round((meta.examFormat.items * d.weight) / 100); });

console.log(`\n${meta.examCode} 問題データ（ブループリント v${meta.blueprintVersion} / ${meta.blueprintEffective}）\n`);
console.table(
  meta.domains.map((d) => ({
    ドメイン: `${d.id} ${d.label}`,
    配点: `${d.weight}%`,
    "模試1回分": target[d.id],
    収録: counts[d.id] ?? 0,
    "目標60問まで": Math.max(0, 60 - (counts[d.id] ?? 0)),
  }))
);
console.log(`合計 ${Object.values(counts).reduce((a, b) => a + b, 0)} 問`);
if (stale) console.log(`⚠ ${STALE_DAYS}日以上見直していない問題が ${stale} 件あります`);
console.log(`考点讲义 ${lessonCount} / ${meta.domains.reduce((n, d) => n + d.objectives.length, 0)} 考点`);

if (warnings.length) {
  console.log(`\n⚠ 警告 ${warnings.length}件`);
  warnings.slice(0, 20).forEach((w) => console.log("  - " + w));
  if (warnings.length > 20) console.log(`  …ほか ${warnings.length - 20} 件`);
}

if (errors.length) {
  console.log(`\n❌ エラー ${errors.length}件`);
  errors.slice(0, 40).forEach((e) => console.log("  - " + e));
  return false;
}
console.log("\n✅ エラーはありません。\n");
return true;
}
