/* ============================================================
   Sapix（算数・国語・社会・理科・英語）の学習記録のバックアップ

   英検（eikenBackup.js）・Claude 認定（claudeCert/backup.js）と同じ仕組み。
   学習記録は localStorage にしか無いので、端末を替えたり閲覧データを
   消したりすると消えてしまう。ファイルに書き出して戻せるようにする。

   どの学年・科目の画面から書き出しても、Sapix の全学年・全科目ぶんをまとめて書き出す
   （教科ごとにファイルが分かれると、戻しわすれが起きやすいため）。
   v1.26.0 の「Sapix 算数」だけのバックアップ（sapix-math-study-backup）も
   読み込める。
   ============================================================ */

import { learnerKey } from "./learner";
import { COURSES } from "./sapixSubjects";

const FORMAT = "sapix-study-backup";
const LEGACY_MATH_FORMAT = "sapix-math-study-backup";
const FORMAT_VERSION = 1;

/** 書き出し・読み込みの対象。学年・科目を足すと自動でふえる（4年のキーは v1.28.0 までと同じ）。
 *  錯題本・まとめテストは v1.41.0 から。それより前のバックアップを戻すと、復習リストから錯題本を作り直す。 */
export const BACKUP_KEYS = COURSES.flatMap((s) => [s.progressKey, s.reviewKey, s.mistakesKey, s.testKey]);

function readKey(key) {
  try {
    const raw = window.localStorage.getItem(learnerKey(key));
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

export function buildBackup() {
  const data = {};
  BACKUP_KEYS.forEach((k) => {
    const v = readKey(k);
    if (v !== null) data[k] = v;
  });
  return { format: FORMAT, version: FORMAT_VERSION, exportedAt: new Date().toISOString(), data };
}

/** バックアップの中身を人が読める形にする。読み込む前の確認に使う。 */
export function describeBackup(backup) {
  const d = (backup && backup.data) || {};
  let attempted = 0;
  let correct = 0;
  let reviewCount = 0;
  let tests = 0;
  const days = new Set();
  const subjects = [];
  COURSES.forEach((s) => {
    const progress = d[s.progressKey] || {};
    let a = 0;
    Object.values(progress.units || {}).forEach((u) => {
      a += u.attempted || 0;
      correct += u.correct || 0;
    });
    attempted += a;
    Object.keys(progress.daily || {}).forEach((day) => days.add(day));
    // 錯題本があればその件数、無ければ（v1.40.0 までのバックアップ）復習リストの件数
    const mk = d[s.mistakesKey];
    reviewCount += mk && mk.items
      ? Object.keys(mk.items).length
      : Object.values(d[s.reviewKey] || {}).reduce((n, list) => n + (Array.isArray(list) ? list.length : 0), 0);
    tests += Array.isArray(d[s.testKey] && d[s.testKey].results) ? d[s.testKey].results.length : 0;
    if (a) subjects.push(`${s.title} ${a}問`);
  });
  return { attempted, correct, days: days.size, reviewCount, tests, subjects, exportedAt: backup?.exportedAt || null };
}

export function parseBackup(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: "ファイルを読み取れませんでした（JSONとして壊れています）。" };
  }
  if (!parsed || typeof parsed !== "object") return { ok: false, error: "ファイルの中身が正しくありません。" };
  if (parsed.format !== FORMAT && parsed.format !== LEGACY_MATH_FORMAT) {
    const hint =
      parsed.format === "eiken-study-backup"
        ? "これは英検マスターのバックアップです。英検の画面から読み込んでください。"
        : parsed.format === "ccaof-study-backup"
        ? "これは CCAO-F のバックアップです。CCAO-F の画面から読み込んでください。"
        : "Sapix のバックアップファイルではないようです。";
    return { ok: false, error: hint };
  }
  if (typeof parsed.version !== "number" || parsed.version > FORMAT_VERSION)
    return { ok: false, error: "新しい形式のバックアップです。アプリを最新にしてからもう一度お試しください。" };
  if (!parsed.data || typeof parsed.data !== "object") return { ok: false, error: "バックアップに学習記録が入っていません。" };
  // 見覚えのないキーは復元しない（別アプリのデータを書き込まないため）
  const known = Object.keys(parsed.data).filter((k) => BACKUP_KEYS.includes(k));
  if (known.length === 0) return { ok: false, error: "復元できる学習記録が見つかりませんでした。" };
  return { ok: true, backup: parsed, keys: known };
}

/** 検証済みのバックアップを書き戻す。バックアップに入っている教科の記録だけが置き換わる。 */
export function applyBackup(backup) {
  const restored = [];
  BACKUP_KEYS.forEach((k) => {
    const v = backup.data[k];
    if (v === undefined) return;
    try {
      window.localStorage.setItem(learnerKey(k), JSON.stringify(v));
      restored.push(k);
    } catch (e) {
      // 容量超過など。書けたものはそのまま残す。
    }
  });
  // 錯題本の無い古いバックアップ（v1.40.0 まで）：復習リストを戻したので、錯題本を消して作り直させる
  COURSES.forEach((s) => {
    if (backup.data[s.reviewKey] !== undefined && backup.data[s.mistakesKey] === undefined) {
      try {
        window.localStorage.removeItem(learnerKey(s.mistakesKey));
      } catch (e) {
        // 消せなければ今の錯題本のまま
      }
    }
  });
  return restored;
}

function pad(n) {
  return String(n).padStart(2, "0");
}

export function backupFileName(d = new Date()) {
  return `sapix-backup-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}.json`;
}

export function downloadBackup() {
  const backup = buildBackup();
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = backupFileName();
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // すぐ revoke するとダウンロードが始まらない環境があるため少し待つ
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return describeBackup(backup);
}
