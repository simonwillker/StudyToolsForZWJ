import React, { useState, useMemo, useCallback, useRef, useEffect } from "react";
import RIKA_DB from "./data/rika.json";
import SHAKAI_DB from "./data/shakai.json";
import KOKUGO_DB from "./data/kokugo.json";
import EIGO_DB from "./data/eigo.json";
import EIKEN_DB from "./data/eiken.json";

/* ============================================================
   ユーティリティ
   ============================================================ */

const gcd = (a, b) => {
  a = Math.abs(a); b = Math.abs(b);
  while (b) { [a, b] = [b, a % b]; }
  return a || 1;
};

const toHankaku = (str) =>
  str.replace(/[０-９．－／]/g, (c) => {
    const map = { "０":"0","１":"1","２":"2","３":"3","４":"4","５":"5","６":"6","７":"7","８":"8","９":"9","．":".","－":"-","／":"/" };
    return map[c] ?? c;
  });

const normalizeText = (s) =>
  toHankaku(String(s ?? ""))
    .trim()
    .replace(/\s+/g, "")
    .replace(/[、。！？]/g, "");

const parseNumericAnswer = (raw) => {
  const s = toHankaku(String(raw ?? "")).trim();
  if (s.includes("/")) {
    const [n, d] = s.split("/").map((x) => parseFloat(x));
    if (!isNaN(n) && !isNaN(d) && d !== 0) return n / d;
    return NaN;
  }
  return parseFloat(s);
};

const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const pick = (arr) => arr[randInt(0, arr.length - 1)];
const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randInt(0, i);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

/* ============================================================
   算数ドリル自動生成
   ============================================================ */

function genFraction() {
  const denoms = [2, 3, 4, 5, 6, 8, 9, 10, 12];
  const d1 = pick(denoms), d2 = pick(denoms);
  const n1 = randInt(1, d1 - 1), n2 = randInt(1, d2 - 1);
  const op = pick(["+", "-", "×", "÷"]);
  let rn, rd;
  if (op === "+") { rn = n1 * d2 + n2 * d1; rd = d1 * d2; }
  else if (op === "-") {
    if (n1 / d1 < n2 / d2) return genFraction();
    rn = n1 * d2 - n2 * d1; rd = d1 * d2;
  } else if (op === "×") { rn = n1 * n2; rd = d1 * d2; }
  else { rn = n1 * d2; rd = d1 * n2; }
  const g = gcd(rn, rd);
  rn /= g; rd /= g;
  const answer = rn / rd;
  return {
    text: `${n1}/${d1} ${op} ${n2}/${d2} = ?`,
    hint: `分数で答えてね（例：${rn}/${rd}）`,
    answer,
    accept: (raw) => Math.abs(parseNumericAnswer(raw) - answer) < 0.001,
    display: rd === 1 ? `${rn}` : `${rn}/${rd}`,
    grade: "5〜6年",
  };
}

function genDecimal() {
  const op = pick(["+", "-", "×"]);
  const a = randInt(1, 90) / 10;
  const b = randInt(1, 90) / 10;
  let answer, text;
  if (op === "+") { answer = +(a + b).toFixed(2); text = `${a} + ${b} = ?`; }
  else if (op === "-") {
    const [x, y] = a >= b ? [a, b] : [b, a];
    answer = +(x - y).toFixed(2); text = `${x} - ${y} = ?`;
  } else { answer = +(a * b).toFixed(2); text = `${a} × ${b} = ?`; }
  return {
    text,
    hint: "小数で答えてね",
    answer,
    accept: (raw) => Math.abs(parseNumericAnswer(raw) - answer) < 0.02,
    display: `${answer}`,
    grade: "4〜5年",
  };
}

function genPercent() {
  if (Math.random() < 0.5) {
    const base = pick([200, 300, 400, 500, 600, 800, 1000]);
    const pct = pick([5, 10, 15, 20, 25, 30, 40, 50, 75]);
    const answer = (base * pct) / 100;
    return {
      text: `${base}円の${pct}％はいくらですか。`,
      hint: "「円」まで書かなくても数字だけでOK",
      answer,
      accept: (raw) => Math.abs(parseNumericAnswer(raw) - answer) < 0.5,
      display: `${answer}円`,
      grade: "5年",
    };
  }
  const whole = pick([40, 50, 80, 120, 150, 200, 250]);
  const pct = pick([10, 20, 25, 40, 50, 60, 75]);
  const part = Math.round((whole * pct) / 100);
  return {
    text: `${part}人は${whole}人の何％ですか。`,
    hint: "％の数字だけ答えてね",
    answer: pct,
    accept: (raw) => Math.abs(parseNumericAnswer(raw) - pct) < 0.5,
    display: `${pct}％`,
    grade: "5年",
  };
}

function genRatio() {
  const base = pick([2, 3, 4, 5]);
  const m1 = randInt(2, 6), m2 = randInt(2, 6);
  if (m1 === m2) return genRatio();
  const a = base * m1, b = base * m2;
  const answer = +(a / b).toFixed(3);
  return {
    text: `${a} : ${b} を比の値で表すと？`,
    hint: "小数で答えてね（割り切れないときは四捨五入でOK）",
    answer,
    accept: (raw) => Math.abs(parseNumericAnswer(raw) - answer) < 0.02,
    display: `${answer}`,
    grade: "6年",
  };
}

function genSpeed() {
  const kind = pick(["speed", "distance", "time"]);
  const speed = pick([30, 40, 45, 50, 60, 70, 80, 90]);
  const time = pick([1, 1.5, 2, 2.5, 3, 4]);
  const distance = +(speed * time).toFixed(1);
  if (kind === "speed") {
    return {
      text: `${distance}kmの道のりを${time}時間で進みました。時速何kmですか。`,
      hint: "「km」は書かなくてOK",
      answer: speed,
      accept: (raw) => Math.abs(parseNumericAnswer(raw) - speed) < 0.5,
      display: `時速${speed}km`,
      grade: "5〜6年",
    };
  }
  if (kind === "distance") {
    return {
      text: `時速${speed}kmで${time}時間走ると、何km進みますか。`,
      hint: "「km」は書かなくてOK",
      answer: distance,
      accept: (raw) => Math.abs(parseNumericAnswer(raw) - distance) < 0.5,
      display: `${distance}km`,
      grade: "5〜6年",
    };
  }
  return {
    text: `時速${speed}kmで${distance}km進むのにかかる時間は何時間ですか。`,
    hint: "「時間」は書かなくてOK",
    answer: time,
    accept: (raw) => Math.abs(parseNumericAnswer(raw) - time) < 0.05,
    display: `${time}時間`,
    grade: "5〜6年",
  };
}

function genAverage() {
  const n = pick([3, 4]);
  const nums = Array.from({ length: n }, () => randInt(10, 90));
  const answer = +(nums.reduce((s, x) => s + x, 0) / n).toFixed(2);
  return {
    text: `${nums.join("、")} の平均を求めなさい。`,
    hint: "小数になるときは書けるところまででOK",
    answer,
    accept: (raw) => Math.abs(parseNumericAnswer(raw) - answer) < 0.1,
    display: `${answer}`,
    grade: "5年",
  };
}

function genRounding() {
  const num = randInt(1000, 98765);
  const place = pick([
    { label: "百の位", div: 100 },
    { label: "十の位", div: 10 },
    { label: "千の位", div: 1000 },
  ]);
  const answer = Math.round(num / place.div) * place.div;
  return {
    text: `${num} を${place.label}で四捨五入しなさい。`,
    hint: "数字だけ答えてね",
    answer,
    accept: (raw) => parseNumericAnswer(raw) === answer,
    display: `${answer}`,
    grade: "4年",
  };
}

/* --- 小学1〜4年レベルの計算問題 --- */

function genAddSub() {
  let a = randInt(10, 89), b = randInt(10, 89);
  const op = pick(["+", "-"]);
  if (op === "-" && a < b) [a, b] = [b, a];
  const answer = op === "+" ? a + b : a - b;
  return {
    text: `${a} ${op} ${b} = ?`,
    hint: "ひっ算で考えてもOK",
    answer,
    accept: (raw) => parseNumericAnswer(raw) === answer,
    display: `${answer}`,
    grade: "1〜2年",
  };
}

function genMulTable() {
  const a = randInt(2, 9), b = randInt(2, 9);
  const answer = a * b;
  return {
    text: `${a} × ${b} = ?`,
    hint: "九九を思い出そう",
    answer,
    accept: (raw) => parseNumericAnswer(raw) === answer,
    display: `${answer}`,
    grade: "2〜3年",
  };
}

function genDivisionSimple() {
  const b = randInt(2, 9), q = randInt(2, 9);
  const a = b * q;
  return {
    text: `${a} ÷ ${b} = ?`,
    hint: "わり切れる数だよ",
    answer: q,
    accept: (raw) => parseNumericAnswer(raw) === q,
    display: `${q}`,
    grade: "3年",
  };
}

function genTimeCalc() {
  const startH = randInt(1, 10);
  const startM = pick([0, 10, 15, 20, 30, 40, 45, 50]);
  const addM = pick([15, 20, 25, 30, 40, 45, 50, 55, 70]);
  const totalM = startH * 60 + startM + addM;
  let h = Math.floor(totalM / 60);
  const m = totalM % 60;
  if (h > 12) h -= 12;
  return {
    text: `${startH}時${startM === 0 ? "" : startM + "分"}から${addM}分後は何時何分ですか。`,
    hint: "「◯時◯分」の形で答えてね",
    accept: (raw) => {
      const nums = toHankaku(raw).match(/\d+/g);
      if (!nums || nums.length < 2) return false;
      return parseInt(nums[0], 10) === h && parseInt(nums[1], 10) === m;
    },
    display: `${h}時${m}分`,
    grade: "3年",
  };
}

function genAreaRect() {
  const w = randInt(3, 15), h = randInt(3, 15);
  const answer = w * h;
  return {
    text: `たて${h}cm、よこ${w}cmの長方形の面積は何cm²ですか。`,
    hint: "「cm²」は書かなくてOK",
    answer,
    accept: (raw) => Math.abs(parseNumericAnswer(raw) - answer) < 0.5,
    display: `${answer}cm²`,
    grade: "4年",
  };
}

function genAreaTriangle() {
  const base = randInt(4, 20), height = randInt(4, 20) * 2;
  const answer = (base * height) / 2;
  return {
    text: `底辺${base}cm、高さ${height}cmの三角形の面積は何cm²ですか。`,
    hint: "「底辺×高さ÷2」で求めよう",
    answer,
    accept: (raw) => Math.abs(parseNumericAnswer(raw) - answer) < 0.5,
    display: `${answer}cm²`,
    grade: "5年",
  };
}

function genAngleTriangle() {
  let a = randInt(30, 90), b = randInt(30, 90);
  while (a + b >= 170) b = randInt(20, 60);
  const answer = 180 - a - b;
  return {
    text: `三角形の3つの角のうち、2つの角が${a}°と${b}°です。残りの角は何度ですか。`,
    hint: "三角形の内角の和は180°",
    answer,
    accept: (raw) => parseNumericAnswer(raw) === answer,
    display: `${answer}°`,
    grade: "5年",
  };
}

// grades: 対象学年（3〜6の数値配列）／ type: "計算" | "文章題・図形"
const MATH_GENERATOR_DEFS = [
  { fn: genAddSub, grades: [3], type: "計算" },
  { fn: genAddSub, grades: [3], type: "計算" },
  { fn: genMulTable, grades: [3], type: "計算" },
  { fn: genMulTable, grades: [3], type: "計算" },
  { fn: genDivisionSimple, grades: [3], type: "計算" },
  { fn: genTimeCalc, grades: [3], type: "文章題・図形" },
  { fn: genAreaRect, grades: [4], type: "文章題・図形" },
  { fn: genRounding, grades: [4], type: "計算" },
  { fn: genDecimal, grades: [4, 5], type: "計算" },
  { fn: genDecimal, grades: [4, 5], type: "計算" },
  { fn: genAreaTriangle, grades: [5], type: "文章題・図形" },
  { fn: genAngleTriangle, grades: [5], type: "文章題・図形" },
  { fn: genPercent, grades: [5], type: "文章題・図形" },
  { fn: genPercent, grades: [5], type: "文章題・図形" },
  { fn: genAverage, grades: [5], type: "文章題・図形" },
  { fn: genFraction, grades: [5, 6], type: "計算" },
  { fn: genFraction, grades: [5, 6], type: "計算" },
  { fn: genRatio, grades: [6], type: "文章題・図形" },
  { fn: genSpeed, grades: [5, 6], type: "文章題・図形" },
];

const SESSION_SIZE = 20;

function buildMathSession(grade, type, count) {
  const gradeNum = parseInt(grade, 10);
  const pool = MATH_GENERATOR_DEFS
    .filter((d) => d.grades.includes(gradeNum) && d.type === type)
    .map((d) => d.fn);
  const effectivePool = pool.length > 0 ? pool : MATH_GENERATOR_DEFS.map((d) => d.fn);
  const used = new Set();
  const result = [];
  let guard = 0;
  while (result.length < count && guard < count * 30) {
    guard++;
    const g = pick(effectivePool)();
    if (used.has(g.text)) continue;
    used.add(g.text);
    result.push({ id: `m${result.length}-${Math.random()}`, ...g });
  }
  return result;
}

/* ============================================================
   一問一答バンク（国語・理科・社会・英語）
   ============================================================ */

const RIKA_MC = RIKA_DB;

const SHAKAI_MC = SHAKAI_DB;

const ENGLISH_MC = EIGO_DB;

/* ============================================================
   出題ローテーション（直近のテストで出た問題をなるべく避ける）
   ============================================================ */

async function loadRecency(storageKey, allKeys) {
  try {
    const res = await window.storage.get(storageKey, false);
    if (res && res.value) {
      const arr = JSON.parse(res.value);
      if (Array.isArray(arr)) {
        const existing = arr.filter((k) => allKeys.includes(k));
        const missing = allKeys.filter((k) => !existing.includes(k));
        return [...shuffle(missing), ...existing];
      }
    }
  } catch (e) {
    /* 保存データが読めない場合は新しく作る */
  }
  return shuffle([...allKeys]);
}

async function saveRecency(storageKey, list) {
  try {
    await window.storage.set(storageKey, JSON.stringify(list), false);
  } catch (e) {
    /* 保存に失敗しても出題は続行（ベストエフォート） */
  }
}

// 直近5回のテストで出ていない問題を優先的に選び、選んだ問題は「最近使った」として
// 履歴の一番後ろに送る（LRU方式）。バンクがセッションサイズより小さい場合のみ
// 同じテスト内でもやむを得ず重複する。
async function selectRotated(subjectId, items, n) {
  const byKey = new Map(items.map((it) => [it.q, it]));
  const allKeys = items.map((it) => it.q);
  const storageKey = `drill-history:${subjectId}`;
  const recency = await loadRecency(storageKey, allKeys);

  // 重複を避けるため、プールにある分だけを選ぶ（水増しはしない）
  const picks = recency.slice(0, Math.min(n, recency.length));
  const remaining = recency.filter((k) => !picks.includes(k));
  await saveRecency(storageKey, [...remaining, ...picks]);

  return shuffle(picks.map((k) => byKey.get(k)));
}

function buildBankSession(subject) {
  const items = KOKUGO_DB;
  return selectRotated(subject, items, SESSION_SIZE).then((selected) =>
    selected.map((item, i) => ({
      id: `${subject}${i}-${Math.random()}`,
      text: item.q,
      hint: "ひらがな・漢字どちらでもOK",
      display: item.accepted[0],
      grade: item.grade,
      accept: (raw) => {
        const n = normalizeText(raw);
        return item.accepted.some((a) => {
          const na = normalizeText(a);
          return n === na || (na.length > 1 && n.includes(na));
        });
      },
    }))
  );
}

function buildMultipleChoiceSession(subjectId, source, count = SESSION_SIZE, targetGrade = null) {
  const pool = targetGrade ? source.filter((item) => item.grade === targetGrade) : source;
  const effectivePool = pool.length > 0 ? pool : source;
  const storageKey = targetGrade ? `${subjectId}-${targetGrade}` : subjectId;
  return selectRotated(storageKey, effectivePool, count).then((selected) =>
    selected.map((item, i) => {
      const options = shuffle(item.choices);
      const correctChoice = item.choices.find((c) => c.correct);
      return {
        id: `${subjectId}${i}-${Math.random()}`,
        text: item.q,
        hint: "正しいものを1つえらんでね",
        display: correctChoice.text,
        options,
        note: item.note,
        example: item.example,
        grade: item.grade,
        accept: (raw) => normalizeText(raw) === normalizeText(correctChoice.text),
      };
    })
  );
}

/* ============================================================
   英検2級 単語テスト（範囲を選んで出題）
   ============================================================ */

const EIKEN_WORDS = EIKEN_DB;

{
  const seen = new Set();
  for (const item of EIKEN_WORDS) {
    const key = item.word.trim().toLowerCase();
    if (seen.has(key)) {
      console.warn(`[eiken.json] 単語が重複しています: "${item.word}"`);
    }
    seen.add(key);
  }
}

function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

const EIKEN_GROUP_SIZE = 20;
const EIKEN_GROUPS = chunkArray(EIKEN_WORDS, EIKEN_GROUP_SIZE);
const EIKEN_META = { id: "英検2級単語", label: "英検2級 単語テスト", color: "#B0742F", accent: "#F8F1E4" };

function buildEikenSession(groupIndex) {
  const group = EIKEN_GROUPS[groupIndex];
  return shuffle(group).map((item, i) => {
    const distractors = shuffle(EIKEN_WORDS.filter((w) => w.word !== item.word)).slice(0, 3);
    const options = shuffle([
      { text: item.meaning, correct: true, explain: `"${item.word}" の意味です。` },
      ...distractors.map((d) => ({
        text: d.meaning,
        correct: false,
        explain: `これは "${d.word}" の意味です。"${item.word}" の意味ではありません。`,
      })),
    ]);
    return {
      id: `eiken${groupIndex}-${i}-${Math.random()}`,
      text: `"${item.word}" の意味は？`,
      hint: "正しい意味を1つえらんでね",
      display: item.meaning,
      options,
      accept: (raw) => normalizeText(raw) === normalizeText(item.meaning),
    };
  });
}

const STUDY_LINKS = {
  理科: { label: "NHK for School「理科6年」", url: "https://edu.web.nhk/school/rika/rika6/" },
  社会: { label: "NHK for School「歴史にドキリ」", url: "https://edu.web.nhk/school/syakai/dokiri/" },
};

/* ============================================================
   教科メタ情報
   ============================================================ */

const SUBJECTS = [
  { id: "算数", label: "算数", sub: "計算ドリル（小3〜6）", color: "#2F5D8A", accent: "#EAF1F8" },
  { id: "国語", label: "国語", sub: "漢字・ことわざ（小1〜6）", color: "#8A3B2F", accent: "#F8EEEA" },
  { id: "理科", label: "理科", sub: "生物・電気・天体（小3〜6）", color: "#2F7A4F", accent: "#EAF6EE" },
  { id: "社会", label: "社会", sub: "地理・歴史・公民（小3〜6）", color: "#8A6D2F", accent: "#F8F1E4" },
  { id: "英語", label: "英語", sub: "英検2級レベル", color: "#5A3B8A", accent: "#F0EAF8" },
];

async function buildSession(subjectId) {
  if (subjectId === "英語") return buildMultipleChoiceSession("英語", ENGLISH_MC);
  if (subjectId === "理科") return buildMultipleChoiceSession("理科", RIKA_MC);
  if (subjectId === "社会") return buildMultipleChoiceSession("社会", SHAKAI_MC);
  return buildBankSession(subjectId);
}

/* ============================================================
   自分で入力した単語でテストを作る
   ============================================================ */

const CUSTOM_META = { id: "カスタム単語", label: "カスタム単語テスト", color: "#2F6E5A" };
const CUSTOM_WORD_LIMIT = 35;

function parseWordList(text, limit) {
  const seen = new Set();
  const out = [];
  text
    .split(/[\n,、，]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .forEach((w) => {
      const key = w.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        out.push(w);
      }
    });
  return out.slice(0, limit);
}

async function callClaudeJSON(prompt) {
  let response;
  try {
    response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1000,
        messages: [{ role: "user", content: prompt }],
      }),
    });
  } catch (e) {
    throw new Error("通信エラーが発生しました。接続を確認してもう一度お試しください。");
  }

  let data;
  try {
    data = await response.json();
  } catch (e) {
    throw new Error("応答の読み取りに失敗しました。");
  }

  if (!response.ok || (data && data.type === "error")) {
    const msg = data && data.error && data.error.message ? data.error.message : `APIエラー（${response.status}）`;
    throw new Error(msg);
  }

  const text = (data.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");
  if (!text.trim()) throw new Error("応答が空でした。もう一度お試しください。");

  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("問題データの形式を読み取れませんでした。");
  }
  let parsed;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch (e) {
    throw new Error("問題データの解析に失敗しました。");
  }
  if (!Array.isArray(parsed)) throw new Error("予期しない応答形式でした。");
  return parsed;
}

async function batchFetch(words, batchSize, fetchBatchFn) {
  const batches = [];
  for (let i = 0; i < words.length; i += batchSize) batches.push(words.slice(i, i + batchSize));

  const results = [];
  let anyFulfilled = false;
  let lastError = null;

  for (const batch of batches) {
    let succeeded = false;
    for (let attempt = 0; attempt < 2 && !succeeded; attempt++) {
      try {
        const r = await fetchBatchFn(batch);
        if (Array.isArray(r)) {
          results.push(...r);
          anyFulfilled = true;
          succeeded = true;
        }
      } catch (e) {
        lastError = e;
      }
    }
  }

  if (!anyFulfilled) {
    throw lastError || new Error("問題の生成にすべて失敗しました。");
  }
  return results;
}

const WORD_BATCH_SIZE = 8;

async function fetchWordBatch(words) {
  const prompt = `次の英単語それぞれについて、
1) 短くテストで使える日本語の意味（10〜15字程度）
2) その単語（活用形も可）を使った短く自然な英語の例文（15語以内）。例文中でその単語の部分は "___" に置きかえること
を考えてください。

単語リスト: ${words.join(", ")}

次のJSON配列の形式だけを出力してください。説明文やマークダウンのコードブロックは付けないでください。
[{"word":"元の単語","meaning":"日本語の意味","sentence":"例文（対象語は___に置きかえる）"}]`;
  return callClaudeJSON(prompt);
}

async function fetchWordData(words) {
  return batchFetch(words, WORD_BATCH_SIZE, fetchWordBatch);
}

function buildDictationSession(words) {
  return shuffle(words).map((word, i) => ({
    id: `custom-dict-${i}-${Math.random()}`,
    text: "🔊 の発音を聞いて、つづりを書こう。",
    hint: "再生ボタンを押してから答えてね（アルファベットで）",
    display: word,
    speak: word,
    accept: (raw) => raw.trim().toLowerCase() === word.trim().toLowerCase(),
  }));
}

function buildMeaningSession(wordData) {
  return shuffle(wordData).map((item, i) => ({
    id: `custom-meaning-${i}-${Math.random()}`,
    text: `"${item.word}" の意味は？`,
    hint: "日本語で書いてね",
    display: item.meaning,
    speak: item.word,
    accept: (raw) => {
      const n = normalizeText(raw);
      const na = normalizeText(item.meaning);
      return n === na || (na.length > 1 && (n.includes(na) || na.includes(n)));
    },
  }));
}

function buildReverseSession(wordData) {
  return shuffle(wordData).map((item, i) => ({
    id: `custom-reverse-${i}-${Math.random()}`,
    text: `「${item.meaning}」を英語で書くと？`,
    hint: "英語のスペルで書いてね（わからないときは発音を聞いてみよう）",
    display: item.word,
    speak: item.word,
    accept: (raw) => raw.trim().toLowerCase() === item.word.trim().toLowerCase(),
  }));
}

function buildFillBlankSession(wordData) {
  return shuffle(wordData).map((item, i) => ({
    id: `custom-fill-${i}-${Math.random()}`,
    text: item.sentence,
    hint: "空欄に入る単語を英語で書いてね（わからないときは発音を聞いてみよう）",
    display: item.word,
    speak: item.word,
    accept: (raw) => raw.trim().toLowerCase() === item.word.trim().toLowerCase(),
  }));
}

const PREFERRED_EN_VOICE_NAMES = [
  "Google US English",
  "Microsoft Aria Online (Natural) - English (United States)",
  "Microsoft Jenny Online (Natural) - English (United States)",
  "Microsoft Guy Online (Natural) - English (United States)",
  "Samantha",
  "Alex",
  "Microsoft Zira Desktop - English (United States)",
  "Microsoft David Desktop - English (United States)",
];

function loadVoices() {
  return new Promise((resolve) => {
    const existing = window.speechSynthesis.getVoices();
    if (existing && existing.length > 0) {
      resolve(existing);
      return;
    }
    let resolved = false;
    window.speechSynthesis.onvoiceschanged = () => {
      if (resolved) return;
      resolved = true;
      resolve(window.speechSynthesis.getVoices());
    };
    setTimeout(() => {
      if (resolved) return;
      resolved = true;
      resolve(window.speechSynthesis.getVoices());
    }, 400);
  });
}

async function speakWord(word) {
  try {
    window.speechSynthesis.cancel();
    const voices = await loadVoices();

    let chosen = null;
    for (const name of PREFERRED_EN_VOICE_NAMES) {
      chosen = voices.find((v) => v.name === name);
      if (chosen) break;
    }
    if (!chosen) chosen = voices.find((v) => v.lang === "en-US");
    if (!chosen) chosen = voices.find((v) => v.lang && v.lang.startsWith("en"));

    const utter = new SpeechSynthesisUtterance(word);
    utter.lang = "en-US";
    utter.rate = 0.95;
    utter.pitch = 1;
    if (chosen) utter.voice = chosen;

    window.speechSynthesis.speak(utter);
  } catch (e) {
    /* 読み上げに対応していない環境ではボタンが反応しないだけにする */
  }
}

/* ============================================================
   自分で入力した漢字・言葉で漢字テストを作る
   ============================================================ */

const KANJI_META = { id: "カスタム漢字", label: "カスタム漢字テスト", color: "#7A3B5A" };
const KANJI_WORD_LIMIT = 35;

const KANJI_BATCH_SIZE = 8;

async function fetchKanjiBatch(words) {
  const prompt = `次の日本語の単語（漢字をふくむ）それぞれについて、
1) ひらがなでの読み方
2) その単語を使った短く自然な日本語の例文（30字以内）。例文中でその単語の部分は "___" に置きかえること
を考えてください。

単語リスト: ${words.join("、")}

次のJSON配列の形式だけを出力してください。説明文やマークダウンのコードブロックは付けないでください。
[{"word":"元の単語","reading":"ひらがな読み","sentence":"例文（対象語は___に置きかえる）"}]`;
  return callClaudeJSON(prompt);
}

async function fetchKanjiData(words) {
  return batchFetch(words, KANJI_BATCH_SIZE, fetchKanjiBatch);
}

function buildKanjiReadingSession(wordData) {
  return shuffle(wordData).map((item, i) => {
    const fullSentence = item.sentence && item.sentence.includes("___")
      ? item.sentence.replace("___", item.word)
      : `${item.word}」を使った文です。`;
    return {
      id: `kanji-read-${i}-${Math.random()}`,
      text: fullSentence,
      hint: `文中の「${item.word}」の読み方をひらがなで書いてね`,
      display: item.reading,
      accept: (raw) => {
        const n = normalizeText(raw);
        const na = normalizeText(item.reading);
        return n === na || (na.length > 1 && (n.includes(na) || na.includes(n)));
      },
    };
  });
}

function buildKanjiWritingSession(wordData) {
  return shuffle(wordData).map((item, i) => ({
    id: `kanji-write-${i}-${Math.random()}`,
    text: item.sentence,
    hint: `読み方のヒント：「${item.reading}」`,
    display: item.word,
    accept: (raw) => raw.trim() === item.word.trim(),
  }));
}

function buildKanjiFillBlankSession(wordData) {
  return shuffle(wordData).map((item, i) => ({
    id: `kanji-fill-${i}-${Math.random()}`,
    text: item.sentence,
    hint: "空欄に入る言葉を書いてね",
    display: item.word,
    accept: (raw) => raw.trim() === item.word.trim(),
  }));
}

/* ============================================================
   スタンプ（丸つけ）コンポーネント
   ============================================================ */

function Stamp({ correct }) {
  return (
    <div className={`stamp-wrap ${correct ? "stamp-in" : "stamp-in-x"}`}>
      {correct ? (
        <svg width="92" height="92" viewBox="0 0 100 100" className="stamp-ring">
          <circle cx="50" cy="50" r="40" fill="none" stroke="#C8323D" strokeWidth="5" />
          <circle cx="50" cy="50" r="33" fill="none" stroke="#C8323D" strokeWidth="1.5" opacity="0.5" />
        </svg>
      ) : (
        <svg width="92" height="92" viewBox="0 0 100 100" className="stamp-ring">
          <line x1="24" y1="24" x2="76" y2="76" stroke="#C8323D" strokeWidth="6" strokeLinecap="round" />
          <line x1="76" y1="24" x2="24" y2="76" stroke="#C8323D" strokeWidth="6" strokeLinecap="round" />
        </svg>
      )}
    </div>
  );
}

/* ============================================================
   メインアプリ
   ============================================================ */

export default function DailyDrill() {
  const [screen, setScreen] = useState("select"); // select | mathOptions | rsOptions | eikenGroups | customInput | kanjiInput | loading | quiz | result
  const [subject, setSubject] = useState(null);
  const [eikenGroupIndex, setEikenGroupIndex] = useState(null);
  const [mathGrade, setMathGrade] = useState("3年"); // 3年 | 4年 | 5年 | 6年
  const [mathType, setMathType] = useState("計算"); // 計算 | 文章題・図形
  const [mathCount, setMathCount] = useState(20); // 20 | 35 | 50
  const [rsSubject, setRsSubject] = useState(null); // "理科" | "社会"
  const [rsGrade, setRsGrade] = useState("4年"); // 3年 | 4年 | 5年 | 6年
  const [rsCount, setRsCount] = useState(20); // 20 | 35 | 50
  const [customText, setCustomText] = useState("");
  const [customMode, setCustomMode] = useState("meaning"); // meaning | reverse | dictation | fillblank
  const [customError, setCustomError] = useState("");
  const [kanjiText, setKanjiText] = useState("");
  const [kanjiMode, setKanjiMode] = useState("reading"); // reading | writing | fillblank
  const [kanjiError, setKanjiError] = useState("");
  const [questions, setQuestions] = useState([]);
  const [index, setIndex] = useState(0);
  const [input, setInput] = useState("");
  const [checked, setChecked] = useState(false);
  const [correct, setCorrect] = useState(false);
  const [log, setLog] = useState([]); // {q, userAnswer, correct, display}
  const inputRef = useRef(null);

  useEffect(() => {
    if (screen === "quiz" && inputRef.current) inputRef.current.focus();
  }, [screen, index]);

  const startSubject = useCallback(async (id) => {
    setSubject(id);
    setScreen("loading");
    const qs = await buildSession(id);
    setQuestions(qs);
    setIndex(0);
    setInput("");
    setChecked(false);
    setLog([]);
    setScreen("quiz");
  }, []);

  const startRikaShakai = useCallback(async (subjectId, grade, count) => {
    setSubject(subjectId);
    setScreen("loading");
    const source = subjectId === "理科" ? RIKA_MC : SHAKAI_MC;
    const qs = await buildMultipleChoiceSession(subjectId, source, count, grade);
    setQuestions(qs);
    setIndex(0);
    setInput("");
    setChecked(false);
    setLog([]);
    setScreen("quiz");
  }, []);

  const startEikenGroup = useCallback((groupIndex) => {
    setEikenGroupIndex(groupIndex);
    setSubject("英検2級単語");
    setQuestions(buildEikenSession(groupIndex));
    setIndex(0);
    setInput("");
    setChecked(false);
    setLog([]);
    setScreen("quiz");
  }, []);

  const startMath = useCallback((grade, type, count) => {
    setSubject("算数");
    setQuestions(buildMathSession(grade, type, count));
    setIndex(0);
    setInput("");
    setChecked(false);
    setLog([]);
    setScreen("quiz");
  }, []);

  const startCustomTest = useCallback(async () => {
    const words = parseWordList(customText, CUSTOM_WORD_LIMIT);
    if (words.length === 0) {
      setCustomError("単語を1つ以上入力してください。");
      return;
    }
    setCustomError("");
    setSubject("カスタム単語");

    if (customMode === "dictation") {
      setQuestions(buildDictationSession(words));
      setIndex(0);
      setInput("");
      setChecked(false);
      setLog([]);
      setScreen("quiz");
      return;
    }

    setScreen("loading");
    try {
      const data = await fetchWordData(words);
      const byWord = new Map(data.map((d) => [String(d.word || "").trim().toLowerCase(), d]));
      const wordData = words.map((w) => {
        const d = byWord.get(w.trim().toLowerCase());
        return {
          word: w,
          meaning: d && d.meaning ? d.meaning : "（意味を取得できませんでした）",
          sentence: d && d.sentence ? d.sentence : `"${w}" を使った文です。___ に入る単語は？`,
        };
      });
      const qs =
        customMode === "fillblank"
          ? buildFillBlankSession(wordData)
          : customMode === "reverse"
          ? buildReverseSession(wordData)
          : buildMeaningSession(wordData);
      setQuestions(qs);
      setIndex(0);
      setInput("");
      setChecked(false);
      setLog([]);
      setScreen("quiz");
    } catch (e) {
      setCustomError(`問題の作成に失敗しました（${e.message || "不明なエラー"}）。もう一度お試しください。`);
      setScreen("customInput");
    }
  }, [customText, customMode]);

  const startKanjiTest = useCallback(async () => {
    const words = parseWordList(kanjiText, KANJI_WORD_LIMIT);
    if (words.length === 0) {
      setKanjiError("単語を1つ以上入力してください。");
      return;
    }
    setKanjiError("");
    setSubject("カスタム漢字");
    setScreen("loading");
    try {
      const data = await fetchKanjiData(words);
      const byWord = new Map(data.map((d) => [String(d.word || "").trim(), d]));
      const wordData = words.map((w) => {
        const d = byWord.get(w.trim());
        return {
          word: w,
          reading: d && d.reading ? d.reading : "（読みを取得できませんでした）",
          sentence: d && d.sentence ? d.sentence : `「${w}」を使った文です。___ に入る言葉は？`,
        };
      });
      const qs =
        kanjiMode === "writing"
          ? buildKanjiWritingSession(wordData)
          : kanjiMode === "fillblank"
          ? buildKanjiFillBlankSession(wordData)
          : buildKanjiReadingSession(wordData);
      setQuestions(qs);
      setIndex(0);
      setInput("");
      setChecked(false);
      setLog([]);
      setScreen("quiz");
    } catch (e) {
      setKanjiError(`問題の作成に失敗しました（${e.message || "不明なエラー"}）。もう一度お試しください。`);
      setScreen("kanjiInput");
    }
  }, [kanjiText, kanjiMode]);

  const current = questions[index];
  const meta =
    subject === "英検2級単語"
      ? EIKEN_META
      : subject === "カスタム単語"
      ? CUSTOM_META
      : subject === "カスタム漢字"
      ? KANJI_META
      : SUBJECTS.find((s) => s.id === subject);
  const mathMeta = SUBJECTS.find((s) => s.id === "算数");
  const rsMeta = rsSubject ? SUBJECTS.find((s) => s.id === rsSubject) : null;
  const rsSource = rsSubject === "理科" ? RIKA_MC : rsSubject === "社会" ? SHAKAI_MC : [];
  const rsPoolCounts = {
    "3年": rsSource.filter((item) => item.grade === "3年").length,
    "4年": rsSource.filter((item) => item.grade === "4年").length,
    "5年": rsSource.filter((item) => item.grade === "5年").length,
    "6年": rsSource.filter((item) => item.grade === "6年").length,
  };

  const handleCheck = useCallback((valueOverride) => {
    if (!current || checked) return;
    const value = valueOverride !== undefined ? valueOverride : input;
    const ok = current.accept(value);
    setInput(value);
    setCorrect(ok);
    setChecked(true);
    setLog((prev) => [...prev, { text: current.text, userAnswer: value, correct: ok, display: current.display }]);
  }, [current, checked, input]);

  const handleSelectOption = useCallback(
    (opt) => {
      if (checked) return;
      handleCheck(opt);
    },
    [checked, handleCheck]
  );

  const handleNext = useCallback(() => {
    if (index + 1 >= questions.length) {
      setScreen("result");
      return;
    }
    setIndex((i) => i + 1);
    setInput("");
    setChecked(false);
  }, [index, questions.length]);

  const handleKeyDown = useCallback(
    (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        if (!checked) handleCheck();
        else handleNext();
      }
    },
    [checked, handleCheck, handleNext]
  );

  const score = log.filter((l) => l.correct).length;

  return (
    <div className="drill-root">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Shippori+Mincho:wght@500;700;800&family=Zen+Kaku+Gothic+New:wght@400;500;700&family=Space+Mono:wght@400;700&display=swap');

        .drill-root {
          min-height: 100vh;
          background-color: #F5F6F1;
          background-image:
            linear-gradient(#DDE2DD 1px, transparent 1px),
            linear-gradient(90deg, #DDE2DD 1px, transparent 1px);
          background-size: 28px 28px;
          font-family: 'Zen Kaku Gothic New', sans-serif;
          color: #1F2A44;
          padding: 32px 16px 64px;
          display: flex;
          justify-content: center;
        }
        .drill-inner { width: 100%; max-width: 640px; }
        .serif { font-family: 'Shippori Mincho', serif; }
        .mono { font-family: 'Space Mono', monospace; }

        .title-block { text-align: center; margin-bottom: 28px; }
        .title-block .eyebrow {
          font-family: 'Space Mono', monospace;
          font-size: 12px;
          letter-spacing: 0.25em;
          color: #6B7280;
          margin-bottom: 6px;
        }
        .title-block h1 {
          font-size: 30px;
          font-weight: 800;
          line-height: 1.4;
        }
        .title-block .under {
          width: 56px; height: 3px; background: #C8323D; margin: 14px auto 0;
        }

        .subject-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 14px;
        }
        @media (min-width: 480px) {
          .subject-grid { grid-template-columns: repeat(2, 1fr); }
        }
        .subject-card {
          background: #FFFFFF;
          border: 1px solid #E3E5DE;
          border-radius: 4px;
          padding: 20px 16px;
          text-align: left;
          cursor: pointer;
          position: relative;
          overflow: hidden;
          transition: transform 0.15s ease, box-shadow 0.15s ease;
          box-shadow: 0 1px 0 rgba(0,0,0,0.03);
        }
        .subject-card:hover { transform: translateY(-2px); box-shadow: 0 6px 16px rgba(0,0,0,0.08); }
        .subject-card::before {
          content: "";
          position: absolute; top: 0; left: 0; bottom: 0; width: 6px;
          background: var(--c);
        }
        .subject-card .label {
          font-family: 'Shippori Mincho', serif;
          font-weight: 800;
          font-size: 22px;
          color: var(--c);
        }
        .subject-card .sub { font-size: 12px; color: #6B7280; margin-top: 6px; }

        .eiken-card {
          display: block;
          width: 100%;
          margin-top: 14px;
          background: var(--c);
          border-color: var(--c);
        }
        .eiken-card::before { display: none; }
        .eiken-card .label { color: #fff; }
        .eiken-card .sub { color: rgba(255,255,255,0.85); }

        .custom-textarea {
          width: 100%;
          border: 2px solid #C9CDC4;
          border-radius: 3px;
          padding: 12px 14px;
          font-size: 15px;
          font-family: 'Zen Kaku Gothic New', sans-serif;
          resize: vertical;
          outline: none;
          box-sizing: border-box;
        }
        .custom-textarea:focus { border-color: var(--c); }
        .custom-error { color: #C8323D; font-size: 13px; margin-top: 8px; }

        .mode-label { font-size: 13px; color: #6B7280; margin-top: 18px; margin-bottom: 8px; }
        .mode-grid { display: flex; flex-direction: column; gap: 8px; }
        .mode-btn {
          text-align: left;
          border: 2px solid #C9CDC4;
          border-radius: 3px;
          background: #fff;
          padding: 10px 14px;
          cursor: pointer;
          font-family: 'Zen Kaku Gothic New', sans-serif;
        }
        .mode-btn:hover { border-color: var(--c); }
        .mode-btn.mode-active { border-color: var(--c); background: color-mix(in srgb, var(--c) 8%, white); }
        .mode-btn-label { font-size: 14px; font-weight: 700; color: #1F2A44; }
        .mode-btn-desc { font-size: 12px; color: #6B7280; margin-top: 2px; }

        .speak-btn {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          border: 1.5px solid var(--c);
          color: var(--c);
          background: #fff;
          border-radius: 3px;
          padding: 8px 16px;
          font-size: 14px;
          font-weight: 700;
          cursor: pointer;
          margin-bottom: 14px;
        }
        .speak-btn:hover { opacity: 0.85; }

        .card {
          background: #FFFFFF;
          border: 1px solid #E3E5DE;
          border-radius: 4px;
          padding: 28px 24px;
          position: relative;
          box-shadow: 0 1px 0 rgba(0,0,0,0.03);
        }

        .progress-row { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 18px; gap: 12px; }
        .progress-boxes { display: flex; flex-wrap: wrap; gap: 3px; max-width: 220px; justify-content: flex-end; }
        .pbox {
          width: 10px; height: 10px; border: 1.5px solid #C9CDC4; border-radius: 2px;
        }
        .pbox.filled { background: var(--c); border-color: var(--c); }
        .subject-tag {
          font-family: 'Shippori Mincho', serif;
          font-weight: 700;
          font-size: 14px;
          color: var(--c);
          border: 1px solid var(--c);
          padding: 2px 10px;
          border-radius: 2px;
        }

        .q-number {
          font-family: 'Space Mono', monospace;
          font-size: 12px;
          color: #9AA093;
          margin-bottom: 6px;
        }
        .grade-tag {
          margin-left: 8px;
          font-family: 'Zen Kaku Gothic New', sans-serif;
          font-size: 11px;
          color: var(--c);
          border: 1px solid var(--c);
          border-radius: 10px;
          padding: 1px 8px;
        }
        .q-text {
          font-size: 19px;
          line-height: 1.7;
          margin-bottom: 22px;
          min-height: 52px;
        }

        .answer-row { display: flex; gap: 10px; align-items: stretch; }
        .answer-input {
          flex: 1;
          border: 2px solid #C9CDC4;
          border-radius: 3px;
          padding: 12px 14px;
          font-size: 18px;
          font-family: 'Space Mono', monospace;
          background: repeating-linear-gradient(#fff, #fff 27px, #E7E9E2 28px);
          outline: none;
          transition: border-color 0.15s ease;
        }
        .answer-input:focus { border-color: var(--c); }
        .answer-input:disabled { background: #F4F4F1; color: #8A8F84; }

        .btn {
          font-family: 'Zen Kaku Gothic New', sans-serif;
          font-weight: 700;
          font-size: 15px;
          border: none;
          border-radius: 3px;
          padding: 0 22px;
          cursor: pointer;
          color: #fff;
          background: var(--c);
          transition: opacity 0.15s ease;
        }
        .btn:hover { opacity: 0.88; }
        .btn:disabled { background: #C9CDC4; cursor: not-allowed; }
        .btn-ghost {
          background: transparent;
          color: var(--c);
          border: 1.5px solid var(--c);
          font-weight: 700;
          border-radius: 3px;
          padding: 10px 22px;
          cursor: pointer;
        }

        .hint { font-size: 12px; color: #9AA093; margin-top: 8px; }

        .option-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px;
        }
        .option-btn {
          font-family: 'Zen Kaku Gothic New', sans-serif;
          font-size: 15px;
          text-align: left;
          padding: 12px 14px;
          border: 2px solid #C9CDC4;
          border-radius: 3px;
          background: #fff;
          cursor: pointer;
          transition: border-color 0.15s ease, background 0.15s ease;
        }
        .option-btn:hover:not(:disabled) { border-color: var(--c); }
        .option-btn:disabled { cursor: default; }
        .option-btn.opt-correct {
          border-color: #2F7A4F;
          background: #EAF6EE;
          color: #2F7A4F;
          font-weight: 700;
        }
        .option-btn.opt-wrong {
          border-color: #C8323D;
          background: #F8EEEA;
          color: #C8323D;
          font-weight: 700;
        }

        .feedback-row {
          margin-top: 18px;
          display: flex;
          align-items: center;
          gap: 14px;
          min-height: 60px;
        }
        .feedback-text { font-size: 15px; }
        .feedback-text .correct-answer {
          font-family: 'Space Mono', monospace;
          color: #C8323D;
          font-weight: 700;
          margin-left: 4px;
        }

        .explain-panel {
          margin-top: 4px;
          border-top: 1px dashed #D8DCD3;
          padding-top: 16px;
        }
        .example-box {
          background: #F5F6F1;
          border-left: 3px solid var(--c);
          padding: 10px 14px;
          border-radius: 2px;
          margin-bottom: 14px;
        }
        .example-en {
          font-family: 'Space Mono', monospace;
          font-size: 14px;
          color: #1F2A44;
        }
        .example-ja { font-size: 12.5px; color: #6B7280; margin-top: 4px; }

        .note-box {
          background: #F5F6F1;
          border-left: 3px solid var(--c);
          padding: 10px 14px;
          border-radius: 2px;
          margin-bottom: 14px;
          font-size: 13px;
          color: #4A5045;
        }

        .study-link {
          display: inline-block;
          margin-top: 16px;
          font-size: 13px;
          font-weight: 700;
          color: var(--c);
          text-decoration: underline;
          text-underline-offset: 3px;
        }

        .explain-list { display: flex; flex-direction: column; gap: 10px; }
        .explain-item { display: flex; gap: 10px; font-size: 13.5px; line-height: 1.6; }
        .explain-mark { flex-shrink: 0; font-weight: 800; width: 16px; }
        .explain-mark.ok { color: #2F7A4F; }
        .explain-mark.ng { color: #C8323D; }
        .explain-term {
          font-family: 'Space Mono', monospace;
          font-weight: 700;
          color: #1F2A44;
          margin-right: 6px;
        }
        .explain-text { color: #555F52; }

        .stamp-wrap { position: relative; width: 60px; height: 60px; flex-shrink: 0; }
        .stamp-ring { position: absolute; top: -16px; left: -16px; }
        .stamp-in { animation: stampIn 0.35s cubic-bezier(.2,1.4,.4,1) both; }
        .stamp-in-x { animation: stampInX 0.3s ease both; }
        @keyframes stampIn {
          0% { transform: scale(2.4) rotate(-18deg); opacity: 0; }
          60% { transform: scale(0.92) rotate(-8deg); opacity: 1; }
          100% { transform: scale(1) rotate(-8deg); opacity: 1; }
        }
        @keyframes stampInX {
          0% { transform: scale(1.8); opacity: 0; }
          100% { transform: scale(1); opacity: 1; }
        }

        .footer-row { display: flex; justify-content: flex-end; margin-top: 20px; }

        .result-score {
          text-align: center;
          padding: 36px 20px 28px;
        }
        .result-score .big {
          font-family: 'Shippori Mincho', serif;
          font-weight: 800;
          font-size: 56px;
          color: #C8323D;
          line-height: 1;
        }
        .result-score .of { font-size: 15px; color: #6B7280; margin-top: 8px; }

        .review-list { margin-top: 8px; border-top: 1px dashed #D8DCD3; }
        .review-item {
          padding: 12px 4px;
          border-bottom: 1px dashed #D8DCD3;
          font-size: 14px;
          display: flex;
          gap: 10px;
        }
        .review-item .mark { flex-shrink: 0; font-weight: 800; }
        .review-item .mark.ok { color: #2F7A4F; }
        .review-item .mark.ng { color: #C8323D; }
        .review-item .body .q { color: #444; }
        .review-item .body .a { color: #9AA093; margin-top: 2px; }
        .review-item .body .a b { color: #C8323D; font-family: 'Space Mono', monospace; }

        .result-actions { display: flex; gap: 10px; justify-content: center; margin-top: 24px; flex-wrap: wrap; }

        .back-link {
          font-size: 13px; color: #6B7280; cursor: pointer; text-decoration: underline;
          text-underline-offset: 3px;
        }
      `}</style>

      <div className="drill-inner">
        {screen === "select" && (
          <>
            <div className="title-block">
              <div className="eyebrow">DAILY DRILL — 小学校 総復習</div>
              <h1 className="serif">きょうのドリル</h1>
              <div className="under" />
            </div>
            <div className="subject-grid">
              {SUBJECTS.map((s) => (
                <button
                  key={s.id}
                  className="subject-card"
                  style={{ "--c": s.color }}
                  onClick={() => {
                    if (s.id === "算数") {
                      setScreen("mathOptions");
                    } else if (s.id === "理科" || s.id === "社会") {
                      setRsSubject(s.id);
                      setScreen("rsOptions");
                    } else {
                      startSubject(s.id);
                    }
                  }}
                >
                  <div className="label">{s.label}</div>
                  <div className="sub">{s.sub}</div>
                </button>
              ))}
            </div>

            <button
              className="subject-card eiken-card"
              style={{ "--c": EIKEN_META.color }}
              onClick={() => setScreen("eikenGroups")}
            >
              <div className="label">{EIKEN_META.label}</div>
              <div className="sub">単語{EIKEN_WORDS.length}語を20語ずつ、好きな範囲でテスト</div>
            </button>

            <button
              className="subject-card eiken-card"
              style={{ "--c": CUSTOM_META.color }}
              onClick={() => setScreen("customInput")}
            >
              <div className="label">{CUSTOM_META.label}</div>
              <div className="sub">好きな単語を入力して、意味・英作文・聞き取り・穴うめテストを作成</div>
            </button>

            <button
              className="subject-card eiken-card"
              style={{ "--c": KANJI_META.color }}
              onClick={() => setScreen("kanjiInput")}
            >
              <div className="label">{KANJI_META.label}</div>
              <div className="sub">好きな漢字・言葉を入力して、読み方・書き取り・穴うめテストを作成</div>
            </button>
          </>
        )}

        {screen === "mathOptions" && (
          <>
            <div className="title-block">
              <div className="eyebrow">算数</div>
              <h1 className="serif">出題設定をえらぶ</h1>
              <div className="under" />
            </div>
            <div className="card" style={{ "--c": mathMeta.color }}>
              <div className="mode-label">学年をえらぶ</div>
              <div className="mode-grid">
                {["3年", "4年", "5年", "6年"].map((g) => (
                  <button
                    key={g}
                    className={`mode-btn ${mathGrade === g ? "mode-active" : ""}`}
                    style={{ "--c": mathMeta.color }}
                    onClick={() => setMathGrade(g)}
                  >
                    <div className="mode-btn-label">{g}の内容</div>
                  </button>
                ))}
              </div>

              <div className="mode-label" style={{ marginTop: 20 }}>問題類型をえらぶ</div>
              <div className="mode-grid" style={{ flexDirection: "row", gap: 8 }}>
                {["計算", "文章題・図形"].map((t) => (
                  <button
                    key={t}
                    className={`mode-btn ${mathType === t ? "mode-active" : ""}`}
                    style={{ "--c": mathMeta.color, flex: 1, textAlign: "center" }}
                    onClick={() => setMathType(t)}
                  >
                    <div className="mode-btn-label">{t}</div>
                  </button>
                ))}
              </div>

              <div className="mode-label" style={{ marginTop: 20 }}>問題数をえらぶ</div>
              <div className="mode-grid" style={{ flexDirection: "row", gap: 8 }}>
                {[20, 35, 50].map((c) => (
                  <button
                    key={c}
                    className={`mode-btn ${mathCount === c ? "mode-active" : ""}`}
                    style={{ "--c": mathMeta.color, flex: 1, textAlign: "center" }}
                    onClick={() => setMathCount(c)}
                  >
                    <div className="mode-btn-label">{c}問</div>
                  </button>
                ))}
              </div>

              <button
                className="btn"
                style={{ "--c": mathMeta.color, width: "100%", marginTop: 20, padding: "12px 0" }}
                onClick={() => startMath(mathGrade, mathType, mathCount)}
              >
                テストを始める
              </button>
            </div>
            <div style={{ textAlign: "center", marginTop: 14 }}>
              <span className="back-link" onClick={() => setScreen("select")}>教科選択にもどる</span>
            </div>
          </>
        )}

        {screen === "rsOptions" && rsSubject && rsMeta && (
          <>
            <div className="title-block">
              <div className="eyebrow">{rsSubject}</div>
              <h1 className="serif">出題設定をえらぶ</h1>
              <div className="under" />
            </div>
            <div className="card" style={{ "--c": rsMeta.color }}>
              <div className="mode-label">学年をえらぶ</div>
              <div className="mode-grid">
                {["3年", "4年", "5年", "6年"].map((g) => (
                  <button
                    key={g}
                    className={`mode-btn ${rsGrade === g ? "mode-active" : ""}`}
                    style={{ "--c": rsMeta.color }}
                    onClick={() => setRsGrade(g)}
                  >
                    <div className="mode-btn-label">{g}の内容</div>
                    <div className="mode-btn-desc">問題プール：{rsPoolCounts[g]}問</div>
                  </button>
                ))}
              </div>

              <div className="mode-label" style={{ marginTop: 20 }}>問題数をえらぶ</div>
              <div className="mode-grid" style={{ flexDirection: "row", gap: 8 }}>
                {[20, 35, 50].map((c) => (
                  <button
                    key={c}
                    className={`mode-btn ${rsCount === c ? "mode-active" : ""}`}
                    style={{ "--c": rsMeta.color, flex: 1, textAlign: "center" }}
                    onClick={() => setRsCount(c)}
                  >
                    <div className="mode-btn-label">{c}問</div>
                  </button>
                ))}
              </div>

              {rsCount > rsPoolCounts[rsGrade] && (
                <div className="custom-error" style={{ color: "#8A6D2F" }}>
                  「{rsGrade}」の問題は現在{rsPoolCounts[rsGrade]}問しかありません。同じ問題が2回出ないように、今回は{rsPoolCounts[rsGrade]}問でテストします。
                </div>
              )}

              <button
                className="btn"
                style={{ "--c": rsMeta.color, width: "100%", marginTop: 20, padding: "12px 0" }}
                onClick={() => startRikaShakai(rsSubject, rsGrade, rsCount)}
              >
                テストを始める
              </button>
            </div>
            <div style={{ textAlign: "center", marginTop: 14 }}>
              <span className="back-link" onClick={() => setScreen("select")}>教科選択にもどる</span>
            </div>
          </>
        )}

        {screen === "eikenGroups" && (
          <>
            <div className="title-block">
              <div className="eyebrow">{EIKEN_META.label}</div>
              <h1 className="serif">出題範囲をえらぶ</h1>
              <div className="under" />
            </div>
            <div className="subject-grid">
              {EIKEN_GROUPS.map((group, i) => {
                const start = i * EIKEN_GROUP_SIZE + 1;
                const end = i * EIKEN_GROUP_SIZE + group.length;
                return (
                  <button
                    key={i}
                    className="subject-card"
                    style={{ "--c": EIKEN_META.color }}
                    onClick={() => startEikenGroup(i)}
                  >
                    <div className="label">{start}〜{end}</div>
                    <div className="sub">単語{group.length}問</div>
                  </button>
                );
              })}
            </div>
            <div style={{ textAlign: "center", marginTop: 14 }}>
              <span className="back-link" onClick={() => setScreen("select")}>教科選択にもどる</span>
            </div>
          </>
        )}

        {screen === "customInput" && (
          <>
            <div className="title-block">
              <div className="eyebrow">{CUSTOM_META.label}</div>
              <h1 className="serif">単語を入力する</h1>
              <div className="under" />
            </div>
            <div className="card" style={{ "--c": CUSTOM_META.color }}>
              <textarea
                className="custom-textarea"
                style={{ "--c": CUSTOM_META.color }}
                value={customText}
                onChange={(e) => setCustomText(e.target.value)}
                placeholder={`単語をコンマまたは改行で区切って入力してね（最大${CUSTOM_WORD_LIMIT}語）\n例：\nabandon\naccomplish\naccess`}
                rows={6}
              />
              {customError && <div className="custom-error">{customError}</div>}

              <div className="mode-label">テスト形式をえらぶ</div>
              <div className="mode-grid">
                {[
                  { id: "meaning", label: "意味を入力", desc: "単語 → 日本語の意味を書く" },
                  { id: "reverse", label: "英語を書く", desc: "日本語の意味 → 英語のスペルを書く" },
                  { id: "dictation", label: "聞き取り（ディクテーション）", desc: "発音を聞いて、つづりを書く" },
                  { id: "fillblank", label: "穴うめ英作文", desc: "例文の空欄に単語を書く" },
                ].map((m) => (
                  <button
                    key={m.id}
                    className={`mode-btn ${customMode === m.id ? "mode-active" : ""}`}
                    style={{ "--c": CUSTOM_META.color }}
                    onClick={() => setCustomMode(m.id)}
                  >
                    <div className="mode-btn-label">{m.label}</div>
                    <div className="mode-btn-desc">{m.desc}</div>
                  </button>
                ))}
              </div>

              <button
                className="btn"
                style={{ "--c": CUSTOM_META.color, width: "100%", marginTop: 20, padding: "12px 0" }}
                onClick={startCustomTest}
              >
                テストを作る
              </button>
            </div>
            <div style={{ textAlign: "center", marginTop: 14 }}>
              <span className="back-link" onClick={() => setScreen("select")}>教科選択にもどる</span>
            </div>
          </>
        )}

        {screen === "kanjiInput" && (
          <>
            <div className="title-block">
              <div className="eyebrow">{KANJI_META.label}</div>
              <h1 className="serif">言葉を入力する</h1>
              <div className="under" />
            </div>
            <div className="card" style={{ "--c": KANJI_META.color }}>
              <textarea
                className="custom-textarea"
                style={{ "--c": KANJI_META.color }}
                value={kanjiText}
                onChange={(e) => setKanjiText(e.target.value)}
                placeholder={`漢字・言葉をコンマまたは改行で区切って入力してね（最大${KANJI_WORD_LIMIT}語）\n例：\n垂直\n拡大\n郵便`}
                rows={6}
              />
              {kanjiError && <div className="custom-error">{kanjiError}</div>}

              <div className="mode-label">テスト形式をえらぶ</div>
              <div className="mode-grid">
                {[
                  { id: "reading", label: "読み方を入力", desc: "文中の言葉を読んで、読み方をひらがなで書く" },
                  { id: "writing", label: "漢字を書く（書き取り）", desc: "文中の空欄を、読み方をヒントに漢字で書く" },
                  { id: "fillblank", label: "穴うめ作文", desc: "例文の空欄にその言葉を書く" },
                ].map((m) => (
                  <button
                    key={m.id}
                    className={`mode-btn ${kanjiMode === m.id ? "mode-active" : ""}`}
                    style={{ "--c": KANJI_META.color }}
                    onClick={() => setKanjiMode(m.id)}
                  >
                    <div className="mode-btn-label">{m.label}</div>
                    <div className="mode-btn-desc">{m.desc}</div>
                  </button>
                ))}
              </div>

              <button
                className="btn"
                style={{ "--c": KANJI_META.color, width: "100%", marginTop: 20, padding: "12px 0" }}
                onClick={startKanjiTest}
              >
                テストを作る
              </button>
            </div>
            <div style={{ textAlign: "center", marginTop: 14 }}>
              <span className="back-link" onClick={() => setScreen("select")}>教科選択にもどる</span>
            </div>
          </>
        )}

        {screen === "loading" && (
          <div className="card" style={{ "--c": meta ? meta.color : "#2F5D8A", textAlign: "center", padding: "48px 24px" }}>
            <div className="serif" style={{ fontSize: 18 }}>もんだいを準備しています…</div>
          </div>
        )}

        {screen === "quiz" && current && (
          <div className="card" style={{ "--c": meta.color }}>
            <div className="progress-row">
              <span className="subject-tag">{meta.label}</span>
              <div className="progress-boxes">
                {questions.map((_, i) => (
                  <div key={i} className={`pbox ${i <= index ? "filled" : ""}`} style={{ "--c": meta.color }} />
                ))}
              </div>
            </div>

            <div className="q-number mono">
              問 {index + 1} / {questions.length}
              {current.grade && <span className="grade-tag">{current.grade}</span>}
            </div>
            <div className="q-text serif">{current.text}</div>

            {current.speak && (
              <button type="button" className="speak-btn" style={{ "--c": meta.color }} onClick={() => speakWord(current.speak)}>
                🔊 発音を聞く
              </button>
            )}

            {current.options ? (
              <div className="option-grid">
                {current.options.map((opt) => {
                  const isChosen = checked && input === opt.text;
                  let cls = "option-btn";
                  if (checked && opt.correct) cls += " opt-correct";
                  else if (checked && isChosen && !opt.correct) cls += " opt-wrong";
                  return (
                    <button
                      key={opt.text}
                      className={cls}
                      style={{ "--c": meta.color }}
                      disabled={checked}
                      onClick={() => handleSelectOption(opt.text)}
                    >
                      {opt.text}
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="answer-row">
                <input
                  ref={inputRef}
                  className="answer-input"
                  style={{ "--c": meta.color }}
                  value={input}
                  disabled={checked}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="こたえを入力"
                  autoComplete="off"
                />
                {!checked && (
                  <button className="btn" style={{ "--c": meta.color }} onClick={() => handleCheck()} disabled={input.trim() === ""}>
                    こたえる
                  </button>
                )}
              </div>
            )}
            {!checked && <div className="hint">{current.hint}</div>}

            {checked && (
              <div className="feedback-row">
                <Stamp correct={correct} />
                <div className="feedback-text">
                  {correct ? "せいかい！" : (
                    <>
                      おしい。正解は
                      <span className="correct-answer">{current.display}</span>
                    </>
                  )}
                </div>
              </div>
            )}

            {checked && current.options && (
              <div className="explain-panel">
                {current.example && (
                  <div className="example-box">
                    <div className="example-en">{current.example.en}</div>
                    <div className="example-ja">{current.example.ja}</div>
                  </div>
                )}
                {current.note && (
                  <div className="note-box">{current.note}</div>
                )}
                <div className="explain-list">
                  {current.options.map((opt) => (
                    <div className="explain-item" key={opt.text}>
                      <span className={`explain-mark ${opt.correct ? "ok" : "ng"}`}>{opt.correct ? "○" : "×"}</span>
                      <div>
                        <span className="explain-term">{opt.text}</span>
                        <span className="explain-text">{opt.explain}</span>
                      </div>
                    </div>
                  ))}
                </div>
                {STUDY_LINKS[subject] && (
                  <a
                    className="study-link"
                    href={STUDY_LINKS[subject].url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    もっと調べる：{STUDY_LINKS[subject].label} ↗
                  </a>
                )}
              </div>
            )}
            {checked && (
              <div className="footer-row">
                <button className="btn" style={{ "--c": meta.color }} onClick={handleNext}>
                  {index + 1 >= questions.length ? "けっか" : "つぎへ"}
                </button>
              </div>
            )}
          </div>
        )}

        {screen === "result" && (
          <div className="card" style={{ "--c": meta.color }}>
            <div className="result-score">
              <div className="mono" style={{ fontSize: 12, color: "#9AA093", letterSpacing: "0.2em" }}>
                {meta.label} の結果
              </div>
              <div className="big">{score}<span style={{ fontSize: 26 }}>/{questions.length}</span></div>
              <div className="of">
                {score === questions.length ? "全問正解！お見事" : score / questions.length >= 0.7 ? "よくできました" : "もう一度ふくしゅうしよう"}
              </div>
            </div>

            <div className="review-list">
              {log.map((l, i) => (
                <div className="review-item" key={i}>
                  <span className={`mark ${l.correct ? "ok" : "ng"}`}>{l.correct ? "○" : "×"}</span>
                  <div className="body">
                    <div className="q">{l.text}</div>
                    {!l.correct && (
                      <div className="a">
                        あなたの答え：{l.userAnswer || "（無回答）"} / 正解：<b>{l.display}</b>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="result-actions">
              {subject === "英検2級単語" ? (
                <>
                  <button className="btn" style={{ "--c": meta.color }} onClick={() => startEikenGroup(eikenGroupIndex)}>
                    もう一度このセット
                  </button>
                  <button className="btn-ghost" style={{ "--c": meta.color }} onClick={() => setScreen("eikenGroups")}>
                    べつのセットをえらぶ
                  </button>
                </>
              ) : subject === "カスタム単語" ? (
                <>
                  <button className="btn" style={{ "--c": meta.color }} onClick={startCustomTest}>
                    同じ単語でもう一度
                  </button>
                  <button className="btn-ghost" style={{ "--c": meta.color }} onClick={() => setScreen("customInput")}>
                    単語を入力しなおす
                  </button>
                </>
              ) : subject === "カスタム漢字" ? (
                <>
                  <button className="btn" style={{ "--c": meta.color }} onClick={startKanjiTest}>
                    同じ言葉でもう一度
                  </button>
                  <button className="btn-ghost" style={{ "--c": meta.color }} onClick={() => setScreen("kanjiInput")}>
                    言葉を入力しなおす
                  </button>
                </>
              ) : subject === "算数" ? (
                <>
                  <button
                    className="btn"
                    style={{ "--c": meta.color }}
                    onClick={() => startMath(mathGrade, mathType, mathCount)}
                  >
                    同じ設定でもう一度
                  </button>
                  <button className="btn-ghost" style={{ "--c": meta.color }} onClick={() => setScreen("mathOptions")}>
                    設定を変更する
                  </button>
                </>
              ) : subject === "理科" || subject === "社会" ? (
                <>
                  <button
                    className="btn"
                    style={{ "--c": meta.color }}
                    onClick={() => startRikaShakai(subject, rsGrade, rsCount)}
                  >
                    同じ設定でもう一度
                  </button>
                  <button
                    className="btn-ghost"
                    style={{ "--c": meta.color }}
                    onClick={() => {
                      setRsSubject(subject);
                      setScreen("rsOptions");
                    }}
                  >
                    設定を変更する
                  </button>
                </>
              ) : (
                <>
                  <button className="btn" style={{ "--c": meta.color }} onClick={() => startSubject(subject)}>
                    もう一度この教科
                  </button>
                  <button className="btn-ghost" style={{ "--c": meta.color }} onClick={() => setScreen("select")}>
                    教科をえらびなおす
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {screen === "quiz" && (
          <div style={{ textAlign: "center", marginTop: 14 }}>
            <span
              className="back-link"
              onClick={() => {
                if (subject === "英検2級単語") setScreen("eikenGroups");
                else if (subject === "カスタム単語") setScreen("customInput");
                else if (subject === "カスタム漢字") setScreen("kanjiInput");
                else if (subject === "算数") setScreen("mathOptions");
                else if (subject === "理科" || subject === "社会") {
                  setRsSubject(subject);
                  setScreen("rsOptions");
                } else setScreen("select");
              }}
            >
              {subject === "英検2級単語"
                ? "出題範囲選択にもどる"
                : subject === "カスタム単語"
                ? "単語入力にもどる"
                : subject === "カスタム漢字"
                ? "言葉入力にもどる"
                : subject === "算数" || subject === "理科" || subject === "社会"
                ? "出題設定にもどる"
                : "教科選択にもどる"}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
