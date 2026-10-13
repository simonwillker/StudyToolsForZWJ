/* ============================================================
   CCAO-F 音声読み上げ：英語・日本語・中文の声を言語ごとに使い分ける

   ブラウザ標準の Web Speech API（speechSynthesis）だけを使う。
   外部サービス・API キーは使わない。端末に入っている声で読むので、
   声の種類と質は端末ごとに違う（オフラインでも読める端末が多い）。

   ブラウザごとのくせ：
   - Chrome：発話オブジェクトがガベージコレクトされると onend が来ない
     → 読み終わるまで参照を持っておく。それでも来ないときのために時間切れも置く
   - Chrome：長い発話は15秒ほどで止まる → audioCore.js の splitSentences で分ける
   - pause()/resume() は端末によって効かない → 一時停止は cancel して、
     再開はその文の頭から読み直す
   ============================================================ */

import { utterancesOf } from "./audioCore";

const LOCALES = { en: ["en-US", "en-GB", "en"], ja: ["ja-JP", "ja"], zh: ["zh-CN", "zh-Hans", "cmn", "zh-TW", "zh-HK", "zh"] };
const LANG_TAG = { en: "en-US", ja: "ja-JP", zh: "zh-CN" };

export function isSpeechSupported() {
  return typeof window !== "undefined" && "speechSynthesis" in window && typeof window.SpeechSynthesisUtterance === "function";
}

let voiceCache = {};
let voicesKnown = false;

if (isSpeechSupported()) {
  try {
    // 英検側（eikenSpeech.js）が onvoiceschanged を使っているので、上書きしないよう addEventListener
    window.speechSynthesis.addEventListener("voiceschanged", () => {
      voiceCache = {};
      voicesKnown = true;
      listeners.forEach((fn) => fn());
    });
  } catch (e) {
    // 古いブラウザ。声は既定のものになる
  }
}

const listeners = new Set();
/** 声の一覧が読み込まれたら呼ぶ（「この端末に中文の声がない」表示を更新するため） */
export function onVoicesChanged(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function allVoices() {
  try {
    const v = window.speechSynthesis.getVoices() || [];
    if (v.length) voicesKnown = true;
    return v;
  } catch (e) {
    return [];
  }
}

export function voiceFor(lang) {
  if (!isSpeechSupported()) return null;
  if (lang in voiceCache) return voiceCache[lang];
  const voices = allVoices();
  const norm = (s) => String(s || "").replace("_", "-").toLowerCase();
  let found = null;
  for (const loc of LOCALES[lang] || []) {
    const l = loc.toLowerCase();
    const match = voices.filter((v) => norm(v.lang) === l || norm(v.lang).startsWith(l + "-"));
    // 端末内の声（localService）を優先：オフラインでも読める
    found = match.find((v) => v.localService) || match[0] || null;
    if (found) break;
  }
  if (voices.length) voiceCache[lang] = found;
  return found;
}

/**
 * その言語の声があるか。true / false、声の一覧がまだ分からないときは null
 * （iOS などは最初の読み上げまで一覧が空のことがある。そのときは読ませてみる）
 */
export function hasVoice(lang) {
  if (!isSpeechSupported()) return false;
  const voices = allVoices();
  if (!voices.length) return voicesKnown ? false : null;
  return !!voiceFor(lang);
}

const alive = new Set(); // Chrome の GC 対策で読み終わるまで持っておく

/** 1発話を読む。読み終わり・失敗・中断のどれでも resolve する */
function speakUtterance(text, lang, rate) {
  return new Promise((resolve) => {
    let finished = false;
    let u;
    const done = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      alive.delete(u);
      resolve();
    };
    // onend が来ない端末の保険：ふつうに読んだときの3倍＋5秒で次へ進む
    const timer = setTimeout(done, ((text.length * 90) / rate) * 3 + 5000);
    try {
      u = new window.SpeechSynthesisUtterance(text);
      u.lang = LANG_TAG[lang] || lang;
      u.rate = rate;
      const v = voiceFor(lang);
      if (v) u.voice = v;
      u.onend = done;
      u.onerror = done;
      alive.add(u);
      window.speechSynthesis.speak(u);
    } catch (e) {
      done();
    }
  });
}

let generation = 0;

/** いま読んでいるものをすべて止める */
export function stopSpeech() {
  generation += 1;
  if (currentKey !== null) setCurrentKey(null);
  if (!isSpeechSupported()) return;
  try {
    window.speechSynthesis.cancel();
  } catch (e) {
    // 無視
  }
}

/**
 * 読み上げ1つ（{lang, text}）を、文ごとに分けて順に読む。
 * stopSpeech() が呼ばれたら途中でやめて false を返す。最後まで読めたら true。
 * 最初の発話は await より前に speak() するので、タップの処理の中から呼べば
 * iOS でも音が出る（ユーザー操作の中でないと読まない端末がある）。
 */
export async function speakStep(s, rate = 1) {
  if (!isSpeechSupported()) return false;
  const my = generation;
  for (const u of utterancesOf(s)) {
    if (my !== generation) return false;
    await speakUtterance(u.text, u.lang, rate);
  }
  return my === generation;
}

/* ---------- 個別の🔊ボタン用：どのボタンが読んでいるかを知らせる ---------- */

let currentKey = null;
const keyListeners = new Set();

function setCurrentKey(k) {
  currentKey = k;
  keyListeners.forEach((fn) => fn(k));
}

export function onSpeakingKeyChange(fn) {
  keyListeners.add(fn);
  return () => keyListeners.delete(fn);
}

export function speakingKey() {
  return currentKey;
}

/** 🔊ボタン：segments（{lang,text} の配列）を順に読む。同じボタンをもう一度押すと止まる */
export async function toggleSpeak(key, segments, rate) {
  if (currentKey === key) {
    stopSpeech();
    setCurrentKey(null);
    return;
  }
  stopSpeech();
  setCurrentKey(key);
  const my = generation;
  for (const s of segments) {
    const ok = await speakStep(s, rate);
    if (!ok) break;
  }
  if (my === generation) setCurrentKey(null);
}

/** 音声モードが始まるときなど、🔊ボタンの表示を消す */
export function clearSpeakingKey() {
  setCurrentKey(null);
}
