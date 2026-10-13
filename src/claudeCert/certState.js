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

export function setActiveCertState(id) {
  const c = findCert(id);
  if (!c || c.status !== "ready") throw new Error(`unknown cert: ${id}`);
  active = c;
  return c;
}

export function activeCert() {
  return active;
}

/** "ProgressV1" → "ccaofProgressV1"（CCAO-F）/ "ccarfProgressV1"（CCAR-F） */
export function certKey(suffix) {
  return active.prefix + suffix;
}
