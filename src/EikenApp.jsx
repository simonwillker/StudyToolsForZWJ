import React, { useMemo, useState, useCallback, useEffect } from "react";
import LEVEL_5 from "./data/eikenApp/5.json";
import LEVEL_4 from "./data/eikenApp/4.json";
import LEVEL_3 from "./data/eikenApp/3.json";
import LEVEL_PRE2 from "./data/eikenApp/pre2.json";
import LEVEL_2 from "./data/eikenApp/2.json";
import LEVEL_PRE1 from "./data/eikenApp/pre1.json";
import LEVEL_1 from "./data/eikenApp/1.json";
import EikenTest from "./EikenTest.jsx";
import TEST_5 from "./data/eikenTest/5.json";
import TEST_4 from "./data/eikenTest/4.json";
import TEST_3 from "./data/eikenTest/3.json";
import TEST_PRE2 from "./data/eikenTest/pre2.json";
import TEST_2 from "./data/eikenTest/2.json";
import TEST_PRE1 from "./data/eikenTest/pre1.json";
import TEST_1 from "./data/eikenTest/1.json";
import {
  recordAnswer,
  getLevelStats,
  getAllStats,
  accuracyPercent,
  resetProgress,
  resetLevelProgress,
} from "./eikenProgress";
import {
  recordReviewResult,
  getReviewEntries,
  getReviewCount,
  getReviewCountByMode,
  clearLevelReview,
} from "./eikenReview";
import {
  isSpeechSynthesisSupported,
  isSpeechRecognitionSupported,
  speak,
  stopSpeaking,
  listenOnce,
  scoreSimilarity,
  similarityFeedback,
} from "./eikenSpeech";

/* ============================================================
   ユーティリティ
   ============================================================ */

const LEVELS = [LEVEL_1, LEVEL_PRE1, LEVEL_2, LEVEL_PRE2, LEVEL_3, LEVEL_4, LEVEL_5];

const TESTS = [TEST_1, TEST_PRE1, TEST_2, TEST_PRE2, TEST_3, TEST_4, TEST_5];

const APP_VERSION = "1.1.0";

const OFFICIAL_LINKS = [
  { label: "日本英語検定協会（英検）公式サイト ↗", url: "https://www.eiken.or.jp/eiken/" },
  { label: "英検 公式の過去問一覧 ↗", url: "https://www.eiken.or.jp/eiken/exam/exam_past/" },
  { label: "英検 受験案内・申し込み ↗", url: "https://www.eiken.or.jp/eiken/exam/" },
];

const MODES = [
  { id: "vocab", label: "単語・熟語", desc: "4択クイズで語彙を覚える", icon: "📘" },
  { id: "grammar", label: "文法・穴うめ", desc: "空所に入る正しい語句を選ぶ", icon: "✏️" },
  { id: "reading", label: "長文読解", desc: "英文を読んで内容を答える", icon: "📖" },
  { id: "listening", label: "リスニング", desc: "音声を聞いて内容を答える", icon: "🎧" },
  { id: "dialogue", label: "会話文", desc: "会話の流れを聞いて応答を選ぶ", icon: "💬" },
  { id: "pronunciation", label: "発音練習", desc: "単語をまねして発音する", icon: "🎤" },
  { id: "test", label: "模擬テスト", desc: "過去問の構成どおりに1回分を通しで受験する", icon: "📝", wide: true },
];

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randInt(0, i);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function findLevel(id) {
  return LEVELS.find((l) => l.level === id) || LEVELS[0];
}
function findTest(id) {
  return TESTS.find((t) => t.level === id) || null;
}

/** 単語は20語ずつの「組」に分けて出題する（CLAUDE.mdの出題範囲の考え方に合わせる） */
const VOCAB_UNIT_SIZE = 20;
/** 文法問題も20問ずつの「組」に分けて出題する */
const GRAMMAR_UNIT_SIZE = 20;
/** 長文読解は5問（＝1パッセージぶん）ずつの「組」に分けて出題する */
const READING_UNIT_SIZE = 5;

function vocabUnitCount(level) {
  return Math.ceil(level.vocab.length / VOCAB_UNIT_SIZE);
}

/** unit が "all" なら全語、数値ならその組（0始まり）の単語だけを返す */
function vocabOfUnit(level, unit) {
  if (unit === "all") return level.vocab;
  const start = unit * VOCAB_UNIT_SIZE;
  return level.vocab.slice(start, start + VOCAB_UNIT_SIZE);
}

function vocabUnitLabel(level, unit) {
  if (unit === "all") return `すべて（${level.vocab.length}語）`;
  const start = unit * VOCAB_UNIT_SIZE;
  const end = Math.min(start + VOCAB_UNIT_SIZE, level.vocab.length);
  return `${unit + 1}組（${start + 1}〜${end}）`;
}

/** 級を切りかえて組の数が減ったときなど、範囲外の組は1組目にもどす */
function clampVocabUnit(level, unit) {
  return unit === "all" || unit < vocabUnitCount(level) ? unit : 0;
}

function grammarUnitCount(level) {
  return Math.ceil(level.grammar.length / GRAMMAR_UNIT_SIZE);
}

/** unit が "all" なら全問、数値ならその組（0始まり）の問題だけを返す */
function grammarOfUnit(level, unit) {
  if (unit === "all") return level.grammar;
  const start = unit * GRAMMAR_UNIT_SIZE;
  return level.grammar.slice(start, start + GRAMMAR_UNIT_SIZE);
}

function grammarUnitLabel(level, unit) {
  if (unit === "all") return `すべて（${level.grammar.length}問）`;
  const start = unit * GRAMMAR_UNIT_SIZE;
  const end = Math.min(start + GRAMMAR_UNIT_SIZE, level.grammar.length);
  return `${unit + 1}組（${start + 1}〜${end}）`;
}

/** 級を切りかえて組の数が減ったときなど、範囲外の組は1組目にもどす */
function clampGrammarUnit(level, unit) {
  return unit === "all" || unit < grammarUnitCount(level) ? unit : 0;
}

function readingUnitCount(level) {
  return Math.ceil(flattenReading(level).length / READING_UNIT_SIZE);
}

/** unit が "all" なら全設問、数値ならその組（0始まり）の設問だけを返す */
function readingOfUnit(level, unit) {
  const flat = flattenReading(level);
  if (unit === "all") return flat;
  const start = unit * READING_UNIT_SIZE;
  return flat.slice(start, start + READING_UNIT_SIZE);
}

function readingUnitLabel(level, unit) {
  const flat = flattenReading(level);
  if (unit === "all") return `すべて（${flat.length}問）`;
  const start = unit * READING_UNIT_SIZE;
  const end = Math.min(start + READING_UNIT_SIZE, flat.length);
  return `${unit + 1}組（${start + 1}〜${end}）`;
}

/** 級を切りかえて組の数が減ったときなど、範囲外の組は1組目にもどす */
function clampReadingUnit(level, unit) {
  return unit === "all" || unit < readingUnitCount(level) ? unit : 0;
}

/** 出題範囲（組）の選択リスト。組が増えても1行に収まる */
function VocabUnitSelect({ level, value, onChange, allowAll }) {
  return (
    <label className="eiken-control-row">
      <span className="eiken-control-label">出題範囲</span>
      <select
        className="eiken-unit-select"
        value={String(value)}
        onChange={(e) => onChange(e.target.value === "all" ? "all" : Number(e.target.value))}
      >
        {Array.from({ length: vocabUnitCount(level) }, (_, u) => (
          <option key={u} value={u}>
            {vocabUnitLabel(level, u)}
          </option>
        ))}
        {allowAll && <option value="all">{vocabUnitLabel(level, "all")}</option>}
      </select>
    </label>
  );
}

/** 文法問題の出題範囲（組）の選択リスト */
function GrammarUnitSelect({ level, value, onChange, allowAll }) {
  return (
    <label className="eiken-control-row">
      <span className="eiken-control-label">出題範囲</span>
      <select
        className="eiken-unit-select"
        value={String(value)}
        onChange={(e) => onChange(e.target.value === "all" ? "all" : Number(e.target.value))}
      >
        {Array.from({ length: grammarUnitCount(level) }, (_, u) => (
          <option key={u} value={u}>
            {grammarUnitLabel(level, u)}
          </option>
        ))}
        {allowAll && <option value="all">{grammarUnitLabel(level, "all")}</option>}
      </select>
    </label>
  );
}

/** 長文読解の出題範囲（組）の選択リスト */
function ReadingUnitSelect({ level, value, onChange, allowAll }) {
  return (
    <label className="eiken-control-row">
      <span className="eiken-control-label">出題範囲</span>
      <select
        className="eiken-unit-select"
        value={String(value)}
        onChange={(e) => onChange(e.target.value === "all" ? "all" : Number(e.target.value))}
      >
        {Array.from({ length: readingUnitCount(level) }, (_, u) => (
          <option key={u} value={u}>
            {readingUnitLabel(level, u)}
          </option>
        ))}
        {allowAll && <option value="all">{readingUnitLabel(level, "all")}</option>}
      </select>
    </label>
  );
}

/* ============================================================
   問題セット生成
   ============================================================ */

function buildVocabItems(level, direction, words) {
  const questions = words && words.length ? words : level.vocab;
  return shuffle(questions).map((w) => {
    const pool = level.vocab.filter((x) => x.id !== w.id);
    const wrongs = shuffle(pool).slice(0, 3);
    let choices;
    let headerWord;
    if (direction === "en2ja") {
      headerWord = w.word;
      choices = shuffle([
        { text: w.meaning, correct: true, explain: `正解：${w.word} = ${w.meaning}` },
        ...wrongs.map((x) => ({ text: x.meaning, correct: false, explain: `「${x.meaning}」は "${x.word}" の意味です。` })),
      ]);
    } else {
      headerWord = w.meaning;
      choices = shuffle([
        { text: w.word, correct: true, explain: `正解：${w.word} = ${w.meaning}` },
        ...wrongs.map((x) => ({ text: x.word, correct: false, explain: `"${x.word}" は「${x.meaning}」という意味です。` })),
      ]);
    }
    return {
      id: `${w.id}-${direction}`,
      header: () => (
        <div className="eiken-qhead">
          <div className="eiken-qhead-eyebrow">{direction === "en2ja" ? "この単語の意味は？" : "この意味を表す単語は？"}</div>
          <div className="eiken-qhead-main">
            <span>{headerWord}</span>
            {direction === "en2ja" && isSpeechSynthesisSupported() && (
              <button className="eiken-speak-btn" onClick={() => speak(w.word)} aria-label="発音を聞く">🔊</button>
            )}
          </div>
          {w.pos && <div className="eiken-qhead-sub">{w.pos}{w.phonetic ? ` ／ [${w.phonetic}]` : ""}</div>}
        </div>
      ),
      choices,
      extra: (
        <div className="eiken-example-box">
          <div className="eiken-example-row">
            <span className="eiken-example-en">{w.example.en}</span>
            {isSpeechSynthesisSupported() && (
              <button className="eiken-speak-btn small" onClick={() => speak(w.example.en)} aria-label="例文を聞く">🔊</button>
            )}
          </div>
          <div className="eiken-example-ja">{w.example.ja}</div>
        </div>
      ),
    };
  });
}

function buildGrammarItems(level, items) {
  return shuffle(items && items.length ? items : level.grammar).map((g) => ({
    id: g.id,
    header: () => (
      <div className="eiken-qhead">
        <div className="eiken-qhead-eyebrow">空所に入る最も適切なものを選びましょう</div>
        <div className="eiken-qhead-main sentence">{g.sentence}</div>
      </div>
    ),
    // 選択肢はデータ上ほぼ常に正解が先頭に置かれているため、出題時に必ずシャッフルする
    choices: shuffle(g.choices),
    extra: (
      <div className="eiken-note-box">
        <div className="eiken-note-point">📌 {g.point}</div>
        <div className="eiken-note-ja">訳：{g.ja}</div>
      </div>
    ),
  }));
}

/** 全パッセージの設問を1本の配列にフラット化する（出題範囲の組分けに使う） */
function flattenReading(level) {
  const flat = [];
  level.reading.forEach((passage) => {
    passage.questions.forEach((q, qi) => {
      flat.push({ passage, q, qi });
    });
  });
  return flat;
}

function buildReadingItems(level, flatItems) {
  const flat = flatItems && flatItems.length ? flatItems : flattenReading(level);
  return flat.map(({ passage, q, qi }) => ({
    id: q.id,
    header: () => (
      <div className="eiken-qhead">
        <div className="eiken-passage-box">
          <div className="eiken-passage-title-row">
            <span className="eiken-passage-title">{passage.title}</span>
            {isSpeechSynthesisSupported() && (
              <button className="eiken-speak-btn small" onClick={() => speak(passage.passage)} aria-label="本文を読み上げる">🔊 読み上げ</button>
            )}
          </div>
          <div className="eiken-passage-text">{passage.passage}</div>
        </div>
        <div className="eiken-qhead-sub" style={{ marginTop: 10 }}>設問 {qi + 1} / {passage.questions.length}</div>
        <div className="eiken-qhead-main sentence">{q.q}</div>
      </div>
    ),
    choices: shuffle(q.choices),
  }));
}

function buildListeningItems(level) {
  return level.listening.map((l) => ({
    id: l.id,
    header: (answered) => <ListeningHeader item={l} answered={answered} />,
    choices: shuffle(l.choices),
    extra: (
      <div className="eiken-note-box">
        <div className="eiken-note-point">📝 スクリプト</div>
        <div className="eiken-example-en">{l.script}</div>
        <div className="eiken-note-ja" style={{ marginTop: 6 }}>訳：{l.translation}</div>
      </div>
    ),
  }));
}

function ListeningHeader({ item, answered }) {
  const [played, setPlayed] = useState(false);
  return (
    <div className="eiken-qhead">
      <div className="eiken-qhead-eyebrow">音声を聞いて、質問に答えましょう</div>
      <button
        className="eiken-play-btn"
        onClick={() => {
          speak(item.script);
          setPlayed(true);
        }}
      >
        {played ? "🔁 もう一度再生する" : "▶ 音声を再生する"}
      </button>
      {!isSpeechSynthesisSupported() && (
        <div className="eiken-warn">このブラウザは読み上げに対応していません。下の「スクリプト」を確認してください（回答後に表示されます）。</div>
      )}
      <div className="eiken-qhead-main sentence" style={{ marginTop: 12 }}>{item.question}</div>
      {!answered && <div className="eiken-hint">※ スクリプトと日本語訳は回答後に表示されます</div>}
    </div>
  );
}

function buildDialogueItems(level) {
  return level.dialogue.map((d) => ({
    id: d.id,
    header: (answered) => <DialogueHeader item={d} answered={answered} />,
    choices: shuffle(d.choices),
    extra: (
      <div className="eiken-note-box">
        <div className="eiken-note-point">📝 日本語訳</div>
        <div className="eiken-note-ja">{d.translation}</div>
      </div>
    ),
  }));
}

function DialogueHeader({ item, answered }) {
  const correctChoice = item.choices.find((c) => c.correct);
  const playAll = () => {
    if (!isSpeechSynthesisSupported()) return;
    stopSpeaking();
    const utterances = item.lines.map((line, i) => {
      const text = i === item.blankIndex ? (answered ? correctChoice.text : null) : line.text;
      return text ? { speaker: line.speaker, text } : null;
    }).filter(Boolean);
    let i = 0;
    const playNext = () => {
      if (i >= utterances.length) return;
      const u = utterances[i];
      const utter = new SpeechSynthesisUtterance(u.text);
      utter.lang = "en-US";
      utter.rate = 0.92;
      utter.pitch = u.speaker === "A" ? 1.15 : 0.85;
      utter.onend = () => {
        i += 1;
        playNext();
      };
      window.speechSynthesis.speak(utter);
    };
    playNext();
  };

  return (
    <div className="eiken-qhead">
      <div className="eiken-qhead-eyebrow">{item.title}</div>
      <div className="eiken-dialogue-box">
        {item.lines.map((line, i) => (
          <div className="eiken-dialogue-line" key={i}>
            <span className={`eiken-speaker eiken-speaker-${line.speaker}`}>{line.speaker}</span>
            {i === item.blankIndex ? (
              <span className="eiken-dialogue-blank">{answered ? correctChoice.text : "＿＿＿＿＿＿（空所）"}</span>
            ) : (
              <span className="eiken-dialogue-text">
                {line.text}
                {isSpeechSynthesisSupported() && (
                  <button className="eiken-speak-btn tiny" onClick={() => speak(line.text)} aria-label="この行を聞く">🔊</button>
                )}
              </span>
            )}
          </div>
        ))}
      </div>
      {isSpeechSynthesisSupported() && (
        <button className="eiken-play-btn" onClick={playAll}>▶ 会話をとおして再生する</button>
      )}
      <div className="eiken-qhead-sub" style={{ marginTop: 10 }}>空所に入る最も自然な発言を選びましょう</div>
    </div>
  );
}

/* ============================================================
   復習ドリル：まちがえた問題だけを集めて出題する
   ============================================================ */

/** 復習リストにある問題だけを、元のモードの出題形式で組み立て直す。
 *  どの問題も元のモードを reviewMode として持ち回り、解答時の記録に使う。 */
function buildReviewItems(level, vocabDirection) {
  const entries = getReviewEntries(level.level);
  if (!entries.length) return [];

  const idsOf = (mode) => new Set(entries.filter((e) => e.mode === mode).map((e) => e.itemId));
  const tag = (list, mode) => list.map((it) => ({ ...it, reviewMode: mode }));
  const out = [];

  const vocabIds = idsOf("vocab");
  if (vocabIds.size) {
    const words = level.vocab.filter((w) => vocabIds.has(w.id));
    if (words.length) out.push(...tag(buildVocabItems(level, vocabDirection, words), "vocab"));
  }

  const grammarIds = idsOf("grammar");
  if (grammarIds.size) {
    const gs = level.grammar.filter((g) => grammarIds.has(g.id));
    if (gs.length) out.push(...tag(buildGrammarItems(level, gs), "grammar"));
  }

  const readingIds = idsOf("reading");
  if (readingIds.size) {
    const flat = flattenReading(level).filter((f) => readingIds.has(f.q.id));
    if (flat.length) out.push(...tag(buildReadingItems(level, flat), "reading"));
  }

  const listeningIds = idsOf("listening");
  if (listeningIds.size) {
    out.push(...tag(buildListeningItems(level).filter((it) => listeningIds.has(it.id)), "listening"));
  }

  const dialogueIds = idsOf("dialogue");
  if (dialogueIds.size) {
    out.push(...tag(buildDialogueItems(level).filter((it) => dialogueIds.has(it.id)), "dialogue"));
  }

  return shuffle(out);
}

/* ============================================================
   共通クイズ画面
   ============================================================ */

function ChoiceQuiz({ level, mode, items, accent, onExit }) {
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState(null);
  const [answered, setAnswered] = useState(false);
  const [score, setScore] = useState({ correct: 0, total: 0 });
  const [finished, setFinished] = useState(false);

  useEffect(() => {
    setIndex(0);
    setSelected(null);
    setAnswered(false);
    setScore({ correct: 0, total: 0 });
    setFinished(false);
  }, [items]);

  if (!items.length) {
    return (
      <div className="eiken-empty">このレベルにはまだ問題が登録されていません。</div>
    );
  }

  const item = items[Math.min(index, items.length - 1)];

  const handleSelect = (ci) => {
    if (answered) return;
    const choice = item.choices[ci];
    setSelected(ci);
    setAnswered(true);
    // 復習ドリルでは、問題ごとに元のモード（文法・単語など）で記録する
    const answeredMode = item.reviewMode || mode;
    recordAnswer(level.level, answeredMode, item.id, !!choice.correct);
    recordReviewResult(level.level, answeredMode, item.id, !!choice.correct);
    setScore((s) => ({ correct: s.correct + (choice.correct ? 1 : 0), total: s.total + 1 }));
  };

  const handleNext = () => {
    stopSpeaking();
    if (index + 1 < items.length) {
      setIndex(index + 1);
      setSelected(null);
      setAnswered(false);
    } else {
      setFinished(true);
    }
  };

  const handleRetry = () => {
    setIndex(0);
    setSelected(null);
    setAnswered(false);
    setScore({ correct: 0, total: 0 });
    setFinished(false);
  };

  if (finished) {
    return (
      <div className="eiken-result" style={{ "--c": accent }}>
        <div className="eiken-result-big">{score.correct} / {score.total}</div>
        <div className="eiken-result-sub">正解できました</div>
        <div className="eiken-result-actions">
          <button className="eiken-btn" onClick={handleRetry}>もう一度挑戦する</button>
          <button className="eiken-btn-ghost" onClick={onExit}>モード選択にもどる</button>
        </div>
      </div>
    );
  }

  return (
    <div className="eiken-quiz" style={{ "--c": accent }}>
      <div className="eiken-progressbar">
        <div className="eiken-progressbar-track">
          <div className="eiken-progressbar-fill" style={{ width: `${((index) / items.length) * 100}%` }} />
        </div>
        <div className="eiken-progressbar-label">{index + 1} / {items.length} 問</div>
      </div>

      {item.header(answered)}

      <div className="eiken-choices">
        {item.choices.map((c, ci) => {
          let cls = "eiken-choice-btn";
          if (answered) {
            if (c.correct) cls += " correct";
            else if (ci === selected) cls += " wrong";
          }
          return (
            <button key={ci} className={cls} onClick={() => handleSelect(ci)} disabled={answered}>
              {c.text}
            </button>
          );
        })}
      </div>

      {answered && (
        <div className="eiken-explain">
          <div className="eiken-explain-title">{item.choices[selected]?.correct ? "✅ 正解です！" : "❌ 不正解です"}</div>
          <div className="eiken-explain-list">
            {item.choices.map((c, ci) => (
              <div className="eiken-explain-item" key={ci}>
                <span className={`eiken-explain-mark ${c.correct ? "ok" : "ng"}`}>{c.correct ? "◎" : "×"}</span>
                <span><b>{c.text}</b>：{c.explain}</span>
              </div>
            ))}
          </div>
          {item.extra}
          <div className="eiken-next-row">
            <button className="eiken-btn" onClick={handleNext}>{index + 1 < items.length ? "次の問題へ" : "結果を見る"}</button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ============================================================
   発音練習モード
   ============================================================ */

function PronunciationMode({ level, accent }) {
  const [unit, setUnit] = useState(0);
  const [idx, setIdx] = useState(0);
  const [status, setStatus] = useState("idle"); // idle | listening | done | error
  const [transcript, setTranscript] = useState("");
  const [score, setScore] = useState(null);
  const words = vocabOfUnit(level, clampVocabUnit(level, unit));
  const word = words[Math.min(idx, words.length - 1)];

  const speechOK = isSpeechRecognitionSupported();

  const reset = () => {
    setStatus("idle");
    setTranscript("");
    setScore(null);
  };

  const handlePick = (i) => {
    setIdx(i);
    reset();
  };

  const handleListen = () => {
    reset();
    setStatus("listening");
    listenOnce({
      onResult: (text) => {
        const s = scoreSimilarity(word.word, text);
        setTranscript(text);
        setScore(s);
        setStatus("done");
        recordAnswer(level.level, "pronunciation", word.id, s >= 70);
      },
      onError: (msg) => {
        setTranscript(msg);
        setStatus("error");
      },
    });
  };

  return (
    <div className="eiken-pronounce" style={{ "--c": accent }}>
      <div style={{ marginBottom: 12 }}>
        <VocabUnitSelect
          level={level}
          value={clampVocabUnit(level, unit)}
          onChange={(u) => {
            setUnit(u);
            setIdx(0);
            setStatus("idle");
            setTranscript("");
            setScore(null);
          }}
        />
      </div>
      <div className="eiken-qhead-eyebrow">練習する単語を選びましょう</div>
      <div className="eiken-word-grid">
        {words.map((w, i) => (
          <button key={w.id} className={`eiken-word-chip ${i === idx ? "active" : ""}`} onClick={() => handlePick(i)}>
            {w.word}
          </button>
        ))}
      </div>

      <div className="eiken-pronounce-card">
        <div className="eiken-qhead-main">
          <span>{word.word}</span>
          {isSpeechSynthesisSupported() && (
            <button className="eiken-speak-btn" onClick={() => speak(word.word)} aria-label="お手本を聞く">🔊</button>
          )}
        </div>
        <div className="eiken-qhead-sub">{word.pos} ／ [{word.phonetic}] ／ {word.meaning}</div>

        <div className="eiken-pronounce-actions">
          <button className="eiken-btn" onClick={() => speak(word.word)}>▶ お手本を聞く</button>
          {speechOK ? (
            <button className="eiken-btn-ghost" onClick={handleListen} disabled={status === "listening"}>
              {status === "listening" ? "🎤 聞き取り中…" : "🎤 発音してみる"}
            </button>
          ) : (
            <span className="eiken-warn">このブラウザは音声認識に対応していません（お手本を聞いてまねしましょう）。</span>
          )}
        </div>

        {status === "done" && (
          <div className="eiken-note-box">
            <div>認識結果：「{transcript}」</div>
            <div style={{ marginTop: 6, fontWeight: 700 }}>近さスコア：{score} / 100</div>
            <div style={{ marginTop: 4 }}>{similarityFeedback(score)}</div>
          </div>
        )}
        {status === "error" && <div className="eiken-warn" style={{ marginTop: 10 }}>{transcript}</div>}
      </div>
    </div>
  );
}

/* ============================================================
   進捗ダッシュボード
   ============================================================ */

function ProgressDashboard({ onBack }) {
  const [, forceRefresh] = useState(0);
  const stats = useMemo(() => getAllStats(LEVELS.map((l) => l.level)), []); // eslint-disable-line react-hooks/exhaustive-deps
  const totalAttempted = stats.reduce((s, x) => s + x.attempted, 0);
  const totalCorrect = stats.reduce((s, x) => s + x.correct, 0);

  const handleReset = () => {
    if (window.confirm("すべての学習記録を削除します。よろしいですか？")) {
      resetProgress();
      forceRefresh((n) => n + 1);
      window.location.reload();
    }
  };

  return (
    <div className="eiken-progress">
      <div className="eiken-title-block">
        <div className="eiken-eyebrow">STUDY LOG</div>
        <h1 className="eiken-serif">学習記録</h1>
        <div className="eiken-under" />
      </div>

      <div className="eiken-total-card">
        <div className="eiken-total-num">{totalAttempted === 0 ? "-" : `${accuracyPercent({ attempted: totalAttempted, correct: totalCorrect })}%`}</div>
        <div className="eiken-total-sub">全体正答率（のべ{totalAttempted}問中{totalCorrect}問正解）</div>
      </div>

      <div className="eiken-level-stats">
        {stats.map((s) => {
          const level = findLevel(s.level);
          const pct = accuracyPercent(s);
          return (
            <div className="eiken-level-stat-row" key={s.level} style={{ "--c": level.color }}>
              <div className="eiken-level-stat-name">{level.levelLabel}</div>
              <div className="eiken-level-stat-bar-track">
                <div className="eiken-level-stat-bar-fill" style={{ width: `${pct ?? 0}%` }} />
              </div>
              <div className="eiken-level-stat-num">{pct === null ? "未学習" : `${pct}%（${s.attempted}問）`}</div>
            </div>
          );
        })}
      </div>

      <div className="eiken-footer-row">
        <button className="eiken-link-btn danger" onClick={handleReset}>学習記録をすべてリセット</button>
        <button className="eiken-btn-ghost" onClick={onBack}>もどる</button>
      </div>
    </div>
  );
}

/* ============================================================
   メイン
   ============================================================ */

export default function EikenApp({ onExitApp }) {
  const [screen, setScreen] = useState("levelSelect"); // levelSelect | modeSelect | quiz | pronunciation | progress
  const [levelId, setLevelId] = useState(null);
  const [mode, setMode] = useState(null);
  const [vocabDirection, setVocabDirection] = useState("en2ja");
  const [vocabUnit, setVocabUnit] = useState(0);
  const [grammarUnit, setGrammarUnit] = useState(0);
  const [readingUnit, setReadingUnit] = useState(0);
  // 復習リストは解答のたびに変わるので、画面を戻るたびに数え直すためのカウンタ
  const [reviewNonce, setReviewNonce] = useState(0);

  const level = levelId ? findLevel(levelId) : null;

  const reviewCount = useMemo(
    () => (level ? getReviewCount(level.level) : 0),
    [level, reviewNonce]
  );
  const reviewByMode = useMemo(
    () => (level ? getReviewCountByMode(level.level) : {}),
    [level, reviewNonce]
  );

  const items = useMemo(() => {
    if (!level || !mode) return [];
    if (mode === "vocab") return buildVocabItems(level, vocabDirection, vocabOfUnit(level, clampVocabUnit(level, vocabUnit)));
    if (mode === "grammar") return buildGrammarItems(level, grammarOfUnit(level, clampGrammarUnit(level, grammarUnit)));
    if (mode === "reading") return buildReadingItems(level, readingOfUnit(level, clampReadingUnit(level, readingUnit)));
    if (mode === "listening") return buildListeningItems(level);
    if (mode === "dialogue") return buildDialogueItems(level);
    if (mode === "review") return buildReviewItems(level, vocabDirection);
    return [];
  }, [level, mode, vocabDirection, vocabUnit, grammarUnit, readingUnit, reviewNonce]);

  const goModeSelect = useCallback((lvId) => {
    stopSpeaking();
    setLevelId(lvId);
    setReviewNonce((n) => n + 1);
    setScreen("modeSelect");
  }, []);

  const goMode = useCallback((m) => {
    stopSpeaking();
    setMode(m);
    if (m === "pronunciation") setScreen("pronunciation");
    else if (m === "test") setScreen("test");
    else setScreen("quiz");
  }, []);

  const backToModeSelect = useCallback(() => {
    stopSpeaking();
    setReviewNonce((n) => n + 1);
    setScreen("modeSelect");
  }, []);

  const backToLevelSelect = useCallback(() => {
    stopSpeaking();
    setScreen("levelSelect");
    setLevelId(null);
  }, []);

  return (
    <div className="eiken-app">
      <style>{`
        .eiken-app {
          --bg: #F7F6F2;
          min-height: 100vh;
          background: var(--bg);
          font-family: 'Zen Kaku Gothic New', 'Hiragino Sans', sans-serif;
          color: #2A2E27;
          padding: 28px 16px 60px;
        }
        .eiken-inner { max-width: 720px; margin: 0 auto; }
        .eiken-title-block { text-align: center; margin-bottom: 24px; }
        .eiken-eyebrow { font-size: 11px; letter-spacing: 2px; color: #9AA093; font-weight: 700; }
        .eiken-serif { font-family: 'Shippori Mincho', serif; font-size: 30px; margin: 6px 0; }
        .eiken-under { width: 40px; height: 3px; background: #C8323D; margin: 0 auto; }

        .eiken-top-nav { display: flex; justify-content: space-between; align-items: center; max-width: 720px; margin: 0 auto 12px; }
        .eiken-top-nav-right { display: flex; align-items: center; gap: 12px; }
        .eiken-version-badge { font-size: 11px; color: #9AA093; font-weight: 700; letter-spacing: 0.5px; }
        .eiken-back-link { font-size: 13px; color: #6B7280; cursor: pointer; text-decoration: underline; text-underline-offset: 3px; background: none; border: none; padding: 0; }

        .eiken-official-box { max-width: 720px; margin: 24px auto 0; background: #FBFAF6; border: 1px solid #E4E2DA; border-radius: 10px; padding: 16px 18px; }
        .eiken-official-title { font-weight: 800; font-size: 14px; margin-bottom: 6px; }
        .eiken-official-desc { font-size: 12.5px; color: #6B7280; line-height: 1.6; margin-bottom: 10px; }
        .eiken-official-links { display: flex; flex-direction: column; gap: 6px; }
        .eiken-official-link { font-size: 13px; color: #2F5D8A; text-decoration: underline; text-underline-offset: 2px; }
        .eiken-official-link:hover { color: #1E3F63; }

        .eiken-level-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; max-width: 720px; margin: 0 auto; }
        @media (max-width: 480px) { .eiken-level-grid { grid-template-columns: 1fr; } }
        .eiken-level-card {
          border: 2px solid var(--c); border-radius: 10px; padding: 16px; text-align: left;
          background: #fff; cursor: pointer; transition: transform 0.1s ease, box-shadow 0.15s ease;
        }
        .eiken-level-card:hover { transform: translateY(-2px); box-shadow: 0 4px 10px rgba(0,0,0,0.08); }
        .eiken-level-card .lv-label { font-size: 20px; font-weight: 800; color: var(--c); }
        .eiken-level-card .lv-sub { font-size: 12.5px; color: #6B7280; margin-top: 4px; }
        .eiken-level-card .lv-stat { font-size: 11.5px; color: #9AA093; margin-top: 8px; }

        .eiken-mode-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; max-width: 720px; margin: 0 auto; }
        @media (max-width: 480px) { .eiken-mode-grid { grid-template-columns: 1fr; } }
        .eiken-mode-card {
          border: 2px solid var(--c); border-radius: 10px; padding: 16px; text-align: left;
          background: #fff; cursor: pointer;
        }
        .eiken-mode-card:hover { opacity: 0.9; }
        .eiken-mode-card .icon { font-size: 22px; }
        .eiken-mode-card .label { font-weight: 800; color: var(--c); margin-top: 6px; }
        .eiken-mode-card .desc { font-size: 12px; color: #6B7280; margin-top: 2px; }
        .eiken-mode-card.wide { grid-column: 1 / -1; border-width: 3px; background: #FBFAF6; }
        /* 復習カードは最優先でやってほしいので、他のモードより目立たせる */
        .eiken-review-card { background: #FFF7ED; border-color: #F59E0B; }
        .eiken-review-card .label { color: #B45309; }
        .eiken-review-card .desc { color: #92400E; }

        .eiken-quiz, .eiken-pronounce, .eiken-progress { max-width: 720px; margin: 0 auto; background: #fff; border: 1px solid #E4E2DA; border-radius: 12px; padding: 22px; }

        .eiken-progressbar { margin-bottom: 16px; }
        .eiken-progressbar-track { height: 6px; background: #EDEBE3; border-radius: 4px; overflow: hidden; }
        .eiken-progressbar-fill { height: 100%; background: var(--c); transition: width 0.2s ease; }
        .eiken-progressbar-label { font-size: 11.5px; color: #9AA093; margin-top: 6px; text-align: right; }

        .eiken-qhead-eyebrow { font-size: 12px; color: #9AA093; font-weight: 700; margin-bottom: 6px; }
        .eiken-qhead-main { font-size: 22px; font-weight: 800; display: flex; align-items: center; gap: 8px; }
        .eiken-qhead-main.sentence { font-size: 17px; font-weight: 600; line-height: 1.6; font-family: 'Space Mono', monospace; }
        .eiken-qhead-sub { font-size: 12.5px; color: #6B7280; margin-top: 4px; }

        .eiken-speak-btn { border: none; background: #F0EFE9; border-radius: 50%; width: 32px; height: 32px; cursor: pointer; font-size: 15px; }
        .eiken-speak-btn.small { width: 26px; height: 26px; font-size: 12px; margin-left: 8px; }
        .eiken-speak-btn.tiny { width: 20px; height: 20px; font-size: 10px; margin-left: 6px; border-radius: 50%; }
        .eiken-play-btn {
          margin-top: 10px; border: 1.5px solid var(--c); color: var(--c); background: #fff;
          border-radius: 20px; padding: 8px 16px; font-weight: 700; font-size: 13px; cursor: pointer;
        }
        .eiken-hint { font-size: 11.5px; color: #9AA093; margin-top: 8px; }
        .eiken-warn { font-size: 12px; color: #8A6D2F; margin-top: 8px; }

        .eiken-passage-box { background: #FAFAF6; border-left: 3px solid var(--c); padding: 12px 14px; border-radius: 4px; }
        .eiken-passage-title-row { display: flex; justify-content: space-between; align-items: center; }
        .eiken-passage-title { font-weight: 800; }
        .eiken-passage-text { font-size: 14px; line-height: 1.8; margin-top: 8px; font-family: 'Space Mono', monospace; }

        .eiken-dialogue-box { background: #FAFAF6; border-left: 3px solid var(--c); padding: 12px 14px; border-radius: 4px; margin-top: 8px; display: flex; flex-direction: column; gap: 8px; }
        .eiken-dialogue-line { font-size: 14px; line-height: 1.6; }
        .eiken-speaker { font-weight: 800; margin-right: 8px; }
        .eiken-speaker-A { color: #2F5D8A; }
        .eiken-speaker-B { color: #8A3B2F; }
        .eiken-dialogue-blank { font-weight: 800; color: var(--c); background: #FFF3D6; padding: 2px 8px; border-radius: 4px; }
        .eiken-dialogue-text { font-family: 'Space Mono', monospace; }

        .eiken-choices { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 18px; }
        @media (max-width: 480px) { .eiken-choices { grid-template-columns: 1fr; } }
        .eiken-choice-btn {
          text-align: left; padding: 12px 14px; border: 2px solid #D8DCD3; border-radius: 8px; background: #fff;
          cursor: pointer; font-size: 14.5px; transition: border-color 0.15s ease;
        }
        .eiken-choice-btn:hover:not(:disabled) { border-color: var(--c); }
        .eiken-choice-btn.correct { border-color: #2F7A4F; background: #EAF6EE; color: #2F7A4F; font-weight: 700; }
        .eiken-choice-btn.wrong { border-color: #C8323D; background: #F8EEEA; color: #C8323D; font-weight: 700; }
        .eiken-choice-btn:disabled { cursor: default; }

        .eiken-explain { margin-top: 20px; border-top: 1px dashed #D8DCD3; padding-top: 16px; }
        .eiken-explain-title { font-weight: 800; margin-bottom: 10px; }
        .eiken-explain-list { display: flex; flex-direction: column; gap: 8px; margin-bottom: 12px; }
        .eiken-explain-item { display: flex; gap: 8px; font-size: 13.5px; line-height: 1.6; }
        .eiken-explain-mark { flex-shrink: 0; font-weight: 800; width: 16px; }
        .eiken-explain-mark.ok { color: #2F7A4F; }
        .eiken-explain-mark.ng { color: #C8323D; }

        .eiken-example-box, .eiken-note-box {
          background: #F5F6F1; border-left: 3px solid var(--c); padding: 10px 14px; border-radius: 4px; margin-bottom: 12px; font-size: 13.5px;
        }
        .eiken-example-row { display: flex; align-items: center; }
        .eiken-example-en { font-family: 'Space Mono', monospace; }
        .eiken-example-ja { color: #6B7280; margin-top: 4px; font-size: 12.5px; }
        .eiken-note-point { font-weight: 700; margin-bottom: 4px; }
        .eiken-note-ja { color: #555F52; }

        .eiken-next-row { display: flex; justify-content: flex-end; }
        .eiken-btn {
          font-weight: 700; font-size: 14.5px; border: none; border-radius: 20px; padding: 10px 22px;
          cursor: pointer; color: #fff; background: var(--c);
        }
        .eiken-btn:hover { opacity: 0.9; }
        .eiken-btn:disabled { background: #C9CDC4; cursor: not-allowed; }
        .eiken-btn-ghost {
          background: #fff; color: var(--c); border: 1.5px solid var(--c); font-weight: 700;
          border-radius: 20px; padding: 10px 22px; cursor: pointer;
        }
        .eiken-link-btn { background: none; border: none; font-size: 12.5px; text-decoration: underline; cursor: pointer; color: #6B7280; }
        .eiken-link-btn.danger { color: #C8323D; }

        .eiken-result { text-align: center; padding: 20px; }
        .eiken-result-big { font-family: 'Shippori Mincho', serif; font-size: 48px; font-weight: 800; color: var(--c); }
        .eiken-result-sub { font-size: 13px; color: #6B7280; margin-top: 6px; }
        .eiken-result-actions { display: flex; gap: 10px; justify-content: center; margin-top: 22px; flex-wrap: wrap; }

        .eiken-empty { text-align: center; padding: 40px 20px; color: #9AA093; }

        .eiken-word-grid { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; margin-bottom: 18px; }
        .eiken-word-chip {
          border: 1.5px solid #D8DCD3; border-radius: 20px; padding: 6px 14px; background: #fff; cursor: pointer; font-size: 13px;
        }
        .eiken-word-chip.active { border-color: var(--c); background: var(--c); color: #fff; font-weight: 700; }
        .eiken-vocab-controls { max-width: 720px; margin: 0 auto 12px; display: flex; flex-direction: column; gap: 8px; }
        .eiken-control-row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
        .eiken-control-label { font-size: 11.5px; font-weight: 700; color: #9AA093; width: 56px; flex-shrink: 0; }
        .eiken-unit-select { font: inherit; font-size: 16px; font-weight: 600; color: #2B2E28; background: #fff; border: 1.5px solid #D8DCD3; border-radius: 10px; padding: 8px 12px; flex: 1; min-width: 0; max-width: 280px; cursor: pointer; }
        .eiken-unit-select:focus { outline: 2px solid var(--c, #2F7A4F); outline-offset: 1px; }
        .eiken-pronounce-card { border-top: 1px dashed #D8DCD3; padding-top: 16px; }
        .eiken-pronounce-actions { display: flex; gap: 10px; margin-top: 14px; flex-wrap: wrap; align-items: center; }

        .eiken-total-card { text-align: center; background: #FAFAF6; border-radius: 10px; padding: 20px; margin-bottom: 20px; }
        .eiken-total-num { font-family: 'Shippori Mincho', serif; font-size: 40px; font-weight: 800; color: #C8323D; }
        .eiken-total-sub { font-size: 12.5px; color: #6B7280; margin-top: 6px; }
        .eiken-level-stats { display: flex; flex-direction: column; gap: 10px; }
        .eiken-level-stat-row { display: grid; grid-template-columns: 60px 1fr 110px; align-items: center; gap: 10px; }
        .eiken-level-stat-name { font-weight: 800; color: var(--c); font-size: 13px; }
        .eiken-level-stat-bar-track { height: 8px; background: #EDEBE3; border-radius: 4px; overflow: hidden; }
        .eiken-level-stat-bar-fill { height: 100%; background: var(--c); }
        .eiken-level-stat-num { font-size: 11.5px; color: #6B7280; text-align: right; }
        .eiken-footer-row { display: flex; justify-content: space-between; align-items: center; margin-top: 22px; }
      `}</style>

      <div className="eiken-top-nav">
        <button className="eiken-back-link" onClick={() => setScreen("progress")}>📊 学習記録</button>
        <div className="eiken-top-nav-right">
          <span className="eiken-version-badge">v{APP_VERSION}</span>
          {onExitApp && <button className="eiken-back-link" onClick={onExitApp}>他のアプリへ</button>}
        </div>
      </div>

      {screen === "levelSelect" && (
        <>
          <div className="eiken-title-block">
            <div className="eiken-eyebrow">EIKEN MASTER — 英検 5級〜1級 総合対策</div>
            <h1 className="eiken-serif">英検マスター</h1>
            <div className="eiken-under" />
          </div>
          <div className="eiken-level-grid">
            {LEVELS.map((lv) => {
              const stats = getLevelStats(lv.level);
              const pct = accuracyPercent(stats);
              return (
                <button key={lv.level} className="eiken-level-card" style={{ "--c": lv.color }} onClick={() => goModeSelect(lv.level)}>
                  <div className="lv-label">{lv.levelLabel}</div>
                  <div className="lv-sub">{lv.levelSub}</div>
                  <div className="lv-stat">{pct === null ? "まだ未学習" : `正答率 ${pct}%（${stats.attempted}問）`}</div>
                </button>
              );
            })}
          </div>
          <div className="eiken-official-box">
            <div className="eiken-official-title">📄 官方真题（公式の過去問）</div>
            <div className="eiken-official-desc">
              本アプリの模擬テストはすべてオリジナル問題です。著作権保護対象の実際の過去問は、日本英語検定協会の公式サイトで確認できます。
            </div>
            <div className="eiken-official-links">
              {OFFICIAL_LINKS.map((link) => (
                <a key={link.url} className="eiken-official-link" href={link.url} target="_blank" rel="noopener noreferrer">
                  {link.label}
                </a>
              ))}
            </div>
          </div>
        </>
      )}

      {screen === "modeSelect" && level && (
        <>
          <button className="eiken-back-link" style={{ marginBottom: 12 }} onClick={backToLevelSelect}>← 級を選び直す</button>
          <div className="eiken-title-block">
            <div className="eiken-eyebrow">{level.levelLabel} — {level.levelSub}</div>
            <h1 className="eiken-serif">学習モードを選ぶ</h1>
            <div className="eiken-under" />
          </div>
          <div className="eiken-mode-grid">
            {reviewCount > 0 && (
              <button
                className="eiken-mode-card wide eiken-review-card"
                style={{ "--c": level.color }}
                onClick={() => goMode("review")}
              >
                <div className="icon">🔁</div>
                <div className="label">まちがえた問題の復習（{reviewCount}問）</div>
                <div className="desc">
                  {MODES.filter((m) => reviewByMode[m.id])
                    .map((m) => `${m.label} ${reviewByMode[m.id]}`)
                    .join(" ／ ")}
                  {" ・ "}2回続けて正解すると消えます
                </div>
              </button>
            )}
            {MODES.map((m) => (
              <button
                key={m.id}
                className={`eiken-mode-card ${m.wide ? "wide" : ""}`}
                style={{ "--c": level.color }}
                onClick={() => goMode(m.id)}
              >
                <div className="icon">{m.icon}</div>
                <div className="label">{m.label}</div>
                <div className="desc">{m.desc}</div>
              </button>
            ))}
          </div>
          {reviewCount > 0 && (
            <button
              className="eiken-back-link"
              style={{ marginTop: 14 }}
              onClick={() => {
                if (window.confirm(`${level.levelLabel} の復習リスト${reviewCount}問をすべて消します。よろしいですか？`)) {
                  clearLevelReview(level.level);
                  setReviewNonce((n) => n + 1);
                }
              }}
            >
              復習リストを空にする
            </button>
          )}
        </>
      )}

      {screen === "quiz" && level && mode && (
        <>
          <button className="eiken-back-link" style={{ marginBottom: 12 }} onClick={backToModeSelect}>← モード選択にもどる</button>
          {mode === "vocab" && (
            <div className="eiken-vocab-controls">
              <div className="eiken-control-row">
                <span className="eiken-control-label">出題方向</span>
                <button
                  className={`eiken-word-chip ${vocabDirection === "en2ja" ? "active" : ""}`}
                  style={{ "--c": level.color }}
                  onClick={() => setVocabDirection("en2ja")}
                >
                  英語 → 日本語
                </button>
                <button
                  className={`eiken-word-chip ${vocabDirection === "ja2en" ? "active" : ""}`}
                  style={{ "--c": level.color }}
                  onClick={() => setVocabDirection("ja2en")}
                >
                  日本語 → 英語
                </button>
              </div>
              <VocabUnitSelect level={level} value={clampVocabUnit(level, vocabUnit)} onChange={setVocabUnit} allowAll />
            </div>
          )}
          {mode === "grammar" && grammarUnitCount(level) > 1 && (
            <div className="eiken-vocab-controls">
              <GrammarUnitSelect level={level} value={clampGrammarUnit(level, grammarUnit)} onChange={setGrammarUnit} allowAll />
            </div>
          )}
          {mode === "reading" && readingUnitCount(level) > 1 && (
            <div className="eiken-vocab-controls">
              <ReadingUnitSelect level={level} value={clampReadingUnit(level, readingUnit)} onChange={setReadingUnit} allowAll />
            </div>
          )}
          <ChoiceQuiz level={level} mode={mode} items={items} accent={level.color} onExit={backToModeSelect} />
        </>
      )}

      {screen === "test" && level && (
        <>
          <button className="eiken-back-link" style={{ marginBottom: 12 }} onClick={backToModeSelect}>← モード選択にもどる</button>
          {findTest(level.level) ? (
            <EikenTest test={findTest(level.level)} onExit={backToModeSelect} />
          ) : (
            <div className="eiken-empty">この級の模擬テストはまだ登録されていません。</div>
          )}
        </>
      )}

      {screen === "pronunciation" && level && (
        <>
          <button className="eiken-back-link" style={{ marginBottom: 12 }} onClick={backToModeSelect}>← モード選択にもどる</button>
          <PronunciationMode level={level} accent={level.color} />
        </>
      )}

      {screen === "progress" && (
        <ProgressDashboard onBack={() => setScreen(levelId ? "modeSelect" : "levelSelect")} />
      )}
    </div>
  );
}
