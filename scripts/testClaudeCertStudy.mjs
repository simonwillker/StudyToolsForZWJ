/* ============================================================
   Claude 認定（CCAO-F / CCAR-F）の考点・錯題本・合格予測・バックアップのテスト
   （v1.31.0〜。v1.32.0 で資格ごとのキー分け・旧アプリ id の移行・シナリオ模試を追加）

   - 錯題本：まちがえる → 1日後 → 3日後 →（まちがえたら 1日後に戻る）
     → 2回続けて正解で外れる。期限前の正解は数えない
   - 旧形式（ccaofReviewV1 の復習リスト）からの移行が 1 回だけ行われる
   - 勉強者ごとに別キーで保存される（ZWJ は名前なし、ほかは ::名前）
   - バックアップに錯題本が入り、v1.30.0 までのバックアップ（錯題本なし）を
     戻すと、復元した復習リストから錯題本が作り直される
   - 考点別の成績は、これまでの問題ごとの記録から集計できる
   - 弱い考点の選び方・合格予測（データ不足のときは出さない）
   ============================================================ */

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { register } from "node:module";

/* src/ の import は拡張子を省いている（vite 用）。node でも読めるよう .js を補う */
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

/* ---------- ブラウザの代わり ---------- */
function makeStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    clear: () => m.clear(),
    keys: () => [...m.keys()],
  };
}
globalThis.window = { localStorage: makeStorage(), sessionStorage: makeStorage() };

const here = dirname(fileURLToPath(import.meta.url));
const certRoot = join(here, "..", "src", "data", "claudeCert");
const dataDir = join(certRoot, "ccaof");
const meta = JSON.parse(readFileSync(join(dataDir, "meta.json"), "utf8"));
const lessons = JSON.parse(readFileSync(join(dataDir, "lessons.json"), "utf8")).lessons;
const allItems = readdirSync(dataDir)
  .filter((f) => /^d\d+-.*\.json$/.test(f))
  .flatMap((f) => JSON.parse(readFileSync(join(dataDir, f), "utf8")).items);

const core = await import("../src/claudeCert/studyCore.js");
const mistakes = await import("../src/claudeCert/mistakes.js");
const backup = await import("../src/claudeCert/backup.js");
const certState = await import("../src/claudeCert/certState.js");
const certs = await import("../src/claudeCert/certs.js");
const learner = await import("../src/learner.js");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}
const ls = window.localStorage;
function resetAll() {
  ls.clear();
  window.sessionStorage.clear();
}

console.log("\nClaude 認定 考点・錯題本・合格予測・資格切り替えのテスト\n");

/* ---------- 錯題本の間隔 ---------- */

test("addDays は月末・年末をまたいでも日付で数える", () => {
  assert.equal(core.addDays("2026-10-31", 1), "2026-11-01");
  assert.equal(core.addDays("2026-12-30", 3), "2027-01-02");
  assert.equal(core.addDays("2026-03-07", 7), "2026-03-14");
});

test("まちがえる → 1日後 → 3日後 → 2回連続正解で外れる", () => {
  const item = { id: "d1-001", domain: "D1" };
  let s = core.applyMistakeAnswer(core.emptyMistakes(), item, false, "2026-10-13");
  assert.equal(s.items["d1-001"].due, "2026-10-14");
  assert.deepEqual(core.dueMistakeIds(s, "2026-10-13"), []);
  assert.deepEqual(core.dueMistakeIds(s, "2026-10-14"), ["d1-001"]);
  s = core.applyMistakeAnswer(s, item, true, "2026-10-14");
  assert.equal(s.items["d1-001"].due, "2026-10-17");
  assert.equal(s.items["d1-001"].streak, 1);
  s = core.applyMistakeAnswer(s, item, true, "2026-10-17");
  assert.equal(s.items["d1-001"], undefined);
});

test("期限前の正解は数えない（同じ日にすぐ正解しても外れない）", () => {
  const item = { id: "d2-001", domain: "D2" };
  let s = core.applyMistakeAnswer(core.emptyMistakes(), item, false, "2026-10-13");
  s = core.applyMistakeAnswer(s, item, true, "2026-10-13");
  assert.equal(s.items["d2-001"].streak, 0);
  assert.equal(s.items["d2-001"].due, "2026-10-14");
});

test("途中でまちがえると 1日後に戻り、次の正解で 7日後まで空ける", () => {
  const item = { id: "d3-001", domain: "D3" };
  let s = core.applyMistakeAnswer(core.emptyMistakes(), item, false, "2026-10-01");
  s = core.applyMistakeAnswer(s, item, true, "2026-10-02"); // → 3日後
  s = core.applyMistakeAnswer(s, item, false, "2026-10-05"); // → 1日後、連続はリセット
  assert.equal(s.items["d3-001"].due, "2026-10-06");
  assert.equal(s.items["d3-001"].streak, 0);
  assert.equal(s.items["d3-001"].wrongCount, 2);
  s = core.applyMistakeAnswer(s, item, true, "2026-10-06"); // 2回目の正解 → 7日後
  assert.equal(s.items["d3-001"].due, "2026-10-13");
  s = core.applyMistakeAnswer(s, item, true, "2026-10-13");
  assert.equal(s.items["d3-001"], undefined);
});

test("錯題本に無い問題の正解では何も起きない／元の store は変えない", () => {
  const s0 = core.emptyMistakes();
  const s1 = core.applyMistakeAnswer(s0, { id: "x", domain: "D1" }, true, "2026-10-13");
  assert.deepEqual(s1.items, {});
  const s2 = core.applyMistakeAnswer(s0, { id: "x", domain: "D1" }, false, "2026-10-13");
  assert.deepEqual(s0.items, {});
  assert.ok(s2.items.x);
});

/* ---------- 保存と旧形式からの移行 ---------- */

test("旧形式の復習リスト（ccaofReviewV1）が錯題本に 1 回だけ移る", () => {
  resetAll();
  ls.setItem("ccaofReviewV1", JSON.stringify({ D1: ["d1-001", "d1-002"], D5: ["d5-003"], D2: [] }));
  const s = mistakes.loadMistakes("2026-10-13");
  assert.deepEqual(Object.keys(s.items).sort(), ["d1-001", "d1-002", "d5-003"]);
  assert.equal(s.items["d5-003"].domain, "D5");
  assert.equal(s.items["d1-001"].due, "2026-10-13"); // きょうから復習できる
  assert.equal(s.migratedReview, true);
  // 旧リストは消さない（ドメイン画面の「復習する」で使い続ける）
  assert.ok(ls.getItem("ccaofReviewV1"));
  // 錯題本から外れたあと、旧リストから再び移ってこない
  mistakes.recordMistakeAnswer({ id: "d1-001", domain: "D1" }, true, "2026-10-13");
  mistakes.recordMistakeAnswer({ id: "d1-001", domain: "D1" }, true, "2026-10-16");
  assert.equal(mistakes.loadMistakes("2026-10-16").items["d1-001"], undefined);
  assert.equal(mistakes.getMistakeSummary("2026-10-16").total, 2);
});

test("勉強者ごとに別のキーに保存する（ZWJ は従来どおり名前なし）", () => {
  resetAll();
  learner.setLearner("ZWJ");
  mistakes.recordMistakeAnswer({ id: "d1-010", domain: "D1" }, false, "2026-10-13");
  learner.setLearner("ZY");
  mistakes.recordMistakeAnswer({ id: "d2-010", domain: "D2" }, false, "2026-10-13");
  assert.ok(JSON.parse(ls.getItem("ccaofMistakesV1")).items["d1-010"]);
  assert.ok(JSON.parse(ls.getItem("ccaofMistakesV1::ZY")).items["d2-010"]);
  assert.equal(mistakes.getMistakeSummary("2026-10-14").total, 1);
  assert.deepEqual(mistakes.getDueMistakeIds("2026-10-14"), ["d2-010"]);
  learner.clearLearner();
});

test("バックアップに錯題本が入り、そのまま戻せる", () => {
  resetAll();
  ls.setItem("ccaofProgressV1", JSON.stringify({ domains: { D1: { attempted: 1, correct: 0, items: { "d1-001": { seen: 1, correct: 0 } } } }, daily: {} }));
  mistakes.recordMistakeAnswer({ id: "d1-001", domain: "D1" }, false, "2026-10-13");
  const b = backup.buildBackup();
  assert.ok(backup.backupKeys().includes("ccaofMistakesV1"));
  assert.ok(b.data.ccaofMistakesV1.items["d1-001"]);
  assert.equal(backup.describeBackup(b).mistakeCount, 1);
  const text = JSON.stringify(b);
  resetAll();
  const parsed = backup.parseBackup(text);
  assert.equal(parsed.ok, true);
  backup.applyBackup(parsed.backup);
  assert.equal(mistakes.getMistakeSummary("2026-10-14").due, 1);
});

test("v1.30.0 までのバックアップ（錯題本なし）を戻すと、復習リストから作り直す", () => {
  resetAll();
  // 今の端末には別の錯題本がある
  mistakes.recordMistakeAnswer({ id: "d7-001", domain: "D7" }, false, "2026-10-13");
  const old = {
    format: "ccaof-study-backup",
    version: 1,
    exportedAt: "2026-09-01T00:00:00.000Z",
    data: {
      ccaofProgressV1: { domains: {}, daily: {} },
      ccaofReviewV1: { D3: ["d3-005"] },
    },
  };
  const parsed = backup.parseBackup(JSON.stringify(old));
  assert.equal(parsed.ok, true);
  assert.equal(backup.describeBackup(parsed.backup).mistakeCount, null);
  backup.applyBackup(parsed.backup);
  const s = mistakes.loadMistakes("2026-10-13");
  assert.deepEqual(Object.keys(s.items), ["d3-005"]);
});

test("学習記録のリセット後、旧リストが残っていても錯題本は空のまま", () => {
  resetAll();
  mistakes.recordMistakeAnswer({ id: "d1-001", domain: "D1" }, false, "2026-10-13");
  mistakes.resetMistakes();
  ls.setItem("ccaofReviewV1", JSON.stringify({ D1: ["d1-001"] }));
  assert.equal(mistakes.getMistakeSummary("2026-10-14").total, 0);
});

/* ---------- 考点 ---------- */

const objectives = core.buildObjectives(meta);
const index = core.buildObjectiveIndex(meta, lessons);

test("考点は 30 個で、全問題がどれかの考点に入る", () => {
  assert.equal(objectives.length, 30);
  assert.equal(objectives[0].id, "D1-1");
  const unmapped = allItems.filter((i) => !index.get(i.objective));
  assert.deepEqual(unmapped.map((i) => i.id), []);
  // エスカレーション（competency）の問題は D4-5 で練習できる
  const esc = allItems.find((i) => i.objective.startsWith("Recognize limitations"));
  assert.equal(index.get(esc.objective), "D4-5");
});

test("考点別の成績は、これまでの問題ごとの記録から集計される", () => {
  const d11 = allItems.filter((i) => index.get(i.objective) === "D1-1").slice(0, 3);
  const progress = {
    domains: {
      D1: {
        attempted: 4,
        correct: 2,
        items: {
          [d11[0].id]: { seen: 2, correct: 1 },
          [d11[1].id]: { seen: 1, correct: 1 },
          [d11[2].id]: { seen: 1, correct: 0 },
        },
      },
    },
    daily: {},
  };
  const stats = core.collectObjectiveStats(allItems, progress, index);
  assert.deepEqual(
    { a: stats["D1-1"].attempted, c: stats["D1-1"].correct, s: stats["D1-1"].seenItems },
    { a: 4, c: 2, s: 3 }
  );
  assert.equal(stats["D1-2"].attempted, 0);
  assert.equal(stats["D1-1"].totalItems, allItems.filter((i) => index.get(i.objective) === "D1-1").length);
});

test("弱い考点：解答数が足りる考点を正答率順、足りなければ少ない考点で補う", () => {
  const stats = {};
  objectives.forEach((o) => (stats[o.id] = { attempted: 0, correct: 0 }));
  stats["D1-1"] = { attempted: 10, correct: 9 };
  stats["D2-3"] = { attempted: 6, correct: 2 };
  stats["D7-1"] = { attempted: 2, correct: 0 }; // 0% だが数が少ないので「弱い」とは言わない
  const r = core.rankWeakObjectives(objectives, stats);
  assert.equal(r.judgeableCount, 2);
  assert.deepEqual(r.picks.map((p) => [p.id, p.reason]), [["D2-3", "weak"], ["D1-1", "weak"], ["D2-1", "few"]]);
});

test("練習の問題は まちがえ → 未解答 → 解答済み の順に選ぶ", () => {
  const items = [
    { id: "a", domain: "D1" },
    { id: "b", domain: "D1" },
    { id: "c", domain: "D1" },
  ];
  const progress = { domains: { D1: { items: { a: { seen: 1, correct: 1 }, c: { seen: 1, correct: 0 } } } } };
  const picked = core.pickPracticeItems(items, progress, new Set(["c"]), 3);
  assert.deepEqual(picked.map((i) => i.id), ["c", "b", "a"]);
});

/* ---------- 合格予測 ---------- */

const fmt = meta.examFormat;
function statsWith(acc, attempted = 10) {
  const s = {};
  objectives.forEach((o) => (s[o.id] = { attempted, correct: Math.round(attempted * acc) }));
  return s;
}

test("データが無いときは予測を出さない", () => {
  const p = core.predictScore({ results: [], objectives, objectiveStats: statsWith(0, 0), domains: meta.domains, examFormat: fmt });
  assert.equal(p.ready, false);
  assert.match(p.reason, /まだ予測できません/);
});

test("模試だけ：直近ほど重く平均、確からしさは中以下", () => {
  const p = core.predictScore({
    results: [{ scaled: 700 }, { scaled: 640 }],
    objectives,
    objectiveStats: statsWith(0, 0),
    domains: meta.domains,
    examFormat: fmt,
  });
  assert.equal(p.ready, true);
  assert.equal(p.predicted, Math.round((3 * 700 + 2 * 640) / 5));
  assert.equal(p.confidence, "中");
  assert.equal(p.gap, 720 - p.predicted);
  assert.equal(p.questionsShort, Math.ceil(p.gap / 15));
});

test("演習だけ：配点で加重した正答率を 100〜1000 に直す", () => {
  const stats = statsWith(0.8);
  // D2（配点21%）だけ 50%
  objectives.filter((o) => o.domain === "D2").forEach((o) => (stats[o.id] = { attempted: 10, correct: 5 }));
  const p = core.predictScore({ results: [], objectives, objectiveStats: stats, domains: meta.domains, examFormat: fmt });
  const acc = (0.8 * 79 + 0.5 * 21) / 100;
  assert.equal(p.practiceScaled, Math.round(100 + 900 * acc));
  assert.equal(p.predicted, p.practiceScaled);
  assert.equal(p.coveredWeight, 100);
  assert.equal(p.confidence, "低");
});

test("演習の材料が配点の 60% 未満なら演習からは出さない", () => {
  const stats = statsWith(0, 0);
  objectives.filter((o) => o.domain === "D1" || o.domain === "D2").forEach((o) => (stats[o.id] = { attempted: 10, correct: 7 }));
  const p = core.predictScore({ results: [], objectives, objectiveStats: stats, domains: meta.domains, examFormat: fmt });
  assert.equal(p.coveredWeight, 35);
  assert.equal(p.ready, false);
});

test("模試と演習の両方：6:4 で混ぜ、合格ラインを超えれば gap は 0 以下", () => {
  const p = core.predictScore({
    results: [{ scaled: 800 }, { scaled: 760 }, { scaled: 700 }, { scaled: 100 }],
    objectives,
    objectiveStats: statsWith(0.9),
    domains: meta.domains,
    examFormat: fmt,
  });
  const exam = Math.round((3 * 800 + 2 * 760 + 1 * 700) / 6);
  assert.equal(p.examScaled, exam);
  assert.equal(p.predicted, Math.round(0.6 * exam + 0.4 * 910));
  assert.equal(p.confidence, "高");
  assert.ok(p.gap <= 0);
  assert.equal(p.questionsShort, 0);
});

test("次にやること：復習 → 弱い考点 → 模試 の順で最大 3 行", () => {
  const lines = core.nextActions({
    prediction: { ready: false, examCount: 0 },
    dueCount: 4,
    weak: [{ id: "D2-3", text: "x", pct: 33, reason: "weak" }],
    titles: { "D2-3": "事实核查" },
  });
  assert.equal(lines.length, 3);
  assert.match(lines[0], /4 問/);
  assert.match(lines[1], /D2-3「事实核查」/);
  assert.match(lines[2], /模擬試験/);
});

/* ---------- v1.32.0：資格ごとのキー・旧アプリ id の移行・CCAR-F ---------- */

const arDir = join(certRoot, "ccarf");
const arMeta = JSON.parse(readFileSync(join(arDir, "meta.json"), "utf8"));
const arLessons = JSON.parse(readFileSync(join(arDir, "lessons.json"), "utf8")).lessons;
const arItems = readdirSync(arDir)
  .filter((f) => /^d\d+-.*\.json$/.test(f))
  .flatMap((f) => JSON.parse(readFileSync(join(arDir, f), "utf8")).items);

test("既定の資格は CCAO-F で、キーは v1.31.0 までと 1 文字も変わらない", () => {
  certState.setActiveCertState("ccaof");
  assert.equal(certState.certKey("ProgressV1"), "ccaofProgressV1");
  assert.deepEqual(backup.backupKeys(), ["ccaofProgressV1", "ccaofReviewV1", "ccaofExamResultsV1", "ccaofVocabV1", "ccaofMistakesV1", "ccaofListenV1"]);
  assert.equal(mistakes.mistakesKey(), "ccaofMistakesV1");
});

test("v1.31.0 の CCAO-F の記録（錯題本・復習リスト）が新しいコードでそのまま読める", () => {
  resetAll();
  certState.setActiveCertState("ccaof");
  ls.setItem("ccaofMistakesV1", JSON.stringify({ version: 1, migratedReview: true, items: { "d2-007": { domain: "D2", due: "2026-10-01", streak: 0, corrects: 0, wrongCount: 2 } } }));
  ls.setItem("ccaofReviewV1", JSON.stringify({ D2: ["d2-007"] }));
  const sum = mistakes.getMistakeSummary("2026-10-13");
  assert.equal(sum.total, 1);
  assert.deepEqual(mistakes.getDueMistakeIds("2026-10-13"), ["d2-007"]);
});

test("CCAR-F の記録は ccarf* の別キーに入り、CCAO-F の記録と混ざらない", () => {
  resetAll();
  certState.setActiveCertState("ccaof");
  mistakes.recordMistakeAnswer({ id: "d1-001", domain: "D1" }, false, "2026-10-13");
  certState.setActiveCertState("ccarf");
  assert.equal(mistakes.getMistakeSummary("2026-10-13").total, 0);
  mistakes.recordMistakeAnswer({ id: "ar1-001", domain: "D1" }, false, "2026-10-13");
  assert.ok(JSON.parse(ls.getItem("ccarfMistakesV1")).items["ar1-001"]);
  assert.equal(JSON.parse(ls.getItem("ccaofMistakesV1")).items["ar1-001"], undefined);
  learner.setLearner("ZY");
  mistakes.recordMistakeAnswer({ id: "ar2-001", domain: "D2" }, false, "2026-10-13");
  assert.ok(JSON.parse(ls.getItem("ccarfMistakesV1::ZY")).items["ar2-001"]);
  learner.clearLearner();
  certState.setActiveCertState("ccaof");
  assert.deepEqual(Object.keys(mistakes.loadMistakes("2026-10-13").items), ["d1-001"]);
});

test("バックアップは資格ごと：CCAR-F のファイルを CCAO-F に読ませると理由つきで断る", () => {
  resetAll();
  certState.setActiveCertState("ccarf");
  ls.setItem("ccarfProgressV1", JSON.stringify({ domains: { D1: { attempted: 3, correct: 2, items: {} } }, daily: {} }));
  const b = backup.buildBackup();
  assert.equal(b.format, "ccarf-study-backup");
  assert.deepEqual(Object.keys(b.data), ["ccarfProgressV1"]);
  assert.equal(backup.describeBackup(b).attempted, 3);
  assert.match(backup.backupFileName(new Date(2026, 9, 13)), /^ccarf-backup-20261013\.json$/);
  certState.setActiveCertState("ccaof");
  const r = backup.parseBackup(JSON.stringify(b));
  assert.equal(r.ok, false);
  assert.match(r.error, /CCAR-F/);
  // 旧 CCAO-F のバックアップは従来どおり CCAO-F で読める
  const old = { format: "ccaof-study-backup", version: 1, data: { ccaofProgressV1: { domains: {}, daily: {} } } };
  assert.equal(backup.parseBackup(JSON.stringify(old)).ok, true);
});

test("トップの旧アプリ id \"ccaof\" は \"claudeCert\" に直し、CCAO-F を開く", () => {
  assert.deepEqual(certs.migrateClaudeCertApp("ccaof"), { app: "claudeCert", cert: "ccaof" });
  assert.deepEqual(certs.migrateClaudeCertApp("eiken"), { app: "eiken", cert: null });
  assert.deepEqual(certs.migrateClaudeCertApp(null), { app: null, cert: null });
});

test("CCAR-F：30 考点・各ドメイン 75 問以上・全問がどれかの考点とシナリオ（あれば）に入る", () => {
  const objs = core.buildObjectives(arMeta);
  assert.equal(objs.length, 30);
  const idx = core.buildObjectiveIndex(arMeta, arLessons);
  assert.deepEqual(arItems.filter((i) => !idx.get(i.objective)).map((i) => i.id), []);
  arMeta.domains.forEach((d) => assert.ok(arItems.filter((i) => i.domain === d.id).length >= 75, d.id));
  const sc = new Set(arMeta.scenarios.map((x) => x.id));
  assert.deepEqual(arItems.filter((i) => i.scenario && !sc.has(i.scenario)).map((i) => i.id), []);
  assert.equal(arLessons.length, 30);
});

test("CCAR-F 模試：6 シナリオから 4 つ、各 15 問、シナリオごとにまとまり、配点に近い", () => {
  for (let run = 0; run < 30; run += 1) {
    const shuffle = (a) => {
      const x = [...a];
      for (let i = x.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [x[i], x[j]] = [x[j], x[i]];
      }
      return x;
    };
    const q = core.pickScenarioExam(arItems, { scenarios: arMeta.scenarios, domains: arMeta.domains, scenariosPerExam: 4, total: 60, shuffle });
    assert.equal(q.length, 60);
    assert.equal(new Set(q.map((i) => i.id)).size, 60);
    const order = [];
    q.forEach((i) => { if (order[order.length - 1] !== i.scenario) order.push(i.scenario); });
    assert.equal(order.length, 4, "シナリオごとに連続して並ぶ");
    order.forEach((sid) => assert.equal(q.filter((i) => i.scenario === sid).length, 15));
    // どの抽選でもドメインの偏りが極端にならない（配点 27/18/20/20/15% → 60問で ±9問以内）
    const target = core.blueprintCounts(arMeta.domains, 60);
    arMeta.domains.forEach((d) => {
      const n = q.filter((i) => i.domain === d.id).length;
      assert.ok(Math.abs(n - target[d.id]) <= 9, `${d.id} ${n} vs ${target[d.id]}`);
    });
  }
});

test("blueprintCounts は合計を必ず total に合わせる", () => {
  const c = core.blueprintCounts(arMeta.domains, 60);
  assert.equal(Object.values(c).reduce((a, b) => a + b, 0), 60);
  assert.deepEqual(c, { D1: 16, D2: 11, D3: 12, D4: 12, D5: 9 });
});

/* ---------- CCDV-F（配点が小数の資格） ---------- */
const dvDir = join(certRoot, "ccdvf");
const dvMeta = JSON.parse(readFileSync(join(dvDir, "meta.json"), "utf8"));
const dvItems = readdirSync(dvDir)
  .filter((f) => /^d\d+-.*\.json$/.test(f))
  .flatMap((f) => JSON.parse(readFileSync(join(dvDir, f), "utf8")).items);

test("CCDV-F：小数の配点でも 53 問の内訳が合計 53 になり、各ドメインに足りる問題がある", () => {
  const c = core.blueprintCounts(dvMeta.domains, dvMeta.examFormat.items);
  assert.equal(Object.values(c).reduce((a, b) => a + b, 0), 53);
  assert.deepEqual(c, { D1: 8, D2: 17, D3: 2, D4: 1, D5: 9, D6: 6, D7: 4, D8: 6 }, "最大剰余法：33.1% の D2 は 17.54 → 17 問");
  dvMeta.domains.forEach((d) => {
    const n = dvItems.filter((i) => i.domain === d.id).length;
    assert.ok(n >= c[d.id] * 2, `${d.id}: ${n} 問（模試 2 回分 ${c[d.id] * 2} 問以上ほしい）`);
  });
});

test("CCDV-F は選べる資格になっていて、記録は ccdvf* の別キーに入る", () => {
  resetAll();
  const cert = certs.findCert("ccdvf");
  assert.equal(cert.status, "ready");
  certState.setActiveCertState("ccdvf");
  mistakes.recordMistakeAnswer({ id: "dv1-001", domain: "D1" }, false);
  assert.ok(JSON.parse(ls.getItem("ccdvfMistakesV1")).items["dv1-001"]);
  assert.equal(ls.getItem("ccaofMistakesV1"), null);
  certState.setActiveCertState("ccaof");
});

test("合格予測：小数の配点でも「配点の何%ぶん」は小数第 1 位まで", () => {
  const objectives = core.buildObjectives(dvMeta);
  const stats = {};
  objectives.forEach((o) => {
    if (o.domain === "D1" || o.domain === "D2" || o.domain === "D5") stats[o.id] = { attempted: 10, correct: 8 };
  });
  const p = core.predictScore({ results: [], objectives, objectiveStats: stats, domains: dvMeta.domains, examFormat: dvMeta.examFormat });
  assert.equal(p.coveredWeight, 64.6);
});

console.log(`\n✅ ${passed} 件すべて成功\n`);
