/* ============================================================
   勉強者ごとに使うアプリのテスト

   - ZY は Claude 認定だけ、ZWJ は Claude 認定以外、Guest は全部
   - アプリ選択画面と勉強履歴はだれでも開ける
   - 「最後に開いたアプリ」は勉強者ごと（ZWJ は以前からのキー）
   ============================================================ */

import assert from "node:assert/strict";
import { LEARNERS, canUseApp, learnerKey } from "../src/learner.js";

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

console.log(`\n✅ ${passed} 件すべて成功\n`);
