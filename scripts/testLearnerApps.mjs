/* ============================================================
   勉強者ごとに使うアプリのテスト

   - ZY は Claude 認定だけ、ZWJ は Claude 認定以外、Guest は全部
   - アプリ選択画面と勉強履歴はだれでも開ける
   - 「最後に開いたアプリ」は勉強者ごと（ZWJ は以前からのキー）
   ============================================================ */

import assert from "node:assert/strict";
import { LEARNERS, canUseApp, learnerKey } from "../src/learner.js";
import { copyClaudeRecordsToZY } from "../src/learnerCopy.js";

/** localStorage の代わり */
function memStorage(init = {}) {
  const m = new Map(Object.entries(init));
  return {
    get length() { return m.size; },
    key: (i) => [...m.keys()][i] ?? null,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    map: m,
  };
}

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log("\n勉強者ごとのアプリのテスト\n");

const APPS = ["drill", "eiken", "claudeCert", "sapix"];
const allowed = (id) => APPS.filter((a) => canUseApp(id, a));

test("ZY は Claude 認定だけ", () => {
  assert.deepEqual(allowed("ZY"), ["claudeCert"]);
});

test("ZWJ は Claude 認定以外", () => {
  assert.deepEqual(allowed("ZWJ"), ["drill", "eiken", "sapix"]);
});

test("Guest は全部", () => {
  assert.deepEqual(allowed("Guest"), APPS);
});

test("メニューと勉強履歴はだれでも、知らない人はアプリを開けない", () => {
  LEARNERS.forEach((l) => {
    assert.ok(canUseApp(l.id, "menu"));
    assert.ok(canUseApp(l.id, "history"));
  });
  assert.equal(canUseApp("someone", "drill"), false);
});

test("最後に開いたアプリは勉強者ごと（ZWJ は以前からのキー）", () => {
  assert.equal(learnerKey("studyToolsActiveApp", "ZWJ"), "studyToolsActiveApp");
  assert.equal(learnerKey("studyToolsActiveApp", "ZY"), "studyToolsActiveApp::ZY");
  assert.equal(learnerKey("studyToolsActiveApp", null), "studyToolsActiveApp");
});

test("ZWJ の Claude 認定の記録と履歴を ZY に 1 回だけ写す（ZWJ の分は消さない）", () => {
  const log = {
    days: {
      "2026-10-20": {
        sessions: [
          { app: "CCAO-F 対策", label: "模擬試験", attempted: 3, correct: 2 },
          { app: "英検マスター", label: "3級 単語・熟語", attempted: 5, correct: 5 },
        ],
      },
    },
    updatedAt: "2026-10-20T10:00:00.000Z",
  };
  const s = memStorage({
    ccaofProgressV1: '{"a":1}',
    ccaofMistakesV1: '{"items":{}}',
    ccarfExamResultsV1: "[]",
    ccaofShowZh: "1",
    eikenProgressV1: "{}",
    studyLogV1: JSON.stringify(log),
  });
  assert.ok(copyClaudeRecordsToZY(s) > 0);
  assert.equal(s.getItem("ccaofProgressV1::ZY"), '{"a":1}');
  assert.equal(s.getItem("ccaofMistakesV1::ZY"), '{"items":{}}');
  assert.equal(s.getItem("ccarfExamResultsV1::ZY"), "[]");
  assert.equal(s.getItem("ccaofShowZh::ZY"), null, "端末の設定は写さない");
  assert.equal(s.getItem("eikenProgressV1::ZY"), null, "英検は写さない");
  assert.equal(s.getItem("ccaofProgressV1"), '{"a":1}', "ZWJ の記録は残る");
  const zyLog = JSON.parse(s.getItem("studyLogV1::ZY"));
  assert.deepEqual(zyLog.days["2026-10-20"].sessions.map((x) => x.app), ["CCAO-F 対策"], "履歴は Claude 認定の回だけ");
  // 2 回目は何もしない（ZY が進めた記録を上書きしない）
  s.setItem("ccaofProgressV1::ZY", '{"a":2}');
  assert.equal(copyClaudeRecordsToZY(s), 0);
  assert.equal(s.getItem("ccaofProgressV1::ZY"), '{"a":2}');
});

test("ZY にすでに Claude 認定の記録があれば写さない", () => {
  const s = memStorage({ ccaofProgressV1: '{"a":1}', "ccdvfProgressV1::ZY": '{"z":1}' });
  assert.equal(copyClaudeRecordsToZY(s), 0);
  assert.equal(s.getItem("ccaofProgressV1::ZY"), null);
});

console.log(`\n✅ ${passed} 件すべて成功\n`);
