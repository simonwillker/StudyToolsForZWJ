import React, { useMemo, useRef, useState, useEffect } from "react";
import { newStudySession } from "./studyLog";
import { recordAnswer } from "./eikenProgress";
import { recordReviewResult, getReviewItemIds } from "./eikenReview";
import { formatDateTime } from "./eikenTestResults";
import { isSpeechSynthesisSupported, speak, stopSpeaking } from "./eikenSpeech";
import {
  UNIT_SIZE,
  QUESTION_COUNTS,
  FORMATS,
  formatLabel,
  unitCount,
  wordsInRange,
  rangeLabel,
  buildVocabTest,
  gradeVocabTest,
  answerText,
  blankExample,
  spellingHint,
  saveVocabTestResult,
  getVocabTestResults,
  getVocabTestTrend,
} from "./eikenVocabTest";

/* ============================================================
   単語テスト（3級・準2級・2級）
   条件をえらぶ → 回答（正解は見せない）→ まとめて採点 → 結果
   ロジックと保存は eikenVocabTest.js。
   ============================================================ */

function SpeakBtn({ text, small, label = "発音を聞く" }) {
  if (!isSpeechSynthesisSupported()) return null;
  return (
    <button className={`eiken-speak-btn${small ? " small" : ""}`} onClick={() => speak(text)} aria-label={label}>
      🔊
    </button>
  );
}

function Chip({ active, disabled, onClick, children, color }) {
  return (
    <button
      className={`eiken-word-chip ${active ? "active" : ""}`}
      style={{ "--c": color }}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

function formatElapsed(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m ? `${m}分${s}秒` : `${s}秒`;
}

/** 級ごとの得点推移（古い→新しい、直近20回）。1系列なので凡例は出さず、見出しで名前を示す */
export function VocabTestTrend({ level, color }) {
  const trend = useMemo(() => getVocabTestTrend(level, 20), [level]);
  const [hover, setHover] = useState(null);
  if (!trend.length) return <div className="eiken-empty-note">まだテストを受けていません。</div>;
  const last = trend[trend.length - 1];
  const shown = hover != null ? trend[hover] : last;
  return (
    <div className="eiken-vt-trend" style={{ "--c": color }}>
      <div className="eiken-vt-chart" role="img" aria-label={`得点推移：直近${trend.length}回、最新 ${last.percent}%`}>
        <div className="eiken-vt-grid" style={{ bottom: "50%" }} />
        <div className="eiken-vt-grid" style={{ bottom: "100%" }} />
        {trend.map((r, i) => (
          <div
            key={r.at}
            className={`eiken-vt-col${hover === i ? " hover" : ""}`}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
            onClick={() => setHover(hover === i ? null : i)}
            title={`${formatDateTime(r.at)}　${r.correct}/${r.total}（${r.percent}%）`}
          >
            <div className="eiken-vt-bar" style={{ height: `${Math.max(r.percent, 2)}%` }} />
          </div>
        ))}
        <div className="eiken-vt-axis">
          <span>100</span>
          <span>50</span>
          <span>0</span>
        </div>
      </div>
      <div className="eiken-vt-caption">
        {hover != null ? "" : "最新："}
        {formatDateTime(shown.at)}　{rangeLabel(shown.range)}・{formatLabel(shown.format)}
        <b>
          {shown.correct}/{shown.total}（{shown.percent}%）
        </b>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------
   条件をえらぶ
   ------------------------------------------------------------ */

function Setup({ level, settings, setSettings, weakIds, onStart }) {
  const vocab = level.vocab;
  const units = unitCount(vocab);
  const { rangeType, from, to, count, format } = settings;
  const range = rangeType === "units" ? { type: "units", from, to } : { type: rangeType };
  const words = wordsInRange(vocab, range, weakIds);
  const n = count === "all" ? words.length : Math.min(count, words.length);
  const set = (patch) => setSettings((s) => ({ ...s, ...patch }));
  const history = useMemo(() => getVocabTestResults(level.level).slice(0, 5), [level]);

  return (
    <div className="eiken-quiz" style={{ "--c": level.color }}>
      <div className="eiken-qhead-eyebrow">{level.levelLabel} 単語テスト</div>
      <div className="eiken-vt-lead">
        範囲と問題数をえらんで受けるテストです。答えている間は正解を出さず、最後にまとめて採点します。
        まちがえた単語は「まちがえた問題の復習」に入ります。
      </div>

      <div className="eiken-vocab-controls" style={{ margin: "14px 0" }}>
        <div className="eiken-control-row">
          <span className="eiken-control-label">範囲</span>
          <Chip color={level.color} active={rangeType === "units"} onClick={() => set({ rangeType: "units" })}>
            組をえらぶ
          </Chip>
          <Chip color={level.color} active={rangeType === "all"} onClick={() => set({ rangeType: "all" })}>
            すべて（{vocab.length}語）
          </Chip>
          <Chip
            color={level.color}
            active={rangeType === "weak"}
            disabled={weakIds.size === 0}
            onClick={() => set({ rangeType: "weak" })}
          >
            苦手な単語（{wordsInRange(vocab, { type: "weak" }, weakIds).length}語）
          </Chip>
        </div>
        {rangeType === "units" && (
          <div className="eiken-control-row">
            <span className="eiken-control-label" />
            <select
              className="eiken-unit-select eiken-vt-unit"
              value={from}
              onChange={(e) => {
                const f = Number(e.target.value);
                set({ from: f, to: Math.max(f, to) });
              }}
              aria-label="はじめの組"
            >
              {Array.from({ length: units }, (_, u) => (
                <option key={u} value={u}>
                  {u + 1}組
                </option>
              ))}
            </select>
            <span className="eiken-vt-tilde">〜</span>
            <select
              className="eiken-unit-select eiken-vt-unit"
              value={to}
              onChange={(e) => {
                const t = Number(e.target.value);
                set({ to: t, from: Math.min(from, t) });
              }}
              aria-label="おわりの組"
            >
              {Array.from({ length: units }, (_, u) => (
                <option key={u} value={u}>
                  {u + 1}組
                </option>
              ))}
            </select>
          </div>
        )}
        {rangeType === "weak" && (
          <div className="eiken-hint" style={{ marginTop: 0 }}>
            「単語・熟語」やこのテストでまちがえて、まだ克服していない単語（2回続けて正解で外れます）
          </div>
        )}
        <div className="eiken-control-row">
          <span className="eiken-control-label">問題数</span>
          {QUESTION_COUNTS.map((c) => (
            <Chip key={c} color={level.color} active={count === c} onClick={() => set({ count: c })}>
              {c}問
            </Chip>
          ))}
          <Chip color={level.color} active={count === "all"} onClick={() => set({ count: "all" })}>
            範囲すべて
          </Chip>
        </div>
        <div className="eiken-control-row">
          <span className="eiken-control-label">出題形式</span>
          {FORMATS.map((f) => (
            <Chip key={f.id} color={level.color} active={format === f.id} onClick={() => set({ format: f.id })}>
              {f.label}
            </Chip>
          ))}
        </div>
      </div>

      <div className="eiken-vt-summary">
        範囲 {words.length}語
        {rangeType === "units" && `（${from * UNIT_SIZE + 1}〜${Math.min((to + 1) * UNIT_SIZE, vocab.length)}番目）`}から <b>{n}問</b>
        {count !== "all" && count > words.length && words.length > 0 && <>（範囲が{words.length}語なので{n}問になります）</>}
      </div>
      <div className="eiken-next-row" style={{ justifyContent: "center", marginTop: 12 }}>
        <button className="eiken-btn" disabled={n === 0} onClick={() => onStart(range, words)}>
          テストを始める
        </button>
      </div>

      <div className="eiken-sub-head">{level.levelLabel} の得点推移（直近20回）</div>
      <VocabTestTrend level={level.level} color={level.color} />
      {history.length > 0 && (
        <div className="eiken-vt-history">
          {history.map((r) => (
            <div className="eiken-vt-history-row" key={r.at}>
              <span>{formatDateTime(r.at)}</span>
              <span>
                {rangeLabel(r.range)}・{formatLabel(r.format)}
              </span>
              <b>
                {r.correct}/{r.total}（{r.percent}%）
              </b>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------
   回答中：正解は見せない。前後に移動して答えを直せる
   ------------------------------------------------------------ */

function Question({ q, word, answer, onAnswer, onEnter }) {
  const inputRef = useRef(null);
  useEffect(() => {
    if (q.kind === "spell" && inputRef.current) inputRef.current.focus();
  }, [q]);

  if (q.kind === "spell") {
    const blanked = blankExample(word.word, word.example && word.example.en);
    return (
      <>
        <div className="eiken-qhead">
          <div className="eiken-qhead-eyebrow">この意味を表す英語を書きましょう</div>
          <div className="eiken-qhead-main">
            <span>{word.meaning}</span>
          </div>
          <div className="eiken-qhead-sub">
            {word.pos}　ヒント：<span className="eiken-vt-hint">{spellingHint(word.word)}</span>（{word.word.replace(/ /g, "").length}文字）
          </div>
        </div>
        {(blanked || (word.example && word.example.ja)) && (
          <div className="eiken-example-box" style={{ marginTop: 12 }}>
            {blanked && <div className="eiken-example-en">{blanked}</div>}
            {word.example && word.example.ja && <div className="eiken-example-ja">{word.example.ja}</div>}
          </div>
        )}
        <input
          ref={inputRef}
          className="eiken-vt-input"
          type="text"
          value={answer ?? ""}
          onChange={(e) => onAnswer(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) onEnter();
          }}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          lang="en"
          placeholder="ここに英語を入力"
          aria-label="英語のスペル"
        />
      </>
    );
  }

  return (
    <>
      <div className="eiken-qhead">
        <div className="eiken-qhead-eyebrow">{q.kind === "en2ja" ? "この単語の意味は？" : "この意味を表す単語は？"}</div>
        <div className="eiken-qhead-main">
          <span>{q.kind === "en2ja" ? word.word : word.meaning}</span>
          {/* 英→日 は英単語を聞いても答えがわからないので🔊を出す。日→英 は答えになるので出さない */}
          {q.kind === "en2ja" && <SpeakBtn text={word.word} />}
        </div>
        <div className="eiken-qhead-sub">
          {word.pos}
          {q.kind === "en2ja" && word.phonetic ? ` ／ [${word.phonetic}]` : ""}
        </div>
      </div>
      <div className="eiken-choices">
        {q.choices.map((c, ci) => (
          <button
            key={ci}
            className={`eiken-choice-btn${answer === ci ? " selected" : ""}`}
            onClick={() => onAnswer(ci)}
            aria-pressed={answer === ci}
          >
            {c.text}
          </button>
        ))}
      </div>
    </>
  );
}

function Run({ level, test, onSubmit }) {
  const [idx, setIdx] = useState(0);
  const [answers, setAnswers] = useState(() => test.questions.map(() => null));
  const total = test.questions.length;
  const q = test.questions[idx];
  const word = test.byId.get(q.wordId);
  const answeredCount = answers.filter((a) => a != null && a !== "").length;

  const setAnswer = (v) => setAnswers((a) => a.map((x, i) => (i === idx ? v : x)));
  const go = (i) => {
    stopSpeaking();
    setIdx(Math.max(0, Math.min(total - 1, i)));
  };
  const submit = () => {
    const left = total - answeredCount;
    if (left > 0 && !window.confirm(`まだ ${left}問 答えていません。未解答は不正解になります。採点しますか？`)) return;
    stopSpeaking();
    onSubmit(answers);
  };

  return (
    <div className="eiken-quiz" style={{ "--c": level.color }}>
      <div className="eiken-progressbar">
        <div className="eiken-progressbar-track">
          <div className="eiken-progressbar-fill" style={{ width: `${(answeredCount / total) * 100}%` }} />
        </div>
        <div className="eiken-progressbar-label">
          {idx + 1} / {total} 問（答えた数 {answeredCount}）
        </div>
      </div>

      <Question
        q={q}
        word={word}
        answer={answers[idx]}
        onAnswer={setAnswer}
        onEnter={() => (idx + 1 < total ? go(idx + 1) : submit())}
      />

      <div className="eiken-pronounce-actions" style={{ justifyContent: "space-between", marginTop: 18 }}>
        <button className="eiken-btn-ghost" onClick={() => go(idx - 1)} disabled={idx === 0}>
          ← 前へ
        </button>
        {idx + 1 < total ? (
          <button className="eiken-btn" onClick={() => go(idx + 1)}>
            次へ →
          </button>
        ) : (
          <button className="eiken-btn" onClick={submit}>
            採点する
          </button>
        )}
      </div>

      <div className="eiken-sub-head">解答状況（番号で移動）</div>
      <div className="eiken-vt-sheet">
        {answers.map((a, i) => (
          <button
            key={i}
            className={`eiken-vt-cell${a != null && a !== "" ? " done" : ""}${i === idx ? " current" : ""}`}
            onClick={() => go(i)}
            aria-label={`${i + 1}問目${a != null && a !== "" ? "（解答済み）" : "（未解答）"}`}
          >
            {i + 1}
          </button>
        ))}
      </div>
      {idx + 1 < total && (
        <div className="eiken-next-row" style={{ marginTop: 14 }}>
          <button className="eiken-btn-ghost" onClick={submit}>
            ここで採点する
          </button>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------
   結果
   ------------------------------------------------------------ */

function WordDetail({ word, mark, yourAnswer }) {
  return (
    <div className={`eiken-vt-word ${mark ? "ok" : "ng"}`}>
      <div className="eiken-vt-word-top">
        <span className={`eiken-explain-mark ${mark ? "ok" : "ng"}`}>{mark ? "◎" : "×"}</span>
        <span className="eiken-vt-word-en">{word.word}</span>
        <SpeakBtn text={word.word} small />
        <span className="eiken-vt-word-meta">
          {word.pos}
          {word.phonetic ? ` ／ [${word.phonetic}]` : ""}
        </span>
      </div>
      <div className="eiken-vt-word-meaning">{word.meaning}</div>
      {!mark && <div className="eiken-vt-yours">あなたの答え：{yourAnswer}</div>}
      {word.example && (
        <div className="eiken-example-box" style={{ marginTop: 8, marginBottom: 0 }}>
          <div className="eiken-example-row">
            <span className="eiken-example-en">{word.example.en}</span>
            <SpeakBtn text={word.example.en} small label="例文を聞く" />
          </div>
          <div className="eiken-example-ja">{word.example.ja}</div>
        </div>
      )}
    </div>
  );
}

function Result({ level, test, graded, previous, onRetryWrong, onRetrySame, onSetup, onExit }) {
  const [showAll, setShowAll] = useState(false);
  const rows = test.questions.map((q, i) => ({
    q,
    word: test.byId.get(q.wordId),
    mark: graded.marks[i],
    yours: answerText(q, test.answers[i]),
  }));
  const wrong = rows.filter((r) => !r.mark);
  const diff = previous ? graded.percent - previous.percent : null;

  return (
    <div className="eiken-quiz" style={{ "--c": level.color }}>
      <div className="eiken-result" style={{ paddingBottom: 6 }}>
        <div className="eiken-qhead-eyebrow">
          {level.levelLabel} 単語テスト ／ {rangeLabel(test.range)}・{formatLabel(test.format)}
        </div>
        <div className="eiken-result-big">
          {graded.correct} / {graded.total}
        </div>
        <div className="eiken-vt-percent">正答率 {graded.percent}%</div>
        <div className="eiken-result-sub">
          所要時間 {formatElapsed(test.elapsedSec)}
          {graded.unanswered > 0 && ` ／ 未解答 ${graded.unanswered}問`}
          {diff != null && ` ／ 前回 ${previous.percent}%（${diff >= 0 ? "+" : ""}${diff}）`}
        </div>
        {wrong.length > 0 && (
          <div className="eiken-hint">まちがえた {wrong.length}語は「まちがえた問題の復習」に入りました。</div>
        )}
      </div>

      <div className="eiken-result-actions" style={{ marginTop: 6, marginBottom: 18 }}>
        {wrong.length > 0 && (
          <button className="eiken-btn" onClick={onRetryWrong}>
            まちがえた{wrong.length}語をもう一度
          </button>
        )}
        <button className="eiken-btn-ghost" onClick={onRetrySame}>
          同じ条件でもう一度
        </button>
        <button className="eiken-btn-ghost" onClick={onSetup}>
          条件を変える
        </button>
      </div>

      <div className="eiken-sub-head">
        {showAll ? `全${rows.length}問` : wrong.length ? `まちがえた単語（${wrong.length}語）` : "全問正解です！"}
      </div>
      <div className="eiken-vt-words">
        {(showAll ? rows : wrong).map((r, i) => (
          <WordDetail key={`${r.q.wordId}-${i}`} word={r.word} mark={r.mark} yourAnswer={r.yours} />
        ))}
      </div>
      <div style={{ marginTop: 10 }}>
        <button className="eiken-link-btn" onClick={() => setShowAll((v) => !v)}>
          {showAll ? "まちがえた単語だけ表示" : "全問の答えを見る"}
        </button>
      </div>

      <div className="eiken-sub-head">{level.levelLabel} の得点推移（直近20回）</div>
      <VocabTestTrend level={level.level} color={level.color} key={graded.savedAt} />

      <div className="eiken-footer-row">
        <span />
        <button className="eiken-btn-ghost" onClick={onExit}>
          モード選択にもどる
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------
   本体
   ------------------------------------------------------------ */

export default function EikenVocabTest({ level, onExit }) {
  const [stage, setStage] = useState("setup"); // setup | run | result
  const [settings, setSettings] = useState({ rangeType: "units", from: 0, to: 0, count: 20, format: "en2ja" });
  const [test, setTest] = useState(null);
  const [graded, setGraded] = useState(null);
  const [previous, setPrevious] = useState(null);
  const [nonce, setNonce] = useState(0);
  const byId = useMemo(() => new Map(level.vocab.map((w) => [w.id, w])), [level]);
  // 復習リストはテストのたびに変わるので、設定画面にもどるたびに数え直す
  const weakIds = useMemo(() => getReviewItemIds(level.level, "vocab"), [level, nonce]); // eslint-disable-line react-hooks/exhaustive-deps

  const start = (range, words, count = settings.count, format = settings.format) => {
    const questions = buildVocabTest(level.vocab, words, { format, count });
    if (!questions.length) return;
    setTest({ range, format, count, words, questions, byId, startedAt: Date.now() });
    setGraded(null);
    setStage("run");
    window.scrollTo && window.scrollTo(0, 0);
  };

  const submit = (answers) => {
    const g = gradeVocabTest(test.questions, answers);
    const elapsedSec = Math.round((Date.now() - test.startedAt) / 1000);
    setPrevious(getVocabTestResults(level.level)[0] || null);
    // 採点してから記録する（回答中は記録しない）。勉強履歴では1回のテストを1回として残す
    newStudySession();
    test.questions.forEach((q, i) => {
      recordAnswer(level.level, "vocabTest", q.wordId, g.marks[i]);
      // まちがえた単語は「単語・熟語」の復習リストに入れる（buildReviewItems が単語の id で引く）
      recordReviewResult(level.level, "vocab", q.wordId, g.marks[i]);
    });
    const saved = saveVocabTestResult(level.level, {
      format: test.format,
      range: test.range,
      count: test.count,
      correct: g.correct,
      total: g.total,
      percent: g.percent,
      wrongIds: g.wrongIds,
      elapsedSec,
    });
    setTest({ ...test, answers, elapsedSec });
    setGraded({ ...g, savedAt: saved.at });
    setNonce((n) => n + 1);
    setStage("result");
    window.scrollTo && window.scrollTo(0, 0);
  };

  if (stage === "run" && test) {
    return <Run key={test.startedAt} level={level} test={test} onSubmit={submit} />;
  }
  if (stage === "result" && test && graded) {
    return (
      <Result
        level={level}
        test={test}
        graded={graded}
        previous={previous}
        onRetryWrong={() =>
          start(
            { type: "retry" },
            graded.wrongIds.map((id) => byId.get(id)).filter(Boolean),
            "all",
            test.format
          )
        }
        onRetrySame={() => start(test.range, test.words, test.count, test.format)}
        onSetup={() => setStage("setup")}
        onExit={onExit}
      />
    );
  }
  return (
    <Setup
      key={nonce}
      level={level}
      settings={settings}
      setSettings={setSettings}
      weakIds={weakIds}
      onStart={(range, words) => start(range, words)}
    />
  );
}
