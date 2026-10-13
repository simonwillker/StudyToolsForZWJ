/* ============================================================
   Sapix の保存キーと旧形式からの移行のテスト

   学年別にしたあとも、v1.28.0 までの学習記録（localStorage）と
   バックアップがそのまま読めることを確かめる。

   - 4年の 5 科目のキーが v1.28.0 までと同じ（sapixMathProgressV1 など）
   - 4年以外のキーは 4年のキーとも、学年どうしでもぶつからない
   - 勉強履歴の名前（4年）が v1.28.0 までと同じ「Sapix 算数」など
   - トップ画面の「最後に開いたアプリ」の古い値（"sapixMath" など）が
     "sapix" ＋ 4年のその科目に移る。ほかの値はそのまま
   - データのある学年・科目（src/data/sapix/）から作るバックアップの
     キーに、v1.28.0 のバックアップのキーがすべて入っている
   ============================================================ */

import assert from "node:assert/strict";
import { readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { GRADES, SUBJECT_DEFS, storageKeys, logTitle, migrateActiveApp } from "../src/sapixStorage.js";

const here = dirname(fileURLToPath(import.meta.url));
let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

/** v1.28.0 の sapixSubjects.js にあったキーと勉強履歴の名前 */
const V128 = {
  math: ["sapixMathProgressV1", "sapixMathReviewV1", "Sapix 算数"],
  kokugo: ["sapixKokugoProgressV1", "sapixKokugoReviewV1", "Sapix 国語"],
  shakai: ["sapixShakaiProgressV1", "sapixShakaiReviewV1", "Sapix 社会"],
  rika: ["sapixRikaProgressV1", "sapixRikaReviewV1", "Sapix 理科"],
  eigo: ["sapixEigoProgressV1", "sapixEigoReviewV1", "Sapix 英語"],
};

console.log("\nSapix 保存キー・移行のテスト\n");

test("4年の保存キーが v1.28.0 と同じ", () => {
  for (const [s, [p, r]] of Object.entries(V128)) assert.deepEqual(storageKeys(4, s), { progressKey: p, reviewKey: r });
});

test("4年の勉強履歴の名前が v1.28.0 と同じ", () => {
  for (const [s, [, , title]] of Object.entries(V128)) assert.equal(logTitle(4, s), title);
});

test("全学年×全科目のキーが重ならない", () => {
  const all = GRADES.flatMap((g) => SUBJECT_DEFS.flatMap((d) => Object.values(storageKeys(g, d.id))));
  assert.equal(new Set(all).size, all.length);
  assert.deepEqual(storageKeys(5, "math"), { progressKey: "sapixG5MathProgressV1", reviewKey: "sapixG5MathReviewV1" });
});

test("最後に開いたアプリの旧形式（科目ごとのカード）を移行する", () => {
  assert.deepEqual(migrateActiveApp("sapixMath"), { app: "sapix", course: { grade: 4, subject: "math" } });
  assert.deepEqual(migrateActiveApp("sapixKokugo"), { app: "sapix", course: { grade: 4, subject: "kokugo" } });
  assert.deepEqual(migrateActiveApp("sapixShakai"), { app: "sapix", course: { grade: 4, subject: "shakai" } });
  assert.deepEqual(migrateActiveApp("sapixRika"), { app: "sapix", course: { grade: 4, subject: "rika" } });
  assert.deepEqual(migrateActiveApp("sapixEigo"), { app: "sapix", course: { grade: 4, subject: "eigo" } });
});

test("ほかのアプリの値はそのまま", () => {
  for (const v of ["menu", "drill", "eiken", "ccaof", "sapix"]) assert.deepEqual(migrateActiveApp(v), { app: v, course: null });
  assert.deepEqual(migrateActiveApp(null), { app: "menu", course: null });
});

test("移行を 2 回かけても変わらない（保存し直した値をもう一度読んでも同じ）", () => {
  const once = migrateActiveApp("sapixRika").app;
  assert.deepEqual(migrateActiveApp(once), { app: "sapix", course: null });
});

test("バックアップの対象に v1.28.0 のキーがすべて入る", () => {
  // sapixBackup.js の BACKUP_KEYS と同じ作り方（データのある学年・科目のキー）
  const sapixDir = join(here, "..", "src", "data", "sapix");
  const keys = GRADES.flatMap((g) =>
    SUBJECT_DEFS.filter((d) => existsSync(join(sapixDir, `g${g}`, d.id, "meta.json"))).flatMap((d) => Object.values(storageKeys(g, d.id)))
  );
  for (const [p, r] of Object.values(V128)) {
    assert.ok(keys.includes(p), `${p} がバックアップの対象に無い`);
    assert.ok(keys.includes(r), `${r} がバックアップの対象に無い`);
  }
  assert.ok(readdirSync(sapixDir).includes("g4"));
});

console.log(`\n✅ ${passed} 件すべて通りました。\n`);
