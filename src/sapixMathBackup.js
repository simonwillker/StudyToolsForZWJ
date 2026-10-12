/* ============================================================
   Sapix 算数の学習記録のバックアップ（書き出し・読み込み）

   英検（eikenBackup.js）・CCAO-F（ccaofBackup.js）と同じ仕組み。
   学習記録は localStorage にしか無いので、端末を替えたり閲覧データを
   消したりすると消えてしまう。ファイルに書き出して戻せるようにする。
   ============================================================ */

import { learnerKey } from "./learner";
import { PROGRESS_KEY, REVIEW_KEY } from "./sapixMathProgress";

const FORMAT = "sapix-math-study-backup";
const FORMAT_VERSION = 1;

/** 書き出し・読み込みの対象。増やすときはここに足す。 */
export const BACKUP_KEYS = [
  PROGRESS_KEY, // 単元別・日別の学習記録
  REVIEW_KEY, // まちがえた問題の復習リスト
];

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
  const progress = d[PROGRESS_KEY] || {};
  let attempted = 0;
  let correct = 0;
  Object.values(progress.units || {}).forEach((u) => {
    attempted += u.attempted || 0;
    correct += u.correct || 0;
  });
  const days = Object.keys(progress.daily || {}).length;
  const units = Object.keys(progress.units || {}).length;
  const reviewCount = Object.values(d[REVIEW_KEY] || {}).reduce((s, list) => s + (Array.isArray(list) ? list.length : 0), 0);
  return { attempted, correct, days, units, reviewCount, exportedAt: backup?.exportedAt || null };
}

export function parseBackup(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: "ファイルを読み取れませんでした（JSONとして壊れています）。" };
  }
  if (!parsed || typeof parsed !== "object") return { ok: false, error: "ファイルの中身が正しくありません。" };
  if (parsed.format !== FORMAT) {
    const hint =
      parsed.format === "eiken-study-backup"
        ? "これは英検マスターのバックアップです。英検の画面から読み込んでください。"
        : parsed.format === "ccaof-study-backup"
        ? "これは CCAO-F のバックアップです。CCAO-F の画面から読み込んでください。"
        : "Sapix 算数のバックアップファイルではないようです。";
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
  return restored;
}

function pad(n) {
  return String(n).padStart(2, "0");
}

export function backupFileName(d = new Date()) {
  return `sapix-math-backup-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}.json`;
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
