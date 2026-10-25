/* ============================================================
   Sapix：錯題本（今日の復習）とまとめテストのテスト

   - 錯題本の間隔：まちがえたら 1日後、期限後の正解で 3日後 → 7日後、
     2回続けて正解で外れる。期限前の正解は数えない
   - v1.40.0 までの復習リスト（<科目>ReviewV1）を一度だけ錯題本に移す。
     復習リストそのものは書きかえない
   - 保存キーは科目ごと・勉強者ごと。GitHub 同期の対象に入る
   - まとめテストの出題：えらんだ単元からかたよらず、問題数は上限まで、
     同じ問題は二度出ない（全学年・全科目の実データで確かめる）
   - 採点：未解答は不正解、単元ごとの正答率
   - 結果は新しい順に 50 回まで
   ============================================================ */

import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
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

const st = await import("../src/sapixStudy.js");
const { storageKeys, GRADES, SUBJECT_DEFS } = await import("../src/sapixStorage.js");
const { setLearner } = await import("../src/learner.js");
const { parseRecordKey } = await import("../src/cloudSync.js");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const math = { ...storageKeys(4, "math") };
const kokugo = { ...storageKeys(4, "kokugo") };
const ls = window.localStorage;

console.log("\nSapix 錯題本・まとめテストのテスト\n");

test("保存キー：錯題本・まとめテストは科目ごと（4年算数は sapixMathMistakesV1 など）", () => {
  assert.equal(math.mistakesKey, "sapixMathMistakesV1");
  assert.equal(math.testKey, "sapixMathTestResultsV1");
  assert.equal(storageKeys(5, "rika").mistakesKey, "sapixG5RikaMistakesV1");
  const all = GRADES.flatMap((g) => SUBJECT_DEFS.flatMap((d) => Object.values(storageKeys(g, d.id))));
  assert.equal(new Set(all).size, all.length, "キーが重ならない");
});

test("GitHub 同期の対象に入る（勉強者ごと）", () => {
  assert.deepEqual(parseRecordKey("sapixMathMistakesV1"), { base: "sapixMathMistakesV1", learner: "ZWJ" });
  assert.deepEqual(parseRecordKey("sapixG5RikaTestResultsV1::ZY"), { base: "sapixG5RikaTestResultsV1", learner: "ZY" });
});

test("旧形式の復習リストを、きょうが期限の錯題として一度だけ移す（復習リストは書きかえない）", () => {
  setLearner("ZWJ");
  const old = { "sm-kufu": ["sm-kufu-03", "sm-kufu-07"], "sm-wari": ["sm-wari-01"] };
  ls.setItem(math.reviewKey, JSON.stringify(old));
  const sum = st.mistakeSummary(math, "2026-10-25");
  assert.deepEqual(sum, { total: 3, due: 3, next: null });
  assert.deepEqual(st.mistakeCountByUnit(math, "2026-10-25"), { "sm-kufu": 2, "sm-wari": 1 });
  assert.deepEqual(st.dueMistakes(math, "2026-10-25").map((d) => d.unitId).sort(), ["sm-kufu", "sm-kufu", "sm-wari"]);
  // 移したあとに復習リストへ足しても、もう移さない
  ls.setItem(math.reviewKey, JSON.stringify({ ...old, "sm-x": ["sm-x-01"] }));
  assert.equal(st.mistakeSummary(math, "2026-10-25").total, 3);
  assert.deepEqual(JSON.parse(ls.getItem(math.reviewKey))["sm-kufu"], old["sm-kufu"]);
});

test("間隔：まちがえる → 1日後。期限後の正解で 3日後、もう一度正解で外れる。期限前の正解は数えない", () => {
  const d0 = "2026-11-01";
  st.recordMistakeAnswer(kokugo, "sk-yomi", "sk-yomi-05", false, d0);
  let s = st.loadMistakes(kokugo, d0).items["sk-yomi-05"];
  assert.equal(s.due, "2026-11-02");
  assert.equal(st.mistakeSummary(kokugo, d0).due, 0, "その日のうちは出さない");
  // 期限前の正解は数えない
  st.recordMistakeAnswer(kokugo, "sk-yomi", "sk-yomi-05", true, d0);
  assert.equal(st.loadMistakes(kokugo, d0).items["sk-yomi-05"].streak, 0);
  assert.deepEqual(st.dueMistakes(kokugo, "2026-11-02"), [{ id: "sk-yomi-05", unitId: "sk-yomi" }]);
  st.recordMistakeAnswer(kokugo, "sk-yomi", "sk-yomi-05", true, "2026-11-02");
  s = st.loadMistakes(kokugo, "2026-11-02").items["sk-yomi-05"];
  assert.equal(s.due, "2026-11-05");
  st.recordMistakeAnswer(kokugo, "sk-yomi", "sk-yomi-05", true, "2026-11-05");
  assert.equal(st.loadMistakes(kokugo, "2026-11-05").items["sk-yomi-05"], undefined, "2回続けて正解で外れる");
});

test("まちがえて戻った問題は、次の正解で 7日後", () => {
  st.recordMistakeAnswer(kokugo, "sk-yomi", "sk-yomi-09", false, "2026-11-01");
  st.recordMistakeAnswer(kokugo, "sk-yomi", "sk-yomi-09", true, "2026-11-02"); // 3日後へ
  st.recordMistakeAnswer(kokugo, "sk-yomi", "sk-yomi-09", false, "2026-11-05"); // まちがえて 1日後へ
  st.recordMistakeAnswer(kokugo, "sk-yomi", "sk-yomi-09", true, "2026-11-06");
  assert.equal(st.loadMistakes(kokugo, "2026-11-06").items["sk-yomi-09"].due, "2026-11-13");
});

test("勉強者ごとに別（ZY には ZWJ の錯題が見えない）", () => {
  setLearner("ZY");
  assert.equal(st.mistakeSummary(math, "2026-10-25").total, 0);
  st.recordMistakeAnswer(math, "sm-kufu", "sm-kufu-01", false, "2026-10-25");
  assert.ok(ls.getItem("sapixMathMistakesV1::ZY"));
  setLearner("ZWJ");
  assert.equal(st.mistakeSummary(math, "2026-10-25").total, 3);
});

test("リセット：錯題本を空にし、旧復習リストから作り直さない", () => {
  st.resetMistakes(math);
  assert.equal(st.mistakeSummary(math, "2026-10-25").total, 0);
});

/* ---------- まとめテスト（実データ） ---------- */

const sapixDir = new URL("../src/data/sapix/", import.meta.url);
const courses = [];
for (const g of readdirSync(sapixDir).filter((d) => /^g\d$/.test(d))) {
  for (const subj of readdirSync(new URL(`${g}/`, sapixDir))) {
    const metaUrl = new URL(`${g}/${subj}/meta.json`, sapixDir);
    if (!existsSync(metaUrl)) continue;
    const meta = JSON.parse(readFileSync(metaUrl, "utf8"));
    const pools = meta.units.map((u) => ({
      unitId: u.id,
      questions: JSON.parse(readFileSync(new URL(`${g}/${subj}/${u.file}`, sapixDir), "utf8")).questions,
    }));
    courses.push({ name: `${g}/${subj}`, pools });
  }
}

test(`出題：全 ${courses.length} 科目で、えらんだ単元から重複なく・かたよらず選ぶ`, () => {
  assert.ok(courses.length >= 5);
  for (const c of courses) {
    for (const count of st.TEST_COUNTS) {
      const qs = st.pickTestQuestions(c.pools, count, seeded(count));
      assert.equal(qs.length, Math.min(count, c.pools.reduce((n, p) => n + p.questions.length, 0)), c.name);
      assert.equal(new Set(qs.map((q) => q.id)).size, qs.length, `${c.name}：同じ問題が二度出た`);
      const per = {};
      qs.forEach((q) => {
        assert.ok(q._unit, "単元 id がつく");
        per[q._unit] = (per[q._unit] || 0) + 1;
      });
      const counts = Object.values(per);
      if (count >= c.pools.length) assert.ok(Math.max(...counts) - Math.min(...counts) <= 1, `${c.name}：単元がかたよる ${JSON.stringify(per)}`);
    }
  }
});

test("出題：2単元・30問なら 2単元の 40問から 30問（15問ずつ）", () => {
  const pools = courses[0].pools.slice(0, 2);
  const qs = st.pickTestQuestions(pools, 30, seeded(1));
  assert.equal(qs.length, 30);
  assert.deepEqual(
    Object.values(qs.reduce((m, q) => ((m[q._unit] = (m[q._unit] || 0) + 1), m), {})),
    [15, 15]
  );
  assert.equal(st.pickTestQuestions(pools.slice(0, 1), 30).length, 20, "1単元なら 20問まで");
});

test("採点：未解答は不正解、単元ごとの正答率と、まちがえた問題の id", () => {
  const qs = [
    { id: "a1", _unit: "a", answer: 1 },
    { id: "a2", _unit: "a", answer: 2 },
    { id: "b1", _unit: "b", answer: 3 },
  ];
  const check = (q, input) => ({ ok: input.choice === q.answer });
  const empty = (q, input) => input.choice == null;
  const g = st.gradeTest(qs, [{ choice: 1 }, { choice: 0 }, {}], check, empty);
  assert.deepEqual(g.marks, [true, false, false]);
  assert.equal(g.correct, 1);
  assert.equal(g.unanswered, 1);
  assert.equal(g.percent, 33);
  assert.deepEqual(g.perUnit, { a: { correct: 1, total: 2 }, b: { correct: 0, total: 1 } });
  assert.deepEqual(g.wrongIds, ["a2", "b1"]);
});

test("結果：新しい順・50回まで・推移は古い順・リセットで消える", () => {
  for (let i = 0; i < 55; i++) {
    st.saveTestResult(math, { unitIds: ["sm-kufu"], count: 10, timeLimitMin: 0, correct: i % 11, total: 10, percent: (i % 11) * 10, at: new Date(2026, 9, 1, 0, i).toISOString() });
  }
  const list = st.loadTestResults(math);
  assert.equal(list.length, 50);
  assert.ok(list[0].at > list[1].at);
  const trend = st.testTrend(math, 20);
  assert.equal(trend.length, 20);
  assert.ok(trend[0].at < trend[19].at);
  assert.equal(st.loadTestResults(kokugo).length, 0, "科目ごとに別");
  st.resetTestResults(math);
  assert.equal(st.loadTestResults(math).length, 0);
});

test("時計の表示", () => {
  assert.equal(st.formatClock(0), "0:00");
  assert.equal(st.formatClock(65.4), "1:05");
  assert.equal(st.formatClock(-3), "0:00");
});

console.log(`\n${passed} 件すべて OK\n`);
