/* ============================================================
   Claude 認定 頻出単語データの生成と検査（資格ごと）

   意味（日本語・中国語・品詞）は src/data/claudeCert/<資格>/glossary.json に
   手で書く。出現回数・出現した問題・例文は、ここでその資格の全ドメインの
   問題データ（設問・資料・選択肢・解説・中文注解）から数えて
   同じ場所の vocab.json に書き出す。

     node scripts/buildClaudeCertVocab.mjs              … 全資格の vocab.json を作り直す
     node scripts/buildClaudeCertVocab.mjs ccarf        … 指定した資格だけ
     node scripts/buildClaudeCertVocab.mjs --check      … 作り直さずに検査だけ
                                                  （問題を増やしたのに作り直し
                                                   忘れていたら失敗する）

   問題を増やしたり直したりしたら、作り直して一緒にコミットすること。
   ============================================================ */

import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const certRoot = join(here, "..", "src", "data", "claudeCert");
const CHECK = process.argv.includes("--check");
const ids = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const certIds = ids.length ? ids : readdirSync(certRoot).filter((d) => existsSync(join(certRoot, d, "glossary.json"))).sort();

/** これより少ない問題にしか出ない語は「頻出」と呼ばない */
const MIN_QUESTIONS = 4;
/** 例文の長さ。長すぎると単語カードに収まらない */
const EXAMPLE_MAX = 200;
const EXAMPLES_PER_WORD = 2;
const POS = new Set(["名詞", "動詞", "形容詞", "副詞", "前置詞", "接続詞"]);
/** 基本語。頻出でも単語学習の対象にしない（混ざっていたら止める） */
const STOPWORDS = new Set(
  ("a an the is are was were be been being am do does did have has had it its this that these those " +
    "and or but if so as of in on at to for from by with about into over than then there their they them " +
    "what which who whom whose how when where why not no yes can will would should could may might must " +
    "one two three four five ten each every all any some only most more same other another new old good " +
    "make take get go come give see say tell know want need use ask work time day people person thing way")
    .split(" ")
);

let failed = false;
for (const certId of certIds) if (!build(certId)) failed = true;
if (failed) process.exit(1);

function build(certId) {
const dataDir = join(certRoot, certId);
const glossaryPath = join(dataDir, "glossary.json");
const outPath = join(dataDir, "vocab.json");
const errors = [];
const warnings = [];

/* ---------- 問題データ ---------- */

const meta = JSON.parse(readFileSync(join(dataDir, "meta.json"), "utf8"));
const domainOrder = meta.domains.map((d) => d.id);
const items = readdirSync(dataDir)
  /* 問題ファイルは d1-*.json〜d7-*.json。lessons.json（考点讲义）などは対象外 */
  .filter((f) => /^d\d+-.*\.json$/.test(f))
  .sort()
  .flatMap((f) => JSON.parse(readFileSync(join(dataDir, f), "utf8")).items || []);

/* 英単語に分ける。所有格の 's やハイフン語（claude-generated）は
   ばらして数える（generated も generate の出現として拾いたいため）。 */
function tokens(text) {
  return (String(text || "").replace(/[’‘]/g, "'").match(/[A-Za-z]+/g) || []).map((t) => t.toLowerCase());
}

/* 語形変化。不規則変化は glossary の forms に書く */
function inflections(word) {
  const w = word.toLowerCase();
  const out = new Set([w, w + "s"]);
  if (/(s|x|z|ch|sh)$/.test(w)) out.add(w + "es");
  if (/[^aeiou]y$/.test(w)) {
    out.add(w.slice(0, -1) + "ies");
    out.add(w.slice(0, -1) + "ied");
  }
  if (w.endsWith("e")) {
    out.add(w + "d");
    out.add(w.slice(0, -1) + "ing");
  } else {
    out.add(w + "ed");
    out.add(w + "ing");
    // 子音で終わる短い語の重ね（plan → planned）
    if (/[^aeiou][aeiou][bdgmnprt]$/.test(w)) {
      out.add(w + w.slice(-1) + "ed");
      out.add(w + w.slice(-1) + "ing");
    }
  }
  return out;
}

/* 問題ごとに、数える文章と、例文の候補（中国語訳と対になっているもの）を作る */
const prepared = items.map((it) => {
  const countText = [
    it.stem,
    it.material,
    ...(it.choices || []).map((c) => c.text),
    ...(it.choices || []).map((c) => c.explain),
    it.commentaryZh,
  ].join(" ");
  const examples = [];
  (it.choices || []).forEach((c) => {
    if (c.text && c.textZh) examples.push({ en: c.text, zh: c.textZh, correct: !!c.correct });
  });
  if (it.stem && it.stemZh) examples.push({ en: it.stem, zh: it.stemZh, correct: false });
  return { id: it.id, domain: it.domain, tokens: tokens(countText), examples };
});

/* ---------- 意味（手で書いたもの） ---------- */

const glossary = JSON.parse(readFileSync(glossaryPath, "utf8")).words || [];
const seenWords = new Set();
glossary.forEach((g, i) => {
  const at = `glossary[${i}] ${g.word || "(word なし)"}`;
  if (!g.word || !/^[a-z]+$/.test(g.word)) errors.push(`${at}: word は英小文字1語にする`);
  if (seenWords.has(g.word)) errors.push(`${at}: 同じ単語が2回ある`);
  seenWords.add(g.word);
  if (STOPWORDS.has(g.word)) errors.push(`${at}: 基本語なので単語学習の対象にしない`);
  if (!POS.has(g.pos)) errors.push(`${at}: pos "${g.pos}" が不正（${[...POS].join("・")}）`);
  if (!g.ja || g.ja.length < 1) errors.push(`${at}: ja（日本語の意味）が無い`);
  if (!g.zh || g.zh.length < 1) errors.push(`${at}: zh（中国語の意味）が無い`);
});

/* 同じ意味の語が2つあると、4択で正解が2つに見える */
const byJa = new Map();
glossary.forEach((g) => {
  if (byJa.has(g.ja)) errors.push(`${g.word}: 意味「${g.ja}」が ${byJa.get(g.ja)} と同じ（4択で区別できない）`);
  else byJa.set(g.ja, g.word);
});

/* ---------- 数える ---------- */

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const words = [];
const dropped = [];
glossary.forEach((g) => {
  const forms = new Set([...inflections(g.word), ...(g.forms || []).map((f) => f.toLowerCase())]);
  const itemIds = [];
  const perDomain = {};
  const found = new Set();
  let count = 0;
  prepared.forEach((p) => {
    let n = 0;
    p.tokens.forEach((t) => {
      if (forms.has(t)) {
        n += 1;
        found.add(t);
      }
    });
    if (n > 0) {
      count += n;
      itemIds.push(p.id);
      perDomain[p.domain] = (perDomain[p.domain] || 0) + 1;
    }
  });
  if (itemIds.length < MIN_QUESTIONS) {
    dropped.push(`${g.word}（${itemIds.length}問）`);
    return;
  }

  /* 例文：その語を含む選択肢（正解の選択肢を優先）か設問。中国語訳と対になっているものだけ。
     長さ90字前後を優先し、同じ問題からは1つまで。 */
  const re = new RegExp(`(^|[^A-Za-z])(${[...found].map(escapeRe).join("|")})(?![A-Za-z])`, "i");
  const cands = [];
  prepared.forEach((p) => {
    if (!itemIds.includes(p.id)) return;
    p.examples.forEach((e) => {
      if (e.en.length > EXAMPLE_MAX || e.en.length < 25) return;
      if (!re.test(e.en.replace(/[’‘]/g, "'"))) return;
      cands.push({ ...e, itemId: p.id });
    });
  });
  cands.sort(
    (a, b) =>
      Number(b.correct) - Number(a.correct) ||
      Math.abs(a.en.length - 90) - Math.abs(b.en.length - 90) ||
      a.itemId.localeCompare(b.itemId)
  );
  const examples = [];
  const usedItems = new Set();
  for (const c of cands) {
    if (usedItems.has(c.itemId)) continue;
    usedItems.add(c.itemId);
    examples.push({ en: c.en, zh: c.zh, itemId: c.itemId });
    if (examples.length >= EXAMPLES_PER_WORD) break;
  }
  if (examples.length === 0) errors.push(`${g.word}: 問題から例文を取れなかった`);

  const domains = {};
  domainOrder.forEach((d) => {
    if (perDomain[d]) domains[d] = perDomain[d];
  });
  words.push({
    id: g.word,
    word: g.word,
    pos: g.pos,
    ja: g.ja,
    zh: g.zh,
    count,
    questionCount: itemIds.length,
    domains,
    forms: [...found].sort(),
    examples,
    itemIds,
  });
});

// 出る問題が多い順。20語ずつの組はこの順で切る
words.sort((a, b) => b.questionCount - a.questionCount || b.count - a.count || a.word.localeCompare(b.word));

if (dropped.length) warnings.push(`出現が ${MIN_QUESTIONS}問未満なので収録しない：${dropped.join("、")}`);

const out = {
  _note: "scripts/buildClaudeCertVocab.mjs が生成。手で直さず glossary.json を直して作り直すこと。",
  minQuestions: MIN_QUESTIONS,
  totalQuestions: items.length,
  words,
};
const text = JSON.stringify(out, null, 2) + "\n";

/* ---------- 報告 ---------- */

const coveredItems = new Set(words.flatMap((w) => w.itemIds));
console.log(`\n${meta.examCode} 頻出単語`);
console.log(`  問題 ${items.length}問 から数えた / 意味の登録 ${glossary.length}語 / 収録 ${words.length}語（${MIN_QUESTIONS}問以上に出る語）`);
console.log(`  20語ずつ ${Math.ceil(words.length / 20)}組 / 例文つき ${words.filter((w) => w.examples.length).length}語`);
console.log(`  頻出単語を1つ以上含む問題 ${coveredItems.size} / ${items.length}問`);
console.log(`  上位10語：${words.slice(0, 10).map((w) => `${w.word}(${w.questionCount})`).join(" ")}`);

if (warnings.length) {
  console.log(`\n⚠ 警告 ${warnings.length}件`);
  warnings.forEach((w) => console.log("  - " + w));
}
if (errors.length) {
  console.log(`\n❌ エラー ${errors.length}件`);
  errors.slice(0, 40).forEach((e) => console.log("  - " + e));
  return false;
}

if (CHECK) {
  const current = existsSync(outPath) ? readFileSync(outPath, "utf8") : "";
  if (current !== text) {
    console.log(`\n❌ ${certId}/vocab.json が問題データ・glossary.json と合っていません。node scripts/buildClaudeCertVocab.mjs で作り直してください。\n`);
    return false;
  }
  console.log("\n✅ vocab.json は最新です。\n");
} else {
  writeFileSync(outPath, text);
  console.log(`\n✅ ${outPath.replace(join(here, "..") + "/", "")} を書き出しました。\n`);
}
return true;
}
