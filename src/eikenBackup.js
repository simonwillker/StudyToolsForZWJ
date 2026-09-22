/* ============================================================
   学習記録のバックアップ（書き出し・読み込み）

   学習記録はすべて localStorage にしか無い。つまり
   「別の端末に替えた」「ブラウザの閲覧データを消した」だけで
   連続日数も正答率も復習リストも一度に、取り返しがつかない形で消える。
   そのための保険として、1つのJSONファイルに書き出して戻せるようにする。

   バックアップするのは学習の履歴だけ。最後に開いていたアプリ
   （studyToolsActiveApp）のような画面の状態は対象にしない。
   ============================================================ */

const FORMAT = "eiken-study-backup";
const FORMAT_VERSION = 1;

/** 書き出し・読み込みの対象。増やすときはここに足す。 */
export const BACKUP_KEYS = [
  "eikenProgressV1", // 学習進捗（日別・モード別・級別）
  "eikenReviewV1", // まちがえた問題の復習リスト
  "eikenTestResultsV1", // 模擬テストの結果
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
  const progress = d.eikenProgressV1 || {};
  const levels = progress.levels || {};
  let attempted = 0;
  let correct = 0;
  Object.values(levels).forEach((modes) =>
    Object.values(modes).forEach((b) => {
      attempted += b.attempted || 0;
      correct += b.correct || 0;
    })
  );
  const days = Object.keys(progress.daily || {}).length;
  const review = d.eikenReviewV1 || {};
  const reviewCount = Object.values(review.levels || {}).reduce(
    (s, list) => s + (Array.isArray(list) ? list.length : 0),
    0
  );
  const tests = Object.values(d.eikenTestResultsV1 || {}).reduce(
    (s, v) => s + (Array.isArray(v) ? v.length : 0),
    0
  );
  return { attempted, correct, days, reviewCount, tests, exportedAt: backup?.exportedAt || null };
}

/** 読み込もうとしているファイルが本当にこのアプリのバックアップか確かめる。 */
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
    return { ok: false, error: "このアプリのバックアップファイルではないようです。" };
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
  return `eiken-backup-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}.json`;
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
