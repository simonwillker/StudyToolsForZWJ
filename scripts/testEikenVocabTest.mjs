/* ============================================================
   英検マスター：単語テスト（3級・準2級・2級）のテスト

   - 対象の級が 3級・準2級・2級だけ
   - 全単語・全形式で問題が作れる（選択肢 4 つ、正解が 1 つ、
     選択肢の文字列が重ならない、誤答と正解の意味が重ならない）
   - 範囲（組・すべて・苦手な単語）と問題数の扱い
   - スペルの採点（大小文字・空白・アポストロフィ、同じ意味の別の語）
   - 採点（未解答は不正解）
   - 結果の保存が勉強者ごと・級ごと・新しい順・50回まで
   - バックアップの対象に入り、件数が数えられる
   - 勉強履歴のラベル
   ============================================================ */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";

/* src/ の import は拡張子を省いている（vite 用）。node でも読めるよう .js を補う（testClaudeCertStudy.mjs と同じ） */
register(
  "data:text/javascript," +
    encodeURIComponent(`
      export async function resolve(spec, ctx, next) {
        if ((spec.startsWith("./") || spec.startsWith("../")) && !/\\.[a-z]+$/.test(spec)) {
          try { return await next(spec + ".js", ctx); } catch (e) { /* fallthrough */ }
        }
        return next(spec, ctx);
      }
    `)
);

// localStorage / sessionStorage の代わり
function memoryStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    clear: () => m.clear(),
    keys: () => [...m.keys()],
  };
}
globalThis.window = { localStorage: memoryStorage(), sessionStorage: memoryStorage() };

const vt = await import("../src/eikenVocabTest.js");
const { setLearner } = await import("../src/learner.js");
const { BACKUP_KEYS, buildBackup, describeBackup } = await import("../src/eikenBackup.js");
const { EIKEN_MODE_LABELS } = await import("../src/studyLog.js");

const load = (lv) => JSON.parse(readFileSync(new URL(`../src/data/eikenApp/${lv}.json`, import.meta.url), "utf8"));

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

/** 毎回同じ結果になる乱数（テストを再現できるように） */
function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

console.log("\n英検 単語テストのテスト\n");

test("対象は 3級・準2級・2級だけ", () => {
  assert.deepEqual(vt.VOCAB_TEST_LEVELS, ["3", "pre2", "2"]);
  for (const lv of ["5", "4", "pre1", "1"]) assert.equal(vt.hasVocabTest(lv), false);
});

for (const lv of vt.VOCAB_TEST_LEVELS) {
  const vocab = load(lv).vocab;
  test(`${lv}：全単語 × 英→日・日→英 で 4 択が作れる（正解1つ・文字列も意味も重ならない）`, () => {
    for (const kind of ["en2ja", "ja2en"]) {
      const qs = vt.buildVocabTest(vocab, vocab, { format: kind, count: "all" }, seeded(7));
      assert.equal(qs.length, vocab.length);
      assert.equal(new Set(qs.map((q) => q.wordId)).size, vocab.length, "同じ単語が二度出ない");
      const byId = new Map(vocab.map((w) => [w.id, w]));
      for (const q of qs) {
        assert.equal(q.kind, kind);
        assert.equal(q.choices.length, 4, q.wordId);
        assert.equal(q.choices.filter((c) => c.correct).length, 1, q.wordId);
        assert.equal(new Set(q.choices.map((c) => c.text)).size, 4, `${q.wordId} の選択肢が重なる`);
        const target = byId.get(q.wordId);
        for (const c of q.choices.filter((c) => !c.correct)) {
          const w = byId.get(c.wordId);
          assert.notEqual(w.meaning, target.meaning, `${target.word} と ${w.word} は同じ意味`);
        }
      }
    }
  });

  test(`${lv}：スペル問題は見出し語（と同じ意味の語）で正解になる`, () => {
    const qs = vt.buildVocabTest(vocab, vocab, { format: "spell", count: "all" }, seeded(3));
    const byId = new Map(vocab.map((w) => [w.id, w]));
    for (const q of qs) {
      const w = byId.get(q.wordId);
      assert.equal(vt.isAnswerCorrect(q, `  ${w.word.toUpperCase()} `), true, w.word);
      assert.equal(vt.isAnswerCorrect(q, w.word + "x"), false, w.word);
      // ヒントは頭文字と文字数：見出し語そのものは出さない
      if (w.word.replace(/[^a-z]/gi, "").length > 1) assert.notEqual(vt.spellingHint(w.word), w.word);
      const blanked = vt.blankExample(w.word, w.example.en);
      if (blanked) assert.ok(!new RegExp(`\\b${w.word}\\b`, "i").test(blanked), `${w.word} の例文が隠れていない`);
    }
  });
}

test("同じ意味の別の語もスペル問題で正解（3級 chance／opportunity）", () => {
  const vocab = load("3").vocab;
  const w = vocab.find((x) => x.word === "chance");
  const [q] = vt.buildVocabTest(vocab, [w], { format: "spell", count: 1 });
  assert.equal(vt.isAnswerCorrect(q, "opportunity"), true);
  assert.equal(vt.isAnswerCorrect(q, "Chance"), true);
});

test("スペルの正規化：大小文字・空白・アポストロフィ・ダッシュ", () => {
  assert.equal(vt.normalizeSpelling("  Look   Forward  to "), "look forward to");
  assert.equal(vt.normalizeSpelling("don’t"), "don't");
  assert.equal(vt.normalizeSpelling("hide–and–seek"), "hide-and-seek");
  assert.equal(vt.normalizeSpelling("ｇｉｖｅ ｕｐ"), "give up");
});

test("範囲：組（両端を含む）・すべて・苦手な単語", () => {
  const vocab = load("2").vocab;
  const units = Math.ceil(vocab.length / 20);
  assert.equal(vt.unitCount(vocab), units);
  assert.deepEqual(vt.wordsInRange(vocab, { type: "units", from: 0, to: 0 }), vocab.slice(0, 20));
  assert.deepEqual(vt.wordsInRange(vocab, { type: "units", from: 2, to: 4 }), vocab.slice(40, 100));
  assert.deepEqual(vt.wordsInRange(vocab, { type: "units", from: units + 5, to: units + 15 }), vocab.slice((units - 1) * 20), "範囲外は最後の組");
  assert.equal(vt.wordsInRange(vocab, { type: "all" }).length, vocab.length);
  const weak = new Set([vocab[3].id, vocab[99].id]);
  assert.deepEqual(vt.wordsInRange(vocab, { type: "weak" }, weak).map((w) => w.id), [vocab[3].id, vocab[99].id]);
  assert.equal(vt.rangeLabel({ type: "units", from: 2, to: 4 }), "3〜5組");
  assert.equal(vt.rangeLabel({ type: "units", from: 0, to: 0 }), "1組");
});

test("問題数：範囲より多いときは範囲の語数まで", () => {
  const vocab = load("pre2").vocab;
  const words = vt.wordsInRange(vocab, { type: "units", from: 0, to: 0 });
  assert.equal(vt.buildVocabTest(vocab, words, { format: "en2ja", count: 50 }).length, 20);
  assert.equal(vt.buildVocabTest(vocab, words, { format: "en2ja", count: 10 }).length, 10);
  assert.equal(vt.buildVocabTest(vocab, vocab, { format: "mix", count: 50 }).length, 50);
});

test("まぜる：3 形式がすべて出る", () => {
  const vocab = load("pre2").vocab;
  const kinds = new Set(vt.buildVocabTest(vocab, vocab, { format: "mix", count: 50 }, seeded(11)).map((q) => q.kind));
  assert.deepEqual([...kinds].sort(), ["en2ja", "ja2en", "spell"]);
});

test("採点：未解答は不正解、まちがえた単語の id を返す", () => {
  const vocab = load("3").vocab;
  const qs = vt.buildVocabTest(vocab, vocab.slice(0, 3), { format: "en2ja", count: 3 }, seeded(5));
  const right = qs[0].choices.findIndex((c) => c.correct);
  const wrong = qs[1].choices.findIndex((c) => !c.correct);
  const g = vt.gradeVocabTest(qs, [right, wrong, null]);
  assert.deepEqual(g.marks, [true, false, false]);
  assert.equal(g.correct, 1);
  assert.equal(g.total, 3);
  assert.equal(g.unanswered, 1);
  assert.equal(g.percent, 33);
  assert.deepEqual(g.wrongIds, [qs[1].wordId, qs[2].wordId]);
  assert.equal(vt.answerText(qs[2], null), "（未解答）");
});

test("結果の保存：級ごと・新しい順・50回まで・勉強者ごと", () => {
  setLearner("ZWJ");
  for (let i = 0; i < 55; i++) {
    vt.saveVocabTestResult("3", { format: "en2ja", range: { type: "all" }, count: 10, correct: i % 11, total: 10, percent: (i % 11) * 10, wrongIds: [], elapsedSec: 1, at: new Date(2026, 0, 1, 0, i).toISOString() });
  }
  const list = vt.getVocabTestResults("3");
  assert.equal(list.length, 50);
  assert.ok(list[0].at > list[1].at, "新しい順");
  assert.equal(vt.getVocabTestResults("2").length, 0);
  const trend = vt.getVocabTestTrend("3", 20);
  assert.equal(trend.length, 20);
  assert.ok(trend[0].at < trend[19].at, "グラフは古い順");
  const sum = vt.summarizeVocabTests("3");
  assert.equal(sum.count, 50);
  assert.equal(sum.best.percent, 100);
  assert.ok(window.localStorage.getItem("eikenVocabTestResultsV1"), "ZWJ は名前なしのキー");

  setLearner("ZY");
  assert.equal(vt.getVocabTestResults("3").length, 0, "ZY には ZWJ の結果が見えない");
  vt.saveVocabTestResult("pre2", { format: "spell", range: { type: "weak" }, count: 20, correct: 5, total: 20, percent: 25, wrongIds: [], elapsedSec: 1 });
  assert.ok(window.localStorage.getItem("eikenVocabTestResultsV1::ZY"));
  setLearner("ZWJ");
});

test("バックアップ：単語テストの結果が入り、件数を数える", () => {
  assert.ok(BACKUP_KEYS.includes("eikenVocabTestResultsV1"));
  for (const k of ["eikenProgressV1", "eikenReviewV1", "eikenTestResultsV1"]) assert.ok(BACKUP_KEYS.includes(k), `${k} が残っている`);
  const b = buildBackup();
  assert.equal(b.data.eikenVocabTestResultsV1.levels["3"].length, 50);
  window.localStorage.setItem("eikenTestResultsV1", JSON.stringify({ levels: { 3: [{}, {}], 2: [{}] } }));
  const d = describeBackup(buildBackup());
  assert.equal(d.vocabTests, 50);
  assert.equal(d.tests, 3, "模擬テストの回数（levels の中を数える）");
});

test("勉強履歴のラベル：「3級 単語テスト」", () => {
  assert.equal(EIKEN_MODE_LABELS.vocabTest, "単語テスト");
  assert.equal(EIKEN_MODE_LABELS.vocab, "単語・熟語");
});

console.log(`\n${passed} 件すべて OK\n`);
