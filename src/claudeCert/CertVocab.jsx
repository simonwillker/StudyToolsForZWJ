/* ============================================================
   Claude 認定 頻出単語（勉強・復習・テスト。資格ごと）

   単語データは scripts/buildClaudeCertVocab.mjs が全問題から数えて作る
   src/data/claudeCert/<資格>/vocab.json。問題データと同じく import() で
   遅延読み込みする（英検だけ使う人に読ませないため）。
   コード分割したチャンクは asset-manifest.json に載るので、
   Service Worker がほかのチャンクと一緒にオフライン用に入れる。
   ============================================================ */

import React, { useEffect, useMemo, useState } from "react";
import { newStudySession } from "../studyLog";
import { DOMAINS, findDomain, loadVocab as loadCertVocab } from "./domains";
import { SpeakButton, AudioPlayer, AudioStyle, AudioUnsupported, useStopSpeechOn } from "./CertAudio";
import { isSpeechSupported } from "./speech";
import { vocabTracks } from "./audioCore";
import { recordListen } from "./listen";
import {
  recordVocabAnswer,
  recordVocabListen,
  markStudied,
  getVocabReviewIds,
  getUnmasteredIds,
  getVocabSummary,
  loadVocabStore,
  isMastered,
} from "./vocabProgress";

const UNIT_SIZE = 20;
const COLOR = "#7A5C2E";

/** どの画面（トップ・カード・テスト）でも同じ見た目になるよう、いつも一緒に描く */
const VocabStyle = () => <><AudioStyle /><style>{`
        .ccaof-v-toolbar { max-width: 720px; margin: 0 auto 10px; display: flex; justify-content: flex-end; align-items: center; }
        .ccaof-v-review-row { display: flex; gap: 8px; flex-wrap: wrap; }
        .ccaof-v-review-row .ccaof-review-btn { flex: 1 1 220px; margin: 0; }
        .ccaof-v-review-row .ccaof-review-btn:disabled { opacity: 0.45; cursor: default; }
        .ccaof-v-unmastered { border-color: ${COLOR} !important; color: ${COLOR} !important; }
        .ccaof-v-hint { font-size: 11.5px; color: #9AA093; margin-top: 6px; }
        .ccaof-v-chips { display: flex; flex-wrap: wrap; gap: 6px; }
        .ccaof-v-chip { border: 1px solid #D8D5CB; background: #fff; border-radius: 999px; padding: 5px 12px; font-size: 12.5px; cursor: pointer; color: var(--c, #4B5563); font-weight: 700; }
        .ccaof-v-chip.active { background: var(--c, ${COLOR}); border-color: var(--c, ${COLOR}); color: #fff; }
        .ccaof-v-selected { border: 2px solid var(--c) !important; color: var(--c); font-weight: 800; }
        .ccaof-v-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 16px; }
        @media (max-width: 560px) { .ccaof-v-actions { grid-template-columns: 1fr; } }
        .ccaof-v-action { background: #fff; border: 2px solid ${COLOR}; border-radius: 10px; padding: 14px 16px; }
        .ccaof-v-action-title { font-size: 15px; font-weight: 800; color: ${COLOR}; }
        .ccaof-v-action-desc { font-size: 12.5px; color: #6B7280; line-height: 1.7; margin: 6px 0 10px; }
        .ccaof-v-table { background: #fff; border: 1px solid #E4E2DA; border-radius: 10px; padding: 4px 12px; }
        .ccaof-v-row { display: flex; gap: 10px; align-items: baseline; padding: 7px 0; border-top: 1px solid #F0EEE7; font-size: 13px; }
        .ccaof-v-row:first-child { border-top: none; }
        .ccaof-v-row-word { font-weight: 800; min-width: 110px; }
        .ccaof-v-row-ja { flex: 1; color: #4B5563; }
        .ccaof-v-row-n { color: #9AA093; font-size: 11.5px; white-space: nowrap; }
        .ccaof-v-row-st { width: 18px; text-align: center; }
        @media (max-width: 480px) { .ccaof-v-row-word { min-width: 88px; } }

        .ccaof-v-card { background: #fff; border: 2px solid ${COLOR}; border-radius: 12px; padding: 22px 18px; text-align: center; cursor: pointer; min-height: 180px; }
        .ccaof-v-card.open { cursor: default; text-align: left; }
        .ccaof-v-card.open .ccaof-v-word, .ccaof-v-card.open .ccaof-v-pos { text-align: center; }
        .ccaof-v-word { font-size: 30px; font-weight: 800; display: flex; justify-content: center; align-items: center; gap: 8px; flex-wrap: wrap; word-break: break-word; }
        .ccaof-v-pos { font-size: 12px; color: #9AA093; margin-top: 4px; }
        .ccaof-v-tap { font-size: 13px; color: #9AA093; margin-top: 30px; }
        .ccaof-v-actions .ccaof-audio-card { grid-column: 1 / -1; }
        .ccaof-v-qhead { background: #fff; border: 1px solid #E4E2DA; border-radius: 10px; padding: 16px; text-align: center; margin-bottom: 12px; }
        .ccaof-v-qeyebrow { font-size: 11.5px; color: #9AA093; font-weight: 700; margin-bottom: 4px; }
        .ccaof-v-detail { margin-top: 14px; text-align: left; }
        .ccaof-v-meaning { font-size: 18px; font-weight: 800; color: ${COLOR}; text-align: center; }
        .ccaof-v-meaning-zh { font-size: 14px; color: #6B7280; text-align: center; margin-top: 2px; }
        .ccaof-v-example { background: #FBFAF6; border-left: 3px solid #D8D5CB; padding: 10px 12px; margin-top: 10px; }
        .ccaof-v-example-en { font-size: 13.5px; line-height: 1.7; }
        .ccaof-v-example-zh { font-size: 12.5px; color: #6B7280; line-height: 1.7; margin-top: 4px; }
        .ccaof-v-example-src { font-size: 10.5px; color: #9AA093; margin-top: 4px; }
        .ccaof-v-hl { color: ${COLOR}; }
        .ccaof-v-where { font-size: 11.5px; color: #6B7280; margin-top: 10px; line-height: 2; }
        .ccaof-v-dchip { display: inline-block; border: 1px solid var(--c); color: var(--c); border-radius: 999px; padding: 0 8px; margin-left: 4px; font-weight: 700; }
        .ccaof-v-answer { font-size: 14px; margin-top: 12px; text-align: center; }
        .ccaof-v-wronglist { text-align: left; background: #fff; border: 1px solid #E4E2DA; border-radius: 10px; padding: 10px 14px; margin: 0 0 20px; font-size: 13px; line-height: 1.9; }
`}</style></>;

/* キャッシュは domains.js が資格ごとに持つ */
function loadVocab() {
  return loadCertVocab().then((data) => data.words || []);
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** 「出力、生成結果」→ ["出力", "生成結果"]。意味の一部が重なる語は誤答に使わない */
function meaningParts(ja) {
  return ja
    .replace(/（[^）]*）/g, "")
    .split(/[、；]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function overlaps(a, b) {
  const pa = meaningParts(a.ja);
  const pb = meaningParts(b.ja);
  return pa.some((x) => pb.includes(x));
}

/** 4択の誤答を3つ。同じ品詞を優先し、意味が重なる語は避ける */
function pickDistractors(word, pool) {
  const ok = pool.filter((x) => x.id !== word.id && !overlaps(x, word));
  const same = shuffle(ok.filter((x) => x.pos === word.pos));
  const other = shuffle(ok.filter((x) => x.pos !== word.pos));
  return [...same, ...other].slice(0, 3);
}

function buildTest(words, pool, direction) {
  return shuffle(words).map((w) => ({
    word: w,
    direction,
    choices: shuffle([{ w, correct: true }, ...pickDistractors(w, pool).map((x) => ({ w: x, correct: false }))]),
  }));
}

/** 例文の中のその単語（活用形も）を太字にする */
function Highlight({ text, forms }) {
  const parts = useMemo(() => {
    if (!forms || !forms.length) return [text];
    const re = new RegExp(`(?<![A-Za-z])(${forms.join("|")})(?![A-Za-z])`, "gi");
    return text.split(re);
  }, [text, forms]);
  const set = new Set((forms || []).map((f) => f.toLowerCase()));
  return (
    <>
      {parts.map((p, i) => (set.has(p.toLowerCase()) ? <strong key={i} className="ccaof-v-hl">{p}</strong> : <React.Fragment key={i}>{p}</React.Fragment>))}
    </>
  );
}

/** 単語の詳しい説明。カードの裏面とテストの解答後で共通 */
function WordDetail({ w, showZh }) {
  return (
    <div className="ccaof-v-detail">
      <div className="ccaof-v-meaning">{w.ja}<SpeakButton text={w.ja} lang="ja" label="意味を読み上げる" /></div>
      {showZh && <div className="ccaof-v-meaning-zh">{w.zh}<SpeakButton text={w.zh} lang="zh" label="中文を読み上げる" /></div>}
      {w.examples.map((ex) => (
        <div className="ccaof-v-example" key={ex.itemId}>
          <div className="ccaof-v-example-en">
            <Highlight text={ex.en} forms={w.forms} />
            <SpeakButton text={ex.en} label="例文を読み上げる" />
          </div>
          {showZh && <div className="ccaof-v-example-zh">{ex.zh}<SpeakButton text={ex.zh} lang="zh" label="中文を読み上げる" /></div>}
          <div className="ccaof-v-example-src">問題 {ex.itemId} より</div>
        </div>
      ))}
      <div className="ccaof-v-where">
        出てくる問題 {w.questionCount}問（{w.count}回）：
        {Object.entries(w.domains).map(([d, n]) => (
          <span key={d} className="ccaof-v-dchip" style={{ "--c": findDomain(d).color }}>{d} {n}問</span>
        ))}
      </div>
    </div>
  );
}

/* ---------- 勉強（単語カード） ---------- */

function StudyCards({ words, showZh, onExit }) {
  const [index, setIndex] = useState(0);
  const [open, setOpen] = useState(false);
  const [marks, setMarks] = useState({});
  const w = words[index];
  const done = index >= words.length;
  useStopSpeechOn(index);

  const mark = (known) => {
    markStudied(w.id, known);
    setMarks((m) => ({ ...m, [w.id]: known }));
    setOpen(false);
    setIndex(index + 1);
  };

  if (done) {
    const notYet = words.filter((x) => marks[x.id] === false);
    return (
      <div className="ccaof-result">
        <div className="ccaof-result-pct" style={{ "--c": COLOR }}>{words.length}語</div>
        <div className="ccaof-result-sub">
          覚えた {Object.values(marks).filter(Boolean).length}語 ／ まだ {notYet.length}語
        </div>
        <div className="ccaof-result-note">
          「まだ」にした単語は復習リストに入りました。テストで2回続けて正解すると外れます。
        </div>
        {notYet.length > 0 && (
          <div className="ccaof-v-wronglist">
            {notYet.map((x) => <div key={x.id}><b>{x.word}</b> … {x.ja}</div>)}
          </div>
        )}
        <button className="ccaof-btn" style={{ "--c": COLOR }} onClick={onExit}>頻出単語にもどる</button>
      </div>
    );
  }

  return (
    <div className="ccaof-quiz">
      <div className="ccaof-quiz-head">
        <span>{index + 1} / {words.length} 語</span>
        <span className="ccaof-quiz-domain" style={{ "--c": COLOR }}>📖 勉強</span>
      </div>
      <div className={"ccaof-v-card" + (open ? " open" : "")} onClick={() => setOpen(true)}>
        <div className="ccaof-v-word">
          {w.word}
          <SpeakButton text={w.word} big label="発音を聞く" />
        </div>
        <div className="ccaof-v-pos">{w.pos} ・ {w.questionCount}問に出る</div>
        {open ? <WordDetail w={w} showZh={showZh} /> : <div className="ccaof-v-tap">タップして意味と例文を見る</div>}
      </div>
      <div className="ccaof-quiz-foot">
        <button className="ccaof-btn-ghost" onClick={() => { setOpen(false); setIndex(Math.max(0, index - 1)); }} disabled={index === 0}>← 前</button>
        {open ? (
          <span style={{ display: "flex", gap: 8 }}>
            <button className="ccaof-btn" style={{ "--c": "#C8323D" }} onClick={() => mark(false)}>まだ</button>
            <button className="ccaof-btn" style={{ "--c": "#1F6B45" }} onClick={() => mark(true)}>覚えた</button>
          </span>
        ) : (
          <button className="ccaof-btn" style={{ "--c": COLOR }} onClick={() => setOpen(true)}>意味を見る</button>
        )}
      </div>
      <div style={{ textAlign: "center", marginTop: 14 }}>
        <button className="ccaof-back-link" onClick={onExit}>やめる</button>
      </div>
    </div>
  );
}

/* ---------- テスト・復習（4択） ---------- */

function VocabQuiz({ questions, label, showZh, onExit }) {
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState(null);
  const [results, setResults] = useState([]);

  useEffect(() => {
    newStudySession();
  }, [questions]);

  const q = questions[index];
  const done = index >= questions.length;
  useStopSpeechOn(index);

  const pick = (i) => {
    if (picked !== null) return;
    const ok = q.choices[i].correct;
    setPicked(i);
    setResults((r) => [...r, { word: q.word, ok }]);
    recordVocabAnswer(q.word.id, ok, label);
  };

  const next = () => {
    setPicked(null);
    setIndex(index + 1);
  };

  if (!questions.length) {
    return (
      <div className="ccaof-empty">
        出題できる単語がありません。
        <div style={{ marginTop: 10 }}><button className="ccaof-btn-ghost" onClick={onExit}>もどる</button></div>
      </div>
    );
  }

  if (done) {
    const score = results.filter((r) => r.ok).length;
    const wrong = results.filter((r) => !r.ok);
    return (
      <div className="ccaof-result">
        <div className="ccaof-result-pct" style={{ "--c": COLOR }}>{Math.round((score / questions.length) * 100)}%</div>
        <div className="ccaof-result-sub">{questions.length}問中 {score}問 正解</div>
        <div className="ccaof-result-note">
          まちがえた単語は復習リストに入りました。2回続けて正解すると外れます。
        </div>
        {wrong.length > 0 && (
          <div className="ccaof-v-wronglist">
            {wrong.map((r) => <div key={r.word.id}><b>{r.word.word}</b> … {r.word.ja}</div>)}
          </div>
        )}
        <button className="ccaof-btn" style={{ "--c": COLOR }} onClick={onExit}>頻出単語にもどる</button>
      </div>
    );
  }

  const en2ja = q.direction === "en2ja";
  return (
    <div className="ccaof-quiz">
      <div className="ccaof-quiz-head">
        <span>{index + 1} / {questions.length} 問</span>
        <span className="ccaof-quiz-domain" style={{ "--c": COLOR }}>{label}</span>
      </div>
      <div className="ccaof-v-qhead">
        <div className="ccaof-v-qeyebrow">{en2ja ? "この単語の意味は？" : "この意味を表す単語は？"}</div>
        <div className="ccaof-v-word">
          {en2ja ? q.word.word : q.word.ja}
          {en2ja ? <SpeakButton text={q.word.word} big label="発音を聞く" /> : <SpeakButton text={q.word.ja} lang="ja" big label="意味を読み上げる" />}
        </div>
        {!en2ja && showZh && <div className="ccaof-v-meaning-zh">{q.word.zh}<SpeakButton text={q.word.zh} lang="zh" label="中文を読み上げる" /></div>}
        <div className="ccaof-v-pos">{q.word.pos}</div>
      </div>
      <div className="ccaof-choices">
        {q.choices.map((c, i) => {
          let cls = "ccaof-choice";
          if (picked !== null) {
            if (c.correct) cls += " correct";
            else if (picked === i) cls += " wrong";
          }
          return (
            <button key={c.w.id} className={cls} onClick={() => pick(i)} disabled={picked !== null}>
              <div className="ccaof-choice-text">{en2ja ? c.w.ja : c.w.word}</div>
              {en2ja && showZh && <div className="ccaof-choice-zh">{c.w.zh}</div>}
              {picked !== null && !c.correct && (
                <div className="ccaof-choice-explain">
                  {en2ja ? `「${c.w.ja}」は ${c.w.word} の意味。` : `${c.w.word} は「${c.w.ja}」。`}
                </div>
              )}
            </button>
          );
        })}
      </div>
      {picked !== null && (
        <>
          <div className="ccaof-v-answer">正解：<b>{q.word.word}</b> = {q.word.ja}</div>
          <WordDetail w={q.word} showZh={showZh} />
        </>
      )}
      <div className="ccaof-quiz-foot">
        <button className="ccaof-btn-ghost" onClick={onExit}>やめる</button>
        <button className="ccaof-btn" style={{ "--c": COLOR }} onClick={next} disabled={picked === null}>
          {index + 1 >= questions.length ? "結果を見る" : "次の問題"}
        </button>
      </div>
    </div>
  );
}

/* ---------- 頻出単語のトップ ---------- */

export default function CertVocab({ showZh, onToggleZh, onExit }) {
  const [all, setAll] = useState(null);
  const [loadError, setLoadError] = useState(false);
  const [nonce, setNonce] = useState(0);
  const [domainFilter, setDomainFilter] = useState("all");
  const [unit, setUnit] = useState(0);
  const [direction, setDirection] = useState("en2ja");
  const [run, setRun] = useState(null); // { kind: "study"|"quiz"|"audio", words|questions|tracks, label }
  const [, setStatsNonce] = useState(0);

  useEffect(() => {
    if (all) return undefined;
    let alive = true;
    setLoadError(false);
    loadVocab()
      .then((w) => alive && setAll(w))
      .catch(() => alive && setLoadError(true));
    return () => {
      alive = false;
    };
  }, [all, nonce]);

  const list = useMemo(
    () => (all ? (domainFilter === "all" ? all : all.filter((w) => w.domains[domainFilter])) : []),
    [all, domainFilter]
  );
  const units = Math.max(1, Math.ceil(list.length / UNIT_SIZE));
  const safeUnit = unit === "all" || unit < units ? unit : 0;
  const unitWords = safeUnit === "all" ? list : list.slice(safeUnit * UNIT_SIZE, safeUnit * UNIT_SIZE + UNIT_SIZE);

  const exitRun = () => {
    setRun(null);
    setStatsNonce((n) => n + 1);
  };

  const zhToggle = (
    <button className="ccaof-zh-toggle" onClick={onToggleZh}>中文訳 {showZh ? "ON" : "OFF"}</button>
  );

  if (run && run.kind === "audio") {
    return (
      <>
        <VocabStyle />
        <AudioPlayer
          title={run.label}
          color={COLOR}
          tracks={run.tracks}
          defaultZh={showZh}
          onTrackDone={(t) => {
            if (!t.record) return;
            recordVocabListen(t.record.id);
            recordListen("word", t.record.id);
          }}
          recordNote="最後まで聞いた単語は「学習した単語」に入ります（習熟・正答率は変わりません）。覚えたかどうかはテストで確かめてください。"
          onExit={exitRun}
          exitLabel="頻出単語にもどる"
        />
      </>
    );
  }

  if (run) {
    return (
      <>
        <VocabStyle />
        <div className="ccaof-v-toolbar">{zhToggle}</div>
        {run.kind === "study" ? (
          <StudyCards words={run.words} showZh={showZh} onExit={exitRun} />
        ) : (
          <VocabQuiz questions={run.questions} label={run.label} showZh={showZh} onExit={exitRun} />
        )}
      </>
    );
  }

  if (!all) {
    return (
      <div className="ccaof-inner">
        <VocabStyle />
        <button className="ccaof-back-link" onClick={onExit}>← もどる</button>
        {loadError ? (
          <div className="ccaof-empty">
            単語を読み込めませんでした。通信を確認して、もう一度ためしてください。
            <div style={{ marginTop: 10 }}><button className="ccaof-btn-ghost" onClick={() => setNonce((n) => n + 1)}>もう一度</button></div>
          </div>
        ) : (
          <div className="ccaof-loading"><div className="ccaof-spinner" /><div className="ccaof-loading-text">単語を読み込んでいます…</div></div>
        )}
      </div>
    );
  }

  const byId = new Map(all.map((w) => [w.id, w]));
  const summary = getVocabSummary();
  const store = loadVocabStore();
  const reviewWords = getVocabReviewIds().map((id) => byId.get(id)).filter(Boolean);
  const unmastered = getUnmasteredIds().map((id) => byId.get(id)).filter(Boolean);
  const masteredInUnit = unitWords.filter((w) => isMastered(store.words[w.id])).length;
  const unitLabel = safeUnit === "all" ? `すべて（${list.length}語）` : `${safeUnit + 1}組`;
  const filterLabel = domainFilter === "all" ? "" : `${domainFilter} `;

  const startStudy = () => setRun({ kind: "study", words: unitWords });
  const startTest = () =>
    setRun({
      kind: "quiz",
      label: "頻出単語 テスト",
      // 「すべて」でも1回は20問まで（英検の単語テストと同じ1回の量）
      questions: buildTest(shuffle(unitWords).slice(0, UNIT_SIZE), all, direction),
    });
  const startAudio = (words, label) => setRun({ kind: "audio", label, tracks: vocabTracks(words) });
  const startReview = (words) =>
    setRun({ kind: "quiz", label: "頻出単語 復習", questions: buildTest(words.slice(0, UNIT_SIZE), all, direction) });

  return (
    <div className="ccaof-inner">
      <VocabStyle />
      <div className="ccaof-v-toolbar" style={{ justifyContent: "space-between" }}>
        <button className="ccaof-back-link" onClick={onExit}>← ドメイン選択にもどる</button>
        {zhToggle}
      </div>
      <div className="ccaof-title-block">
        <div className="ccaof-eyebrow">FREQUENT WORDS</div>
        <h1 className="ccaof-serif">頻出単語</h1>
        <div className="ccaof-under" />
        <div className="ccaof-lead">
          全問題の設問・選択肢・解説から、4問以上に出てくる単語 {all.length}語を
          出てくる問題が多い順に並べました。例文はすべて実際の問題から取っています。
        </div>
      </div>

      <div className="ccaof-exam-facts">
        <div className="ccaof-fact"><div className="ccaof-fact-num">{all.length}</div><div className="ccaof-fact-label">収録語</div></div>
        <div className="ccaof-fact"><div className="ccaof-fact-num">{summary.mastered}</div><div className="ccaof-fact-label">習熟（2回連続正解）</div></div>
        <div className="ccaof-fact"><div className="ccaof-fact-num">{summary.reviewCount}</div><div className="ccaof-fact-label">復習待ち</div></div>
        <div className="ccaof-fact"><div className="ccaof-fact-num">{summary.attempted ? `${Math.round((summary.correct / summary.attempted) * 100)}%` : "—"}</div><div className="ccaof-fact-label">テスト正答率</div></div>
      </div>

      <div className="ccaof-sub-head">🔁 復習</div>
      <div className="ccaof-v-review-row">
        <button className="ccaof-review-btn" onClick={() => startReview(reviewWords)} disabled={!reviewWords.length}>
          まちがえた単語（{reviewWords.length}語）
        </button>
        <button className="ccaof-review-btn ccaof-v-unmastered" onClick={() => startReview(shuffle(unmastered))} disabled={!unmastered.length}>
          まだ習熟していない単語（{unmastered.length}語）
        </button>
      </div>
      <div className="ccaof-v-hint">1回20語まで。まちがえた単語は間違いの多い順に出ます。</div>

      <div className="ccaof-sub-head">しぼりこみ（その分野の問題に出てくる単語）</div>
      <div className="ccaof-v-chips">
        <button className={"ccaof-v-chip" + (domainFilter === "all" ? " active" : "")} onClick={() => { setDomainFilter("all"); setUnit(0); }}>すべて</button>
        {DOMAINS.map((d) => (
          <button key={d.id} className={"ccaof-v-chip" + (domainFilter === d.id ? " active" : "")} style={{ "--c": d.color }} onClick={() => { setDomainFilter(d.id); setUnit(0); }} title={d.label}>
            {d.id}
          </button>
        ))}
      </div>

      <div className="ccaof-sub-head">出題範囲（{filterLabel}{list.length}語・20語ずつ）</div>
      <div className="ccaof-unit-grid">
        {Array.from({ length: units }, (_, u) => (
          <button key={u} className={"ccaof-unit-btn" + (safeUnit === u ? " ccaof-v-selected" : "")} style={{ "--c": COLOR }} onClick={() => setUnit(u)}>
            {u + 1}組（{u * UNIT_SIZE + 1}〜{Math.min((u + 1) * UNIT_SIZE, list.length)}）
          </button>
        ))}
        {list.length > UNIT_SIZE && (
          <button className={"ccaof-unit-btn" + (safeUnit === "all" ? " ccaof-v-selected" : "")} style={{ "--c": COLOR }} onClick={() => setUnit("all")}>
            すべて（{list.length}語）
          </button>
        )}
      </div>

      <div className="ccaof-v-actions">
        <div className="ccaof-v-action">
          <div className="ccaof-v-action-title">📖 勉強する</div>
          <div className="ccaof-v-action-desc">{filterLabel}{unitLabel}の{unitWords.length}語を単語カードで。意味・中国語・問題からの例文を見て「覚えた／まだ」を付けます（習熟 {masteredInUnit}/{unitWords.length}）。</div>
          <button className="ccaof-btn" style={{ "--c": COLOR }} onClick={startStudy} disabled={!unitWords.length}>カードを始める</button>
        </div>
        <div className="ccaof-v-action">
          <div className="ccaof-v-action-title">✏️ テスト</div>
          <div className="ccaof-v-action-desc">4択で{Math.min(UNIT_SIZE, unitWords.length)}問。英検の単語テストと同じく、出題の向きを選べます。</div>
          <div className="ccaof-v-chips" style={{ marginBottom: 10 }}>
            <button className={"ccaof-v-chip" + (direction === "en2ja" ? " active" : "")} onClick={() => setDirection("en2ja")}>英語 → 意味</button>
            <button className={"ccaof-v-chip" + (direction === "ja2en" ? " active" : "")} onClick={() => setDirection("ja2en")}>意味 → 英語</button>
          </div>
          <button className="ccaof-btn" style={{ "--c": COLOR }} onClick={startTest} disabled={!unitWords.length}>テストを始める</button>
        </div>
        <div className="ccaof-audio-card">
          <div className="ccaof-audio-card-title">🎧 音声で聞く（ハンズフリー）</div>
          <div className="ccaof-audio-card-desc">
            読みたくないときは耳で。単語 → 間 → 意味 → 例文 → 単語 の順に自動で読み進めます。
            一時停止・前へ／次へ・速度（0.75〜1.25倍）・読む言語（英語／日本語／中文）を切り替えられます。
          </div>
          {isSpeechSupported() ? (
            <div className="ccaof-audio-row">
              <button className="ccaof-btn" style={{ "--c": "#5B4B8A" }} onClick={() => startAudio(unitWords, `頻出単語 ${filterLabel}${unitLabel}`)} disabled={!unitWords.length}>
                この範囲を聞く（{unitWords.length}語）
              </button>
              {reviewWords.length > 0 && (
                <button className="ccaof-btn-ghost" onClick={() => startAudio(reviewWords, "まちがえた単語")}>
                  まちがえた単語を聞く（{reviewWords.length}語）
                </button>
              )}
            </div>
          ) : (
            <AudioUnsupported />
          )}
        </div>
      </div>

      <div className="ccaof-sub-head">この範囲の単語</div>
      <div className="ccaof-v-table">
        {unitWords.map((w) => {
          const st = store.words[w.id];
          const inReview = !!store.review[w.id];
          return (
            <div className="ccaof-v-row" key={w.id}>
              <span className="ccaof-v-row-word">{w.word}<SpeakButton text={w.word} label="発音を聞く" /></span>
              <span className="ccaof-v-row-ja">{w.ja}{showZh ? ` ／ ${w.zh}` : ""}</span>
              <span className="ccaof-v-row-n">{w.questionCount}問</span>
              <span className="ccaof-v-row-st">{isMastered(st) ? "✅" : inReview ? "🔁" : st ? "・" : ""}</span>
            </div>
          );
        })}
      </div>
      <div className="ccaof-v-hint">✅ 習熟　🔁 復習待ち　・ 学習中</div>

    </div>
  );
}
