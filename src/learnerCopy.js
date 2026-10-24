/* ============================================================
   ZWJ の Claude 認定の記録を ZY に写す（v1.38.0、1 回だけ）

   v1.38.0 から Claude 認定は ZY だけが使う。それまで ZWJ として
   解いていた Claude 認定の記録（学習記録・錯題本・模試の結果・
   頻出単語・聞いた記録）と勉強履歴の Claude 認定の回を、ZY が
   はじめて選ばれたときに ZY のキーへ写す。
   - ZY に Claude 認定の記録が 1 つでもあれば写さない（上書きしない）
   - ZWJ の記録は消さない（コピーするだけ）
   - 写したら印を残し、2 回目からは何もしない
   ============================================================ */

import { CERTS } from "./claudeCert/certs.js";

const TO = "ZY";
const DONE_KEY = "studyToolsClaudeCopiedV1";
const LOG_KEY = "studyLogV1";

/** "ccaofProgressV1" など、資格ごとの学習記録のキー（勉強者の名前なし） */
function isCertRecordKey(key) {
  return CERTS.some((c) => key.startsWith(c.prefix)) && /^[a-z]+[A-Z]\w*V\d+$/.test(key);
}

function storageKeys(storage) {
  const keys = [];
  for (let i = 0; i < storage.length; i += 1) keys.push(storage.key(i));
  return keys;
}

function readJson(storage, key) {
  try {
    const raw = storage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

/** 勉強履歴から Claude 認定の回だけを取り出して、ZY の履歴に足す */
function copyClaudeHistory(storage) {
  const apps = new Set(CERTS.map((c) => c.studyApp));
  const from = readJson(storage, LOG_KEY);
  if (!from || !from.days) return 0;
  const toKey = `${LOG_KEY}::${TO}`;
  const to = readJson(storage, toKey) || { days: {}, updatedAt: null };
  if (!to.days) to.days = {};
  let copied = 0;
  Object.entries(from.days).forEach(([date, d]) => {
    const sessions = (d.sessions || []).filter((s) => apps.has(s.app));
    const entries = Object.entries(d.entries || {}).filter(([, e]) => apps.has(e.app));
    if (!sessions.length && !entries.length) return;
    const day = to.days[date] || (to.days[date] = {});
    if (sessions.length) day.sessions = [...sessions, ...(day.sessions || [])];
    if (entries.length) day.entries = { ...Object.fromEntries(entries), ...(day.entries || {}) };
    copied += sessions.length + entries.length;
  });
  if (copied) {
    to.updatedAt = to.updatedAt || from.updatedAt;
    storage.setItem(toKey, JSON.stringify(to));
  }
  return copied;
}

/**
 * ZY がはじめて選ばれたときに呼ぶ。写したキーの数を返す（写さなかったら 0）。
 * storage を渡せるのはテストのため。
 */
export function copyClaudeRecordsToZY(storage = window.localStorage) {
  try {
    if (storage.getItem(`${DONE_KEY}::${TO}`)) return 0;
    const keys = storageKeys(storage);
    const zyHas = keys.some((k) => k.endsWith(`::${TO}`) && isCertRecordKey(k.slice(0, -TO.length - 2)));
    let copied = 0;
    if (!zyHas) {
      keys.filter(isCertRecordKey).forEach((k) => {
        storage.setItem(`${k}::${TO}`, storage.getItem(k));
        copied += 1;
      });
      copied += copyClaudeHistory(storage);
    }
    storage.setItem(`${DONE_KEY}::${TO}`, new Date().toISOString());
    return copied;
  } catch (e) {
    // 写せなくても ZY はそのまま使える（記録が空から始まるだけ）
    return 0;
  }
}
