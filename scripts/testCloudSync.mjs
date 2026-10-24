/* ============================================================
   GitHub 同期の合わせ方のテスト（通信はしない）

   - 同期するのは学習記録だけ（端末の設定は送らない）
   - キーごとに新しいほうを使う。消した記録（v: null）も新しければ勝つ
   - 時刻がどちらも無い（同期前からの記録）ときは中身の多いほう
   - 勉強履歴は 2 台ぶんの回を足し合わせる
   ============================================================ */

import assert from "node:assert/strict";
import { parseRecordKey, fullKeyOf, mergeRecords, mergeStudyLog, localRecords } from "../src/cloudSync.js";

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log("\nGitHub 同期のテスト\n");

test("学習記録のキーだけを同期の対象にする", () => {
  assert.deepEqual(parseRecordKey("eikenProgressV1"), { base: "eikenProgressV1", learner: "ZWJ" });
  assert.deepEqual(parseRecordKey("ccaofMistakesV1::ZY"), { base: "ccaofMistakesV1", learner: "ZY" });
  assert.deepEqual(parseRecordKey("sapixG5MathReviewV1::Guest"), { base: "sapixG5MathReviewV1", learner: "Guest" });
  assert.deepEqual(parseRecordKey("studyLogV1::ZY"), { base: "studyLogV1", learner: "ZY" });
  ["studyToolsActiveApp", "studyToolsSyncConfigV1", "studyToolsClaudeCopiedV1::ZY", "ccaofShowZh", "ccaofAudioSettings", "eikenProgressV1::Someone"].forEach((k) =>
    assert.equal(parseRecordKey(k), null, k)
  );
  assert.equal(fullKeyOf("eikenProgressV1", "ZWJ"), "eikenProgressV1");
  assert.equal(fullKeyOf("eikenProgressV1", "ZY"), "eikenProgressV1::ZY");
});

test("キーごとに新しいほう。消した記録も新しければ勝つ", () => {
  const m = mergeRecords(
    { a: { t: 200, v: "local" }, b: { t: 100, v: "old" }, c: { t: 300, v: null }, d: { t: 5, v: "only-local" } },
    { a: { t: 100, v: "remote" }, b: { t: 150, v: "new" }, c: { t: 250, v: "alive" }, e: { t: 9, v: "only-remote" } }
  );
  assert.equal(m.a.v, "local");
  assert.equal(m.b.v, "new");
  assert.equal(m.c.v, null);
  assert.equal(m.d.v, "only-local");
  assert.equal(m.e.v, "only-remote");
});

test("同期前からの記録（時刻なし）どうしは中身の多いほう", () => {
  const m = mergeRecords({ a: { t: 0, v: '{"x":1}' } }, { a: { t: 0, v: '{"x":1,"y":2}' } });
  assert.equal(m.a.v, '{"x":1,"y":2}');
});

test("勉強履歴は 2 台ぶんの回を足し合わせ、同じ回は 1 つにする", () => {
  const s1 = { app: "英検マスター", label: "3級 単語", startAt: "2026-10-24T01:00:00.000Z", attempted: 5, correct: 4 };
  const s1more = { ...s1, attempted: 8, correct: 6 };
  const s2 = { app: "CCAO-F 対策", label: "模擬試験", startAt: "2026-10-24T02:00:00.000Z", attempted: 60, correct: 45 };
  const s3 = { app: "Sapix 算数", label: "速さ", startAt: "2026-10-23T09:00:00.000Z", attempted: 20, correct: 18 };
  const a = { days: { "2026-10-24": { sessions: [s1] } }, updatedAt: "2026-10-24T01:05:00.000Z" };
  const b = { days: { "2026-10-24": { sessions: [s1more, s2] }, "2026-10-23": { sessions: [s3] } }, updatedAt: "2026-10-24T02:30:00.000Z" };
  const m = JSON.parse(mergeStudyLog(JSON.stringify(a), JSON.stringify(b)));
  assert.equal(m.days["2026-10-24"].sessions.length, 2);
  assert.equal(m.days["2026-10-24"].sessions[0].attempted, 8, "同じ回は解いた数が多いほう");
  assert.equal(m.days["2026-10-23"].sessions.length, 1);
  assert.equal(m.updatedAt, "2026-10-24T02:30:00.000Z");
  // mergeRecords からも履歴は足し合わせになる（時刻の新しさで片方を捨てない）
  const r = mergeRecords({ studyLogV1: { t: 10, v: JSON.stringify(a) } }, { studyLogV1: { t: 5, v: JSON.stringify({ days: { "2026-10-23": { sessions: [s3] } } }) } });
  assert.ok(JSON.parse(r.studyLogV1.v).days["2026-10-23"]);
  assert.ok(JSON.parse(r.studyLogV1.v).days["2026-10-24"]);
});

test("この端末の記録：その人のキーだけ、消した記録は v: null で入る", () => {
  const m = new Map(
    Object.entries({
      eikenProgressV1: "{}",
      "ccaofProgressV1::ZY": '{"z":1}',
      studyToolsActiveApp: "eiken",
      studyToolsSyncMetaV1: JSON.stringify({ eikenProgressV1: 111, "ccaofProgressV1::ZY": 222, "ccaofMistakesV1::ZY": 333 }),
    })
  );
  const st = { get length() { return m.size; }, key: (i) => [...m.keys()][i], getItem: (k) => (m.has(k) ? m.get(k) : null) };
  assert.deepEqual(localRecords("ZWJ", st), { eikenProgressV1: { t: 111, v: "{}" } });
  assert.deepEqual(localRecords("ZY", st), { ccaofProgressV1: { t: 222, v: '{"z":1}' }, ccaofMistakesV1: { t: 333, v: null } });
});

console.log(`\n✅ ${passed} 件すべて成功\n`);
