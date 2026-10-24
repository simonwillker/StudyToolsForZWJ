/* ============================================================
   学習記録の GitHub 同期

   学習記録は端末の localStorage にある。iPad・iPhone・PC のどれで
   使っても同じ記録になるように、非公開の GitHub リポジトリ
   （例：simonwillker/StudyToolsData）に勉強者ごとの JSON を置いて
   出し入れする。サーバーは持たず、ブラウザから GitHub API を直接呼ぶ。

   - 同期する記録：英検・Sapix・Claude 認定の学習記録と勉強履歴
     （isRecordKey）。最後に開いたアプリ・音声設定など端末の設定は同期しない。
   - ファイル：progress/<勉強者>.json
     { format, version, learner, updatedAt, keys: { 基本キー: { t, v } } }
     v は localStorage の値（文字列そのまま）、t は最後に書いた時刻（ms）。
     リセットなどで消した記録は v: null で残す（ほかの端末から生き返らないように）。
   - 合わせ方：キーごとに新しいほう（t が大きいほう）を使う。
     勉強履歴（studyLogV1）だけは両方の回を足し合わせる
     （2 台で同じ日に勉強しても、どちらの回も残るように）。
   - いつ：勉強者を選んだとき（先に取り込んでから開く）、記録が変わって
     しばらくしたとき、画面を閉じる・裏に回すとき、「今すぐ同期」。
   - トークン（fine-grained、そのリポジトリの Contents 読み書きだけ）は
     この端末の localStorage にだけ置く。リポジトリにもコードにも入れない。
   ============================================================ */

import { LEARNERS } from "./learner.js";

const CONFIG_KEY = "studyToolsSyncConfigV1";
/** フルキー → 最後に書いた時刻（ms）。同期の判定にだけ使う */
const META_KEY = "studyToolsSyncMetaV1";
const STATUS_KEY = "studyToolsSyncStatusV1";
const FORMAT = "studytools-sync";
const FORMAT_VERSION = 1;
const LOG_BASE = "studyLogV1";

/** 同期する学習記録の基本キー（勉強者の名前なし） */
const RECORD_RE = /^(eiken|sapix|ccaof|ccarf|ccdvf|ccarp|studyLog)[A-Za-z0-9]*V\d+$/;

/** "eikenProgressV1::ZY" → { base: "eikenProgressV1", learner: "ZY" }。記録でなければ null */
export function parseRecordKey(fullKey) {
  if (typeof fullKey !== "string") return null;
  const i = fullKey.indexOf("::");
  const base = i < 0 ? fullKey : fullKey.slice(0, i);
  const learner = i < 0 ? "ZWJ" : fullKey.slice(i + 2);
  if (!RECORD_RE.test(base)) return null;
  if (!LEARNERS.some((l) => l.id === learner)) return null;
  return { base, learner };
}

export function fullKeyOf(base, learner) {
  return learner === "ZWJ" ? base : `${base}::${learner}`;
}

/* ---------- 合わせ方（画面にも通信にも触らない） ---------- */

function parseJson(s) {
  try {
    return JSON.parse(s);
  } catch (e) {
    return null;
  }
}

/** 勉強履歴を 2 つ足し合わせる。同じ回（アプリ・内容・始めた時刻が同じ）は解いた数が多いほうを残す */
export function mergeStudyLog(aStr, bStr) {
  const a = parseJson(aStr) || { days: {} };
  const b = parseJson(bStr) || { days: {} };
  const out = { days: {}, updatedAt: [a.updatedAt, b.updatedAt].filter(Boolean).sort().pop() || null };
  const dates = new Set([...Object.keys(a.days || {}), ...Object.keys(b.days || {})]);
  [...dates].sort().forEach((date) => {
    const da = (a.days || {})[date] || {};
    const db = (b.days || {})[date] || {};
    const day = {};
    const sessions = new Map();
    [...(da.sessions || []), ...(db.sessions || [])].forEach((s) => {
      const k = `${s.app}｜${s.label}｜${s.startAt}`;
      const cur = sessions.get(k);
      if (!cur || (s.attempted || 0) > (cur.attempted || 0)) sessions.set(k, s);
    });
    if (sessions.size) {
      day.sessions = [...sessions.values()].sort((x, y) => String(x.startAt).localeCompare(String(y.startAt)));
    }
    const entries = { ...(da.entries || {}) };
    Object.entries(db.entries || {}).forEach(([k, e]) => {
      if (!entries[k] || (e.attempted || 0) > (entries[k].attempted || 0)) entries[k] = e;
    });
    if (Object.keys(entries).length) day.entries = entries;
    out.days[date] = day;
  });
  return JSON.stringify(out);
}

/**
 * 1 人ぶんの記録を合わせる。local / remote は { 基本キー: { t, v } }。
 * 新しいほうを使う。時刻が同じ（どちらも同期前からの記録で時刻なし）なら中身の多いほう。
 */
export function mergeRecords(local, remote) {
  const out = {};
  const keys = new Set([...Object.keys(local || {}), ...Object.keys(remote || {})]);
  keys.forEach((k) => {
    const l = (local || {})[k];
    const r = (remote || {})[k];
    if (!l) return void (out[k] = r);
    if (!r) return void (out[k] = l);
    if (k === LOG_BASE && l.v != null && r.v != null) {
      const v = mergeStudyLog(l.v, r.v);
      return void (out[k] = { t: Math.max(l.t || 0, r.t || 0), v });
    }
    if ((l.t || 0) !== (r.t || 0)) return void (out[k] = (l.t || 0) > (r.t || 0) ? l : r);
    out[k] = (l.v || "").length >= (r.v || "").length ? l : r;
  });
  return out;
}

/* ---------- この端末の記録 ---------- */

function storage() {
  return window.localStorage;
}

function readMeta() {
  return parseJson(storage().getItem(META_KEY)) || {};
}

/** この端末にある、その人の記録 { 基本キー: { t, v } }。消した記録は v: null */
export function localRecords(learner, st = storage()) {
  const meta = parseJson(st.getItem(META_KEY)) || {};
  const out = {};
  const keys = new Set(Object.keys(meta));
  for (let i = 0; i < st.length; i += 1) keys.add(st.key(i));
  keys.forEach((k) => {
    const p = parseRecordKey(k);
    if (!p || p.learner !== learner) return;
    const v = st.getItem(k);
    if (v === null && !meta[k]) return;
    out[p.base] = { t: meta[k] || 0, v };
  });
  return out;
}

/* ---------- 書いた時刻の記録（各アプリの保存を横取りして時刻だけ残す） ---------- */

let dirty = false;
let applying = false;
const listeners = new Set();

/** main.jsx から 1 回だけ呼ぶ。学習記録が書かれたら、その時刻を覚えて同期を予約する */
export function installSyncTracking() {
  if (typeof Storage === "undefined" || Storage.prototype.__studySync) return;
  const origGet = Storage.prototype.getItem;
  const origSet = Storage.prototype.setItem;
  const origRemove = Storage.prototype.removeItem;
  const touch = (st, key) => {
    if (applying || st !== window.localStorage || !parseRecordKey(key)) return;
    try {
      const meta = parseJson(origGet.call(st, META_KEY)) || {};
      meta[key] = Date.now();
      origSet.call(st, META_KEY, JSON.stringify(meta));
    } catch (e) {
      // 時刻を残せなくても記録そのものは保存されている
    }
    dirty = true;
    scheduleSync();
  };
  Storage.prototype.setItem = function setItem(key, value) {
    origSet.call(this, key, value);
    touch(this, key);
  };
  Storage.prototype.removeItem = function removeItem(key) {
    origRemove.call(this, key);
    touch(this, key);
  };
  Storage.prototype.__studySync = true;

  // 画面を閉じる・裏に回すときに送っておく（iPhone はそのまま止まることがあるので）
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && dirty) syncNow().catch(() => {});
  });
}

let timer = null;
/** 記録が変わってから少し待って送る（1 問ごとに送らないため） */
function scheduleSync() {
  if (!getSyncConfig()) return;
  clearTimeout(timer);
  timer = setTimeout(() => syncNow().catch(() => {}), 20000);
}

/* ---------- 設定 ---------- */

export function getSyncConfig() {
  const c = parseJson(storage().getItem(CONFIG_KEY));
  return c && c.owner && c.repo && c.token ? c : null;
}

export function setSyncConfig(c) {
  if (!c) storage().removeItem(CONFIG_KEY);
  else storage().setItem(CONFIG_KEY, JSON.stringify({ owner: c.owner.trim(), repo: c.repo.trim(), token: c.token.trim() }));
  notify();
}

export function getSyncStatus() {
  return parseJson(storage().getItem(STATUS_KEY)) || { at: null, ok: null, message: "" };
}

function setStatus(ok, message) {
  storage().setItem(STATUS_KEY, JSON.stringify({ at: new Date().toISOString(), ok, message }));
  notify();
}

export function onSyncStatus(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify() {
  listeners.forEach((fn) => fn(getSyncStatus()));
}

/* ---------- GitHub API ---------- */

function b64encode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function b64decode(b64) {
  const bin = atob(b64.replace(/\n/g, ""));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function api(cfg, path, init = {}) {
  return fetch(`https://api.github.com/repos/${cfg.owner}/${cfg.repo}${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init.headers || {}),
    },
  });
}

class SyncError extends Error {}

function explain(res) {
  if (res.status === 401) return "トークンが正しくないか、期限が切れています";
  if (res.status === 403) return "トークンにこのリポジトリの Contents 読み書きの権限がありません";
  if (res.status === 404) return "リポジトリが見つかりません（名前と、トークンの対象リポジトリを確認）";
  return `GitHub が ${res.status} を返しました`;
}

/** progress/<learner>.json を読む。無ければ { sha: null, keys: {} } */
async function readRemote(cfg, learner) {
  const path = `/contents/progress/${encodeURIComponent(learner)}.json`;
  const res = await api(cfg, path);
  if (res.status === 404) {
    // リポジトリが無いのか、ファイルがまだ無いのかを分ける
    const repo = await api(cfg, "");
    if (!repo.ok) throw new SyncError(explain(repo));
    return { sha: null, keys: {} };
  }
  if (!res.ok) throw new SyncError(explain(res));
  const meta = await res.json();
  let text = meta.content ? b64decode(meta.content) : "";
  if (!text && meta.size > 0) {
    // 1MB を超えると content が空で返るので、中身だけ取り直す
    const raw = await api(cfg, path, { headers: { Accept: "application/vnd.github.raw+json" } });
    if (!raw.ok) throw new SyncError(explain(raw));
    text = await raw.text();
  }
  const data = parseJson(text);
  if (!data || data.format !== FORMAT) return { sha: meta.sha, keys: {} };
  return { sha: meta.sha, keys: data.keys || {} };
}

async function writeRemote(cfg, learner, keys, sha) {
  const body = {
    format: FORMAT,
    version: FORMAT_VERSION,
    learner,
    updatedAt: new Date().toISOString(),
    keys,
  };
  const res = await api(cfg, `/contents/progress/${encodeURIComponent(learner)}.json`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: `学習記録を同期（${learner}）`,
      content: b64encode(JSON.stringify(body)),
      ...(sha ? { sha } : {}),
    }),
  });
  if (res.status === 409 || res.status === 422) return false; // ほかの端末が先に書いた
  if (!res.ok) throw new SyncError(explain(res));
  return true;
}

/** 合わせた結果をこの端末に書く。書いても「変わった」とは数えない */
function applyLocal(learner, merged) {
  const st = storage();
  const meta = readMeta();
  let changed = 0;
  applying = true;
  try {
    Object.entries(merged).forEach(([base, r]) => {
      const k = fullKeyOf(base, learner);
      if (st.getItem(k) !== r.v) {
        if (r.v == null) st.removeItem(k);
        else st.setItem(k, r.v);
        changed += 1;
      }
      meta[k] = r.t || 0;
    });
    st.setItem(META_KEY, JSON.stringify(meta));
  } finally {
    applying = false;
  }
  return changed;
}

function sameRecords(a, b) {
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  return ka.every((k) => b[k] && b[k].v === a[k].v && (b[k].t || 0) === (a[k].t || 0));
}

async function syncLearner(cfg, learner) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const remote = await readRemote(cfg, learner);
    const merged = mergeRecords(localRecords(learner), remote.keys);
    const pulled = applyLocal(learner, merged);
    if (sameRecords(merged, remote.keys)) return { pulled, pushed: false };
    if (await writeRemote(cfg, learner, merged, remote.sha)) return { pulled, pushed: true };
  }
  throw new SyncError("ほかの端末と同時に書いたため、同期できませんでした。もう一度お試しください");
}

let running = null;

/**
 * 全員ぶんを同期する（勉強履歴でほかの人の記録も見られるように）。
 * 返り値：{ ok, pulled（この端末で変わった記録の数）, message }
 */
export function syncNow() {
  const cfg = getSyncConfig();
  if (!cfg) return Promise.resolve({ ok: false, pulled: 0, message: "同期の設定がありません" });
  if (!navigator.onLine) return Promise.resolve({ ok: false, pulled: 0, message: "オフラインです" });
  if (running) return running;
  clearTimeout(timer);
  running = (async () => {
    try {
      dirty = false;
      let pulled = 0;
      for (const l of LEARNERS) pulled += (await syncLearner(cfg, l.id)).pulled;
      setStatus(true, pulled ? `${pulled} 件の記録を取り込みました` : "同期しました");
      return { ok: true, pulled, message: "同期しました" };
    } catch (e) {
      dirty = true;
      const message = e instanceof SyncError ? e.message : "通信できませんでした";
      setStatus(false, message);
      return { ok: false, pulled: 0, message };
    } finally {
      running = null;
    }
  })();
  return running;
}
