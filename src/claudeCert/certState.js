/* ============================================================
   Claude 認定：いま開いている資格

   保存キーや勉強履歴のアプリ名は資格ごとに違う。画面は 1 度に
   1 つの資格しか開かないので、開いた資格をここに 1 つだけ持ち、
   各モジュールは certKey() でキーを作る。

   ここは JSON も import.meta.glob も読まない（node のテスト
   scripts/testClaudeCertStudy.mjs から直接 import するため）。
   既定は CCAO-F。v1.31.0 までと同じキーになる。
   ============================================================ */

import { CERTS, findCert } from "./certs";

let active = CERTS[0];
/* ブループリント改訂でドメインが変わった問題（meta.json の movedItems）。
   学習記録の移しかえに使う。domains.js の activateCert が渡す */
let movedItems = null;

export function setActiveCertState(id, moved = null) {
  const c = findCert(id);
  if (!c || c.status !== "ready") throw new Error(`unknown cert: ${id}`);
  active = c;
  movedItems = moved;
  return c;
}

export function activeMovedItems() {
  return movedItems;
}

export function activeCert() {
  return active;
}

/** "ProgressV1" → "ccaofProgressV1"（CCAO-F）/ "ccarfProgressV1"（CCAR-F） */
export function certKey(suffix) {
  return active.prefix + suffix;
}
