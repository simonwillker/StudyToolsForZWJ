/* ============================================================
   英検マスター：錯題本（今日の復習）のテスト

   - 間隔：まちがえたら 1日後、期限後の正解で 3日後 → 7日後、2回続けて正解で外れる。
     期限前の正解は数えない
   - v1.40.0 までの復習リスト（eikenReviewV1）を一度だけ移す（単語の方向つき id もそろえる）。
     旧リストは書きかえない
   - 発音練習・模擬テストは入れない
   - 級ごと・勉強者ごとに別。GitHub 同期の対象に入る
   - バックアップ：錯題本が入り、件数を数える。古いバックアップを戻すと作り直す
   ============================================================ */

import assert from "node:assert/strict";
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
const ls = window.localStorage;

const rv = await import("../src/eikenReview.js");
const { setLearner } = await import("../src/learner.js");
const { BACKUP_KEYS, buildBackup, describeBackup, applyBackup } = await import("../src/eikenBackup.js");
const { parseRecordKey } = await import("../src/cloudSync.js");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log("\n英検 錯題本（今日の復習）のテスト\n");

setLearner("ZWJ");

test("旧復習リストを、きょうが期限の錯題として一度だけ移す（単語の方向つき id はそろえる）", () => {
  const legacy = {
    levels: {
      3: [
        { key: "vocab::v3-001-en2ja", mode: "vocab", itemId: "v3-001-en2ja", wrongCount: 2, streak: 0 },
        { key: "vocab::v3-001-ja2en", mode: "vocab", itemId: "v3-001-ja2en", wrongCount: 1, streak: 1 },
        { key: "grammar::g3-010", mode: "grammar", itemId: "g3-010", wrongCount: 1, streak: 1 },
        { key: "pronunciation::v3-002", mode: "pronunciation", itemId: "v3-002", wrongCount: 1, streak: 0 },
      ],
      2: [{ key: "phrases::p2-004", mode: "phrases", itemId: "p2-004", wrongCount: 3, streak: 0 }],
    },
  };
  ls.setItem("eikenReviewV1", JSON.stringify(legacy));
  const today = "2026-10-25";
  assert.deepEqual(rv.getReviewSummary("3", today), { total: 2, due: 2, next: null });
  const e = rv.getReviewEntries("3", today);
  assert.deepEqual(e.map((x) => `${x.mode}:${x.itemId}`), ["vocab:v3-001", "grammar:g3-010"]);
  assert.equal(e[0].wrongCount, 3, "両方向の間違い回数を合計");
  assert.deepEqual([...rv.getReviewItemIds("3", "vocab", today)], ["v3-001"]);
  assert.equal(rv.getReviewCount("2", today), 1);
  // 一度移したら、旧リストに足してももう移さない。旧リストは書きかえない
  ls.setItem("eikenReviewV1", JSON.stringify({ levels: { ...legacy.levels, 5: [{ mode: "vocab", itemId: "v5-001", wrongCount: 1 }] } }));
  assert.equal(rv.getReviewCount("5", today), 0);
  assert.equal(JSON.parse(ls.getItem("eikenReviewV1")).levels[3].length, 4);
});

test("間隔：まちがえる → 1日後。期限前の正解は数えない。期限後の正解で 3日後、もう一度正解で外れる", () => {
  rv.recordReviewResult("pre2", "grammar", "gp-001", false, "2026-11-01");
  assert.deepEqual(rv.getReviewSummary("pre2", "2026-11-01"), { total: 1, due: 0, next: "2026-11-02" });
  rv.recordReviewResult("pre2", "grammar", "gp-001", true, "2026-11-01");
  assert.equal(rv.getReviewEntries("pre2", "2026-11-01")[0].streak, 0, "期限前の正解は数えない");
  assert.equal(rv.getDueReviewEntries("pre2", "2026-11-02").length, 1);
  rv.recordReviewResult("pre2", "grammar", "gp-001", true, "2026-11-02");
  assert.equal(rv.getReviewEntries("pre2", "2026-11-02")[0].due, "2026-11-05");
  assert.equal(rv.getDueReviewEntries("pre2", "2026-11-04").length, 0);
  rv.recordReviewResult("pre2", "grammar", "gp-001", true, "2026-11-05");
  assert.equal(rv.getReviewCount("pre2", "2026-11-05"), 0, "2回続けて正解で外れる");
});

test("まちがえて戻った問題は、次の正解で 7日後", () => {
  rv.recordReviewResult("pre2", "vocab", "vpre2-010", false, "2026-11-01");
  rv.recordReviewResult("pre2", "vocab", "vpre2-010", true, "2026-11-02");
  rv.recordReviewResult("pre2", "vocab", "vpre2-010", false, "2026-11-05");
  rv.recordReviewResult("pre2", "vocab", "vpre2-010", true, "2026-11-06");
  assert.equal(rv.getReviewEntries("pre2", "2026-11-06")[0].due, "2026-11-13");
});

test("発音練習・模擬テストは錯題本に入れない", () => {
  rv.recordReviewResult("4", "pronunciation", "v4-001", false, "2026-11-01");
  rv.recordReviewResult("4", "test", "t4-01", false, "2026-11-01");
  assert.equal(rv.getReviewCount("4", "2026-11-01"), 0);
});

test("モードごとの件数（きょうの分だけ／全部）", () => {
  rv.recordReviewResult("1", "grammar", "g1-001", false, "2026-11-01");
  rv.recordReviewResult("1", "reading", "r1-001", false, "2026-11-03");
  assert.deepEqual(rv.getReviewCountByMode("1", false, "2026-11-02"), { grammar: 1, reading: 1 });
  assert.deepEqual(rv.getReviewCountByMode("1", true, "2026-11-02"), { grammar: 1 });
});

test("級を空にする・全部空にする", () => {
  rv.clearLevelReview("1");
  assert.equal(rv.getReviewCount("1"), 0);
  assert.ok(rv.getReviewCount("3", "2026-10-25") > 0, "ほかの級は残る");
});

test("勉強者ごとに別。GitHub 同期の対象", () => {
  setLearner("ZY");
  assert.equal(rv.getReviewCount("3", "2026-10-25"), 0);
  rv.recordReviewResult("3", "vocab", "v3-100", false, "2026-10-25");
  assert.ok(ls.getItem("eikenMistakesV1::ZY"));
  setLearner("ZWJ");
  assert.deepEqual(parseRecordKey("eikenMistakesV1"), { base: "eikenMistakesV1", learner: "ZWJ" });
});

test("バックアップ：錯題本が入り、件数を数える。古いバックアップを戻すと旧リストから作り直す", () => {
  assert.ok(BACKUP_KEYS.includes("eikenMistakesV1"));
  for (const k of ["eikenProgressV1", "eikenReviewV1", "eikenTestResultsV1", "eikenVocabTestResultsV1"]) assert.ok(BACKUP_KEYS.includes(k), k);
  const b = buildBackup();
  const n = Object.values(b.data.eikenMistakesV1.levels).reduce((s, lv) => s + Object.keys(lv.items).length, 0);
  assert.equal(describeBackup(b).reviewCount, n);
  // v1.40.0 までのバックアップ（錯題本なし）
  const old = { format: "eiken-study-backup", version: 1, data: { eikenReviewV1: { levels: { 5: [{ mode: "grammar", itemId: "g5-001", wrongCount: 1 }] } } } };
  assert.equal(describeBackup(old).reviewCount, 1);
  applyBackup(old);
  assert.equal(ls.getItem("eikenMistakesV1"), null, "錯題本を消して、次に読むときに作り直す");
  assert.deepEqual(rv.getReviewSummary("5", "2026-12-01"), { total: 1, due: 1, next: null });
  assert.equal(rv.getReviewCount("3", "2026-12-01"), 0, "戻したバックアップの中身だけになる");
});

console.log(`\n${passed} 件すべて OK\n`);
