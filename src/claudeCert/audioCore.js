/* ============================================================
   CCAO-F 音声モード：読み上げる台本（プレイリスト）を作る

   画面や speechSynthesis には触らない（node のテストで全データを
   通して確かめられるように）。読み上げそのものは speech.js。

   形：
   - track（トラック）：前へ／次へで動く単位。単語1語・問題1問・讲义の1節
   - step：1回の読み上げ。{ lang, text, pause }。pause は読み終えてから
     次を読むまでの間（ミリ秒、速度 1.0・間「ふつう」のとき）
   - track.record：最後まで聞いたら学習記録に残すもの { kind, id }
   ============================================================ */

export const LANGS = [
  { id: "en", label: "英語" },
  { id: "ja", label: "日本語" },
  { id: "zh", label: "中文" },
];

export const RATES = [0.75, 0.9, 1, 1.1, 1.25];
export const GAPS = [
  { id: 0.5, label: "短め" },
  { id: 1, label: "ふつう" },
  { id: 2, label: "長め" },
];

export const DEFAULT_SETTINGS = { rate: 1, gap: 1, langs: { en: true, ja: true, zh: false } };

/** 設定を正しい形にそろえる（古い保存値・壊れた値でも動くように） */
export function normalizeSettings(s) {
  const src = s && typeof s === "object" ? s : {};
  const rate = RATES.includes(src.rate) ? src.rate : DEFAULT_SETTINGS.rate;
  const gap = GAPS.some((g) => g.id === src.gap) ? src.gap : DEFAULT_SETTINGS.gap;
  const langs = {};
  LANGS.forEach(({ id }) => {
    langs[id] = src.langs && typeof src.langs[id] === "boolean" ? src.langs[id] : DEFAULT_SETTINGS.langs[id];
  });
  // 全部 OFF だと何も読まないので英語だけは戻す
  if (!LANGS.some(({ id }) => langs[id])) langs.en = true;
  return { rate, gap, langs };
}

/* ---------- 文を区切る ----------
   Chrome は長い1発話を15秒ほどで黙って打ち切ることがある。
   句点ごとに分け、それでも長い文は読点・空白で切る。 */

const MAX_CHUNK = 160;

export function splitSentences(text) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (!t) return [];
  const pieces = t.match(/[^.!?。！？；;]+(?:[.!?。！？；;]+["'」』）)]*|$)/g) || [t];
  /* 「A. 選択肢」「e.g.」「3.5」の点では切らない（次とつなげる） */
  const sentences = [];
  pieces.forEach((p) => {
    const prev = sentences[sentences.length - 1];
    if (prev !== undefined && (/(^|\s)([A-Za-z]|e\.g|i\.e|etc|vs)\.$/.test(prev.trim()) || (/\d\.$/.test(prev) && /^\d/.test(p)))) {
      sentences[sentences.length - 1] = prev + p;
    } else {
      sentences.push(p);
    }
  });
  const out = [];
  sentences.forEach((raw) => {
    const s = raw.trim();
    if (!s) return;
    if (s.length <= MAX_CHUNK) {
      out.push(s);
      return;
    }
    // 長い文は「、，, —」のあとで切る。それも無ければ空白、最後は文字数で
    let rest = s;
    while (rest.length > MAX_CHUNK) {
      const head = rest.slice(0, MAX_CHUNK);
      let cut = Math.max(head.lastIndexOf("、"), head.lastIndexOf("，"), head.lastIndexOf(", "), head.lastIndexOf(" — "));
      if (cut < MAX_CHUNK / 3) cut = head.lastIndexOf(" ");
      if (cut < MAX_CHUNK / 3) cut = MAX_CHUNK - 1;
      out.push(rest.slice(0, cut + 1).trim());
      rest = rest.slice(cut + 1).trim();
    }
    if (rest) out.push(rest);
  });
  return out;
}

/** 「Context（背景信息）」のような英語＋中国語の見出しを、言語ごとに分ける */
export function splitMixed(text, cjkLang) {
  const t = String(text || "").trim();
  if (!t) return [];
  const parts = t.split(/[（(]([^）)]*)[）)]/);
  const out = [];
  parts.forEach((p) => {
    const s = p.trim();
    if (!s) return;
    out.push({ lang: /[぀-ヿ㐀-鿿]/.test(s) ? cjkLang : "en", text: s });
  });
  return out;
}

const PAUSE = { short: 500, mid: 1000, long: 1800, think: 3500 };

/** 読み上げると「アスタリスク」などと読まれてしまう記号を外す（中文注解に **強調** がある） */
export function speakable(text) {
  return String(text || "").replace(/\*\*|__|`/g, "").trim();
}

function step(lang, text, pause = PAUSE.short) {
  const t = speakable(text);
  return t ? { lang, text: t, pause } : null;
}

/** 言語を問わず必ず読む step（「正解は B」など）。有効な言語のうち先に見つかったもので読む */
function anyLangStep(texts, pause, order = ["ja", "zh", "en"]) {
  return { lang: "auto", texts, order, pause };
}

/**
 * 有効な言語の step だけ残し、空の track は捨てる。
 * 外した step の「間」は直前の step に引き継ぐ（中文 OFF でも考える時間が消えないように）。
 */
export function filterTracks(tracks, langs) {
  return tracks
    .map((t) => {
      const steps = [];
      t.steps.forEach((s) => {
        if (!s) return;
        let kept = null;
        if (s.lang === "auto") {
          const lang = s.order.find((l) => langs[l] && s.texts[l]);
          if (lang) kept = { lang, text: s.texts[lang], pause: s.pause };
        } else if (langs[s.lang]) {
          kept = { lang: s.lang, text: s.text, pause: s.pause };
        }
        if (kept) steps.push(kept);
        else if (steps.length) steps[steps.length - 1].pause = Math.max(steps[steps.length - 1].pause, s.pause);
      });
      return { ...t, steps };
    })
    .filter((t) => t.steps.length > 0);
}

/* ---------- 頻出単語 ----------
   単語 → 間 → 意味 → 例文 → 次の単語 */

export function vocabTracks(words) {
  return words.map((w) => {
    const ex = (w.examples || [])[0];
    return {
      id: `w:${w.id}`,
      title: w.word,
      subtitle: [w.pos, w.ja].filter(Boolean).join(" ・ "),
      record: { kind: "word", id: w.id },
      steps: [
        step("en", w.word, PAUSE.long),
        step("ja", w.ja, PAUSE.mid),
        step("zh", w.zh, PAUSE.mid),
        ex && step("en", ex.en, PAUSE.mid),
        ex && step("zh", ex.zh, PAUSE.mid),
        // 例文を聞いたあと、もう一度単語で締める（覚えやすいように）
        step("en", w.word, PAUSE.long),
      ].filter(Boolean),
    };
  });
}

/* ---------- 問題 ----------
   問題文 → 選択肢 A〜D → 考える間 → 正解 → 正解の解説 → 中文注解 */

const LETTERS = "ABCDEFGH";

function answerTexts(letters) {
  return {
    ja: `正解は ${letters.join("、")}。`,
    zh: `正确答案是 ${letters.join("、")}。`,
    en: `The answer is ${letters.join(" and ")}.`,
  };
}

/** @param {object[]} questions choices は並べ替え済みのものを渡す（正解が A に偏らないように） */
export function questionTracks(questions) {
  return questions.map((q, n) => {
    const correct = q.choices.map((c, i) => (c.correct ? LETTERS[i] : null)).filter(Boolean);
    const steps = [
      step("en", `Question ${n + 1}.`, PAUSE.short),
      q.material && step("en", q.material, PAUSE.mid),
      q.materialZh && step("zh", q.materialZh, PAUSE.mid),
      step("en", q.stem, PAUSE.mid),
      step("zh", q.stemZh, PAUSE.mid),
      // 複数選択は問題文に「(Select 2)」が入っているので、別に言わない
      q.selectCount > 1 && !/\(Select \d/.test(q.stem) && step("en", `Choose ${q.selectCount}.`, PAUSE.short),
    ];
    q.choices.forEach((c, i) => {
      steps.push(step("en", `${LETTERS[i]}. ${c.text}`, PAUSE.mid));
      steps.push(step("zh", c.textZh, PAUSE.mid));
    });
    // 最後の選択肢のあとに考える時間を置く
    const last = steps.filter(Boolean).pop();
    if (last) last.pause = PAUSE.think;
    steps.push(anyLangStep(answerTexts(correct), PAUSE.short));
    q.choices.forEach((c, i) => {
      if (!c.correct) return;
      steps.push(step("en", `${LETTERS[i]}. ${c.text}`, PAUSE.short));
      steps.push(step("ja", c.explain, PAUSE.mid));
    });
    steps.push(step("zh", q.commentaryZh, PAUSE.long));
    return {
      id: `q:${q.id}`,
      title: `第 ${n + 1} 問`,
      subtitle: q.id,
      record: { kind: "item", id: q.id },
      steps: steps.filter(Boolean),
    };
  });
}

/* ---------- 考点讲义 ----------
   本文は中国語、用語は英語。節ごとに1トラック。
   最後の節まで聞いたら、その讲义を聞いたことにする。 */

export function lessonTracks(lessons) {
  const out = [];
  lessons.forEach((l) => {
    const sec = (key, title, steps) => out.push({ id: `l:${l.id}:${key}`, title: `${l.id} ${l.titleZh}`, subtitle: title, record: null, steps: steps.filter(Boolean) });
    sec("summary", "概要", [step("en", l.objective, PAUSE.mid), step("zh", l.titleZh, PAUSE.mid), step("zh", l.summaryZh, PAUSE.long)]);
    sec(
      "concepts",
      "核心概念",
      (l.concepts || []).flatMap((c) => [
        ...splitMixed(c.term, "zh").map((p) => step(p.lang, p.text, PAUSE.short)),
        step("zh", c.zh, PAUSE.long),
      ])
    );
    if (l.example) {
      sec("example", "正例与反例", [
        step("zh", "反例。", PAUSE.short),
        step("zh", l.example.bad, PAUSE.mid),
        step("zh", "正例。", PAUSE.short),
        step("zh", l.example.good, PAUSE.mid),
        step("zh", l.example.whyZh, PAUSE.long),
      ]);
    }
    sec("pitfalls", "常见陷阱", [step("zh", "常见陷阱。", PAUSE.short), ...(l.pitfalls || []).map((t) => step("zh", t, PAUSE.mid))]);
    sec("examTips", "考试怎么考", [step("zh", "考试怎么考。", PAUSE.short), ...(l.examTips || []).map((t) => step("zh", t, PAUSE.mid))]);
    sec("practice", "实务应用", [step("zh", "实务应用。", PAUSE.short), step("zh", l.practiceZh, PAUSE.long)]);
    const lastOfLesson = [...out].reverse().find((t) => t.id.startsWith(`l:${l.id}:`) && t.steps.length);
    if (lastOfLesson) lastOfLesson.record = { kind: "lesson", id: l.id };
  });
  return out.filter((t) => t.steps.length);
}

/**
 * 中文を普通话の声で自然に読めるよう、記号を言い換える（v1.43.0〜）。
 * 「——」「→」を記号の名前で読んだり、「／」「＋」で詰まったりする声があるので、
 * 間（，、）や読み方（加、等于）に置きかえる。かぎかっこは読まない。
 */
export function speakableZh(text) {
  return speakable(text)
    .replace(/\s*(?:——|—|–|→|⇒|➡)\s*/g, "，")
    .replace(/[」』”]\s*[「『“]/g, "、")
    .replace(/[「」『』“”"]/g, "")
    .replace(/([\u3400-\u9fff])\s*[／/]\s*(?=[\u3400-\u9fff])/g, "$1、")
    .replace(/\s*／\s*/g, "、")
    .replace(/\s*[＋+]\s*/g, "加")
    .replace(/\s*[＝=]\s*/g, "等于")
    .replace(/(\d)\s*[～~]\s*(?=\d)/g, "$1到")
    .replace(/[～~]/g, "到")
    .replace(/(\d)\s*[×x]\s*(?=\d)/g, "$1乘")
    .replace(/×/g, "乘")
    .replace(/…+|\.{3,}/g, "。")
    .replace(/，(?=[，。！？；：])/g, "")
    .replace(/^，|，$/g, "")
    .trim();
}

/** 読み上げ1回ぶんを、Chrome が途中で切らない長さに分けた発話の列にする */
export function utterancesOf(s) {
  const text = s.lang === "zh" ? speakableZh(s.text) : speakable(s.text);
  return splitSentences(text).map((t) => ({ lang: s.lang, text: t }));
}

/** 速度と「間」の設定を反映した待ち時間 */
export function pauseMs(pause, settings) {
  return Math.round((pause * settings.gap) / settings.rate);
}
