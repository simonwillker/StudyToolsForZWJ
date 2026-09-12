/* ============================================================
   英検アプリ：音声まわりのユーティリティ
   ブラウザ標準の Web Speech API のみを使用（外部API・APIキー不要）
   ============================================================ */

export function isSpeechSynthesisSupported() {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

export function isSpeechRecognitionSupported() {
  return typeof window !== "undefined" && !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}

let cachedEnglishVoice = null;

function pickEnglishVoice() {
  if (!isSpeechSynthesisSupported()) return null;
  if (cachedEnglishVoice) return cachedEnglishVoice;
  const voices = window.speechSynthesis.getVoices() || [];
  const preferred =
    voices.find((v) => /en-US/i.test(v.lang) && /female|samantha|zira/i.test(v.name)) ||
    voices.find((v) => /en-US/i.test(v.lang)) ||
    voices.find((v) => /^en/i.test(v.lang));
  cachedEnglishVoice = preferred || null;
  return cachedEnglishVoice;
}

// 一部のブラウザは音声リストが非同期で読み込まれるため、変更イベントでキャッシュを更新する
if (isSpeechSynthesisSupported()) {
  try {
    window.speechSynthesis.onvoiceschanged = () => {
      cachedEnglishVoice = null;
    };
  } catch (e) {
    // 無視（対応していない環境）
  }
}

/**
 * 英文をTTSで読み上げる。
 * @param {string} text
 * @param {{rate?: number, pitch?: number}} opts
 */
export function speak(text, opts = {}) {
  if (!isSpeechSynthesisSupported() || !text) return;
  try {
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = "en-US";
    utter.rate = opts.rate ?? 0.92;
    utter.pitch = opts.pitch ?? 1;
    const voice = pickEnglishVoice();
    if (voice) utter.voice = voice;
    window.speechSynthesis.speak(utter);
  } catch (e) {
    // 無視（読み上げに失敗しても学習自体は継続できるようにする）
  }
}

export function stopSpeaking() {
  if (!isSpeechSynthesisSupported()) return;
  try {
    window.speechSynthesis.cancel();
  } catch (e) {
    // 無視
  }
}

/**
 * マイクから一度だけ音声認識する（発音練習用）。
 * @param {{onResult: (transcript: string) => void, onError?: (msg: string) => void, onEnd?: () => void}} handlers
 * @returns {{ stop: () => void } | null}
 */
export function listenOnce({ onResult, onError, onEnd }) {
  if (!isSpeechRecognitionSupported()) {
    onError && onError("このブラウザは音声認識に対応していません。読み上げを聞いてまねして発音練習をしてください。");
    return null;
  }
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const recognition = new SR();
  recognition.lang = "en-US";
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;

  recognition.onresult = (event) => {
    const transcript = event.results?.[0]?.[0]?.transcript || "";
    onResult && onResult(transcript);
  };
  recognition.onerror = (event) => {
    onError && onError(`音声認識でエラーが発生しました（${event.error}）。マイクの許可を確認してください。`);
  };
  recognition.onend = () => {
    onEnd && onEnd();
  };

  try {
    recognition.start();
  } catch (e) {
    onError && onError("音声認識を開始できませんでした。");
    return null;
  }

  return {
    stop: () => {
      try {
        recognition.stop();
      } catch (e) {
        // 無視
      }
    },
  };
}

function normalizeForCompare(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9' ]/g, "")
    .trim()
    .replace(/\s+/g, " ");
}

function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

/**
 * targetの文とspokenの文（音声認識結果）を比べて 0〜100 の近さスコアを返す。
 * 発音そのものの音響評価ではなく、認識されたテキストの一致度による簡易的な目安。
 */
export function scoreSimilarity(target, spoken) {
  const a = normalizeForCompare(target);
  const b = normalizeForCompare(spoken);
  if (!a || !b) return 0;
  const dist = levenshtein(a, b);
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 100;
  return Math.max(0, Math.round((1 - dist / maxLen) * 100));
}

export function similarityFeedback(score) {
  if (score >= 85) return "とても近い発音です！すばらしい！";
  if (score >= 60) return "おしい！もう一度チャレンジしてみましょう。";
  return "もう一度、お手本をよく聞いてからチャレンジしてみましょう。";
}
