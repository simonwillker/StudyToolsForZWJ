/* ============================================================
   CCAO-F の学習記録のバックアップ（書き出し・読み込み）

   英検側（eikenBackup.js）と同じ考え方。学習記録は localStorage に
   しか無いため、端末を替える／ブラウザの閲覧データを消すだけで
   解いた履歴も復習リストも模試の結果も一度に消える。

   受験中の一時保存（ccaofExamInProgressV1）は対象にしない。
   中断した模試を別の端末で再開できてもうれしくないし、
   120分の残り時間は端末の時計に紐づいているため戻す意味がない。
   ============================================================ */

const FORMAT = "ccaof-study-backup";
const FORMAT_VERSION = 1;

/** 書き出し・読み込みの対象。増やすときはここに足す。 */
export const BACKUP_KEYS = [
  "ccaofProgressV1", // ドメイン別・日別の学習進捗
  "ccaofReviewV1", // まちがえた問題の復習リスト
  "ccaofExamResultsV1", // 模擬試験の結果（最大20件）
];

function readKey(key) {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

/** 現在の記録をバックアップ用のオブジェクトにまとめる。 */
export function buildBackup() {
  const data = {};
  BACKUP_KEYS.forEach((k) => {
    const v = readKey(k);
    if (v !== null) data[k] = v;
  });
  return {
    format: FORMAT,
    version: FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    data,
  };
}

/** バックアップの中身を人間が読める形にする。読み込む前の確認に使う。 */
export function describeBackup(backup) {
  const d = (backup && backup.data) || {};
  const progress = d.ccaofProgressV1 || {};
  let attempted = 0;
  let correct = 0;
  Object.values(progress.domains || {}).forEach((b) => {
    attempted += b.attempted || 0;
    correct += b.correct || 0;
  });
  const days = Object.keys(progress.daily || {}).length;
  const reviewCount = Object.values(d.ccaofReviewV1 || {}).reduce(
    (s, list) => s + (Array.isArray(list) ? list.length : 0),
    0
  );
  const results = d.ccaofExamResultsV1;
  const exams = Array.isArray(results) ? results.length : 0;
  return { attempted, correct, days, reviewCount, exams, exportedAt: backup?.exportedAt || null };
}

/** 読み込もうとしているファイルが本当に CCAO-F のバックアップか確かめる。 */
export function parseBackup(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: "ファイルを読み取れませんでした（JSONとして壊れています）。" };
  }
  if (!parsed || typeof parsed !== "object") {
    return { ok: false, error: "ファイルの中身が正しくありません。" };
  }
  if (parsed.format !== FORMAT) {
    // 英検のバックアップを取り違えて読ませようとしたときに、理由が分かるようにする
    const hint =
      parsed.format === "eiken-study-backup"
        ? "これは英検マスターのバックアップです。英検の画面から読み込んでください。"
        : "CCAO-F のバックアップファイルではないようです。";
    return { ok: false, error: hint };
  }
  if (typeof parsed.version !== "number" || parsed.version > FORMAT_VERSION) {
    return {
      ok: false,
      error: "新しい形式のバックアップです。アプリを最新にしてからもう一度お試しください。",
    };
  }
  if (!parsed.data || typeof parsed.data !== "object") {
    return { ok: false, error: "バックアップに学習記録が入っていません。" };
  }
  // 見覚えのないキーは復元しない（別アプリのデータを書き込まないため）
  const known = Object.keys(parsed.data).filter((k) => BACKUP_KEYS.includes(k));
  if (known.length === 0) {
    return { ok: false, error: "復元できる学習記録が見つかりませんでした。" };
  }
  return { ok: true, backup: parsed, keys: known };
}

/** 検証済みのバックアップを実際に書き戻す。既存の記録は置き換えられる。 */
export function applyBackup(backup) {
  const restored = [];
  BACKUP_KEYS.forEach((k) => {
    const v = backup.data[k];
    if (v === undefined) return;
    try {
      window.localStorage.setItem(k, JSON.stringify(v));
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

/** 日付入りのファイル名。複数世代を残しても区別できるようにする。 */
export function backupFileName(d = new Date()) {
  return `ccaof-backup-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}.json`;
}

/** バックアップをファイルとして保存させる。オフラインでも動く。 */
export function downloadBackup() {
  const backup = buildBackup();
  const blob = new Blob([JSON.stringify(backup, null, 2)], {
    type: "application/json",
  });
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
