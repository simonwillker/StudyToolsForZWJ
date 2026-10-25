import React, { useEffect, useMemo, useRef, useState } from "react";
import { newStudySession } from "./studyLog";
import { findUnit, loadUnit, peekUnit, checkAnswer, isAnswerEmpty, choiceOrder } from "./sapixSubjects";
import { recordAnswer } from "./sapixProgress";
import {
  TEST_COUNTS,
  TEST_MINUTES,
  pickTestQuestions,
  gradeTest,
  saveTestResult,
  loadTestResults,
  testTrend,
  formatClock,
} from "./sapixStudy";
import { LEVEL_COLOR, RichText, Figure, AnswerInput, AnswerText } from "./sapixParts.jsx";

/* ============================================================
   Sapix：まとめテスト（単元をえらぶ → 回答（正解は見せない）→ まとめて採点 → 結果）
   CCAO-F の模擬試験と同じ流れ。ロジックと保存は sapixStudy.js。
   ============================================================ */

/** えらんだ単元の問題をまとめて読む。{ 単元: { questions, passages } } */
export function loadUnits(subject, unitIds) {
  return Promise.all(unitIds.map((id) => (peekUnit(subject, id) ? Promise.resolve(peekUnit(subject, id)) : loadUnit(subject, id)).then((d) => [id, d]))).then(
    (pairs) => Object.fromEntries(pairs)
  );
}

function fmtDateTime(iso) {
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 得点推移（古い→新しい、直近20回）。1系列なので凡例は出さず、見出しで名前を示す */
export function TestTrend({ subject }) {
  const trend = useMemo(() => testTrend(subject, 20), [subject]);
  const [hover, setHover] = useState(null);
  if (!trend.length) return <div className="sm-empty-note">まだまとめテストを受けていません。</div>;
  const last = trend[trend.length - 1];
  const shown = hover != null ? trend[hover] : last;
  return (
    <div className="st-trend" style={{ "--c": subject.accent }}>
      <div className="st-chart" role="img" aria-label={`得点推移：直近${trend.length}回、最新 ${last.percent}%`}>
        <div className="st-grid" style={{ bottom: "50%" }} />
        <div className="st-grid" style={{ bottom: "100%" }} />
        {trend.map((r, i) => (
          <div
            key={r.at}
            className={`st-col${hover === i ? " hover" : ""}`}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
            onClick={() => setHover(hover === i ? null : i)}
            title={`${fmtDateTime(r.at)}　${r.correct}/${r.total}（${r.percent}%）`}
          >
            <div className="st-bar" style={{ height: `${Math.max(r.percent, 2)}%` }} />
          </div>
        ))}
        <div className="st-axis">
          <span>100</span>
          <span>50</span>
          <span>0</span>
        </div>
      </div>
      <div className="st-caption">
        {hover != null ? "" : "最新："}
        {fmtDateTime(shown.at)}　{shown.unitIds.length}単元・{shown.timeLimitMin ? `${shown.timeLimitMin}分` : "時間なし"}
        <b>
          {shown.correct}/{shown.total}（{shown.percent}%）
        </b>
      </div>
    </div>
  );
}

export function TestHistory({ subject, limit = 5 }) {
  const list = loadTestResults(subject).slice(0, limit);
  if (!list.length) return null;
  return (
    <div className="st-history">
      {list.map((r) => (
        <div className="st-history-row" key={r.at}>
          <span>{fmtDateTime(r.at)}</span>
          <span>
            {r.unitIds.length === 1 ? (findUnit(subject, r.unitIds[0]) || {}).label : `${r.unitIds.length}単元`}
            {r.timeLimitMin ? `・${r.timeLimitMin}分` : ""}
          </span>
          <b>
            {r.correct}/{r.total}（{r.percent}%）
          </b>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------
   条件をえらぶ
   ------------------------------------------------------------ */

function Setup({ subject, settings, setSettings, onStart, loading }) {
  const { unitIds, count, minutes } = settings;
  const set = (patch) => setSettings((s) => ({ ...s, ...patch }));
  const toggle = (id) => set({ unitIds: unitIds.includes(id) ? unitIds.filter((x) => x !== id) : [...unitIds, id] });
  // 1単元 20 問なので、えらんだ単元数×20 が上限
  const max = unitIds.length * 20;
  const n = Math.min(count, max);
  return (
    <div className="sm-inner">
      <div className="sm-title-block">
        <div className="sm-eyebrow">{subject.title}</div>
        <h1 className="sm-serif">まとめテスト</h1>
        <div className="sm-under" />
        <div className="sm-lead">
          単元をえらんで受けるテストです。答えている間は正解を出さず、最後にまとめて採点します。まちがえた問題は「今日の復習」に入ります。
        </div>
      </div>

      <div className="sm-box" style={{ marginTop: 0 }}>
        <div className="st-row-head">
          <span>単元（{unitIds.length}/{subject.units.length}）</span>
          <span className="st-row-tools">
            <button className="sm-back-link" onClick={() => set({ unitIds: subject.units.map((u) => u.id) })}>すべて</button>
            <button className="sm-back-link" onClick={() => set({ unitIds: [] })}>はずす</button>
          </span>
        </div>
        {subject.categories.map((c) => {
          const units = subject.units.filter((u) => u.category === c.id);
          const allOn = units.every((u) => unitIds.includes(u.id));
          return (
            <div key={c.id} className="st-cat">
              <button
                className="st-cat-head"
                style={{ "--c": c.color }}
                onClick={() =>
                  set({
                    unitIds: allOn
                      ? unitIds.filter((id) => !units.some((u) => u.id === id))
                      : [...new Set([...unitIds, ...units.map((u) => u.id)])],
                  })
                }
              >
                <span className="sm-cat-dot" style={{ "--c": c.color }} />
                {c.label}
              </button>
              <div className="st-chips">
                {units.map((u) => (
                  <button
                    key={u.id}
                    className={`st-chip${unitIds.includes(u.id) ? " on" : ""}`}
                    style={{ "--c": u.color }}
                    onClick={() => toggle(u.id)}
                    aria-pressed={unitIds.includes(u.id)}
                  >
                    {u.label}
                  </button>
                ))}
              </div>
            </div>
          );
        })}

        <div className="st-row-head" style={{ marginTop: 14 }}>問題数</div>
        <div className="st-chips">
          {TEST_COUNTS.map((c) => (
            <button key={c} className={`st-chip${count === c ? " on" : ""}`} style={{ "--c": subject.accent }} onClick={() => set({ count: c })}>
              {c}問
            </button>
          ))}
        </div>
        <div className="st-row-head" style={{ marginTop: 14 }}>制限時間</div>
        <div className="st-chips">
          {TEST_MINUTES.map((m) => (
            <button key={m} className={`st-chip${minutes === m ? " on" : ""}`} style={{ "--c": subject.accent }} onClick={() => set({ minutes: m })}>
              {m ? `${m}分` : "なし"}
            </button>
          ))}
        </div>
      </div>

      <div className="st-summary">
        {unitIds.length ? (
          <>
            {unitIds.length}単元から <b>{n}問</b>
            {count > max && <>（えらんだ単元が{max}問なので{n}問になります）</>}
            {minutes ? `・${minutes}分` : "・時間なし"}
          </>
        ) : (
          "単元を1つ以上えらんでください"
        )}
      </div>
      <div style={{ textAlign: "center", marginTop: 12 }}>
        <button className="sm-btn" style={{ "--c": subject.accent }} disabled={!unitIds.length || loading} onClick={onStart}>
          {loading ? "問題を読み込んでいます…" : "テストを始める"}
        </button>
      </div>

      <div className="sm-sub-head">得点推移（直近20回）</div>
      <div style={{ maxWidth: 720, margin: "0 auto" }}>
        <TestTrend subject={subject} />
        <TestHistory subject={subject} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------
   回答中：正解は見せない。前後に移動して答えを直せる
   ------------------------------------------------------------ */

function Run({ subject, test, onSubmit, onQuit }) {
  const [idx, setIdx] = useState(0);
  const [answers, setAnswers] = useState(() => test.questions.map(() => ({})));
  const [now, setNow] = useState(Date.now());
  const topRef = useRef(null);
  const submitted = useRef(false);
  const total = test.questions.length;
  const q = test.questions[idx];
  const unit = findUnit(subject, q._unit);
  const passage = q.passage ? (test.units[q._unit].passages || {})[q.passage] : null;
  const [showPassage, setShowPassage] = useState(true);
  // 選択肢の並びはテストのあいだ同じにする（前後に移動しても入れかわらないように）
  const orders = useMemo(() => test.questions.map((x) => (x.type === "choice" ? choiceOrder(subject, x) : [])), [test, subject]);
  const filled = (i) => !isAnswerEmpty(test.questions[i], answers[i]);
  const answered = answers.filter((_, i) => filled(i)).length;
  const limitMs = test.minutes * 60 * 1000;
  const leftSec = limitMs ? Math.max(0, (test.startedAt + limitMs - now) / 1000) : null;

  const finish = (byTimer = false) => {
    if (submitted.current) return;
    submitted.current = true;
    onSubmit(answers, byTimer);
  };

  useEffect(() => {
    if (!limitMs) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [limitMs]);

  useEffect(() => {
    if (leftSec === 0) finish(true);
  }, [leftSec]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (topRef.current && topRef.current.scrollIntoView) topRef.current.scrollIntoView({ block: "start" });
  }, [idx]);

  const go = (i) => setIdx(Math.max(0, Math.min(total - 1, i)));
  const submit = () => {
    const left = total - answered;
    if (left > 0 && !window.confirm(`まだ ${left}問 答えていません。未解答は不正解になります。採点しますか？`)) return;
    finish(false);
  };

  return (
    <div className="sm-quiz" ref={topRef}>
      <div className="sm-quiz-head">
        <span>
          {idx + 1} / {total} 問（答えた {answered}）
        </span>
        <span className="sm-quiz-head-right">
          {leftSec != null && <span className={`st-timer${leftSec < 60 ? " warn" : ""}`}>⏱ のこり {formatClock(leftSec)}</span>}
          <span className="sm-level" style={{ "--c": LEVEL_COLOR[q.level] }}>{q.level}</span>
          <span style={{ color: unit.color }}>{unit.label}</span>
        </span>
      </div>
      <div className="sm-progress-bar">
        <div style={{ width: `${(answered / total) * 100}%`, background: subject.accent }} />
      </div>

      {passage && (
        <div className="sm-passage">
          <button className="sm-passage-head" onClick={() => setShowPassage((v) => !v)} aria-expanded={showPassage}>
            <span>📖 本文「{passage.title}」</span>
            <span className="sm-passage-toggle">{showPassage ? "とじる ▲" : "ひらく ▼"}</span>
          </button>
          {showPassage && <div className="sm-passage-text">{passage.text}</div>}
        </div>
      )}
      <div className="sm-stem"><RichText text={q.q} fractions={subject.fractions} /></div>
      <Figure q={q} />
      <AnswerInput
        q={q}
        order={orders[idx]}
        input={answers[idx]}
        setInput={(v) => setAnswers((a) => a.map((x, i) => (i === idx ? v : x)))}
        disabled={false}
        onEnter={() => (idx + 1 < total ? go(idx + 1) : submit())}
      />

      <div className="sm-quiz-foot">
        <button className="sm-btn-ghost" onClick={() => go(idx - 1)} disabled={idx === 0}>← 前へ</button>
        {idx + 1 < total ? (
          <button className="sm-btn" style={{ "--c": subject.accent }} onClick={() => go(idx + 1)}>次へ →</button>
        ) : (
          <button className="sm-btn" style={{ "--c": subject.accent }} onClick={submit}>採点する</button>
        )}
      </div>

      <div className="sm-sub-head">解答状況（番号で移動）</div>
      <div className="st-sheet">
        {test.questions.map((_, i) => (
          <button
            key={i}
            className={`st-cell${filled(i) ? " done" : ""}${i === idx ? " current" : ""}`}
            style={{ "--c": subject.accent }}
            onClick={() => go(i)}
            aria-label={`${i + 1}問目${filled(i) ? "（解答済み）" : "（未解答）"}`}
          >
            {i + 1}
          </button>
        ))}
      </div>
      <div className="sm-quiz-foot">
        <button className="sm-btn-ghost" onClick={() => window.confirm("テストをやめます。ここまでの答えは記録されません。よろしいですか？") && onQuit()}>
          やめる
        </button>
        {idx + 1 < total && <button className="sm-btn-ghost" onClick={submit}>ここで採点する</button>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------
   結果
   ------------------------------------------------------------ */

function YourAnswer({ q, input }) {
  if (isAnswerEmpty(q, input)) return <span>（未解答）</span>;
  if (q.type === "choice") return <span>{q.choices[input.choice]}</span>;
  if (q.type === "fraction") {
    const w = input.whole ? `${input.whole}と` : "";
    return <span>{input.n || input.d ? `${w}${input.n || ""}/${input.d || ""}` : input.whole}</span>;
  }
  return <span>{input.value}{q.unit ? ` ${q.unit}` : ""}</span>;
}

function WrongItem({ subject, q, input, passages }) {
  const [open, setOpen] = useState(false);
  const unit = findUnit(subject, q._unit);
  const passage = q.passage ? passages[q.passage] : null;
  return (
    <div className="st-wrong">
      <div className="st-wrong-top">
        <span className="sm-level" style={{ "--c": LEVEL_COLOR[q.level] }}>{q.level}</span>
        <span className="st-wrong-unit" style={{ color: unit.color }}>{unit.label}</span>
      </div>
      {passage && <div className="st-wrong-passage">📖「{passage.title}」より</div>}
      <div className="st-wrong-q"><RichText text={q.q} fractions={subject.fractions} /></div>
      <Figure q={q} />
      <div className="st-wrong-yours">あなたの答え：<YourAnswer q={q} input={input} /></div>
      <div className="st-wrong-answer">正解：<AnswerText q={q} /></div>
      <button className="sm-back-link" onClick={() => setOpen((v) => !v)}>{open ? "解説をとじる ▲" : `${subject.fractions ? "解き方" : "解説"}を見る ▼`}</button>
      {open && <div className="sm-explain"><RichText text={q.explain} fractions={subject.fractions} /></div>}
    </div>
  );
}

function Result({ subject, test, graded, previous, onRetryWrong, onRetrySame, onSetup, onBack }) {
  const wrongRows = test.questions.map((q, i) => ({ q, input: test.answers[i], i })).filter((r) => !graded.marks[r.i]);
  const diff = previous ? graded.percent - previous.percent : null;
  const units = Object.entries(graded.perUnit)
    .map(([id, v]) => ({ unit: findUnit(subject, id), ...v, pct: Math.round((v.correct / v.total) * 100) }))
    .sort((a, b) => a.pct - b.pct);
  return (
    <div className="sm-inner">
      <div className="sm-result" style={{ marginTop: 0 }}>
        <div className="sm-result-unit" style={{ color: subject.accent }}>まとめテスト（{test.unitIds.length}単元）</div>
        <div className="sm-result-pct" style={{ color: subject.accent }}>{graded.percent}%</div>
        <div className="sm-result-sub">
          {graded.total}問中 {graded.correct}問 正解　／　{formatClock(test.elapsedSec)}
          {test.minutes ? `（制限 ${test.minutes}分）` : ""}
        </div>
        <div className="sm-result-note">
          {test.byTimer && <>⏱ 時間になったので採点しました。<br /></>}
          {graded.unanswered > 0 && <>未解答 {graded.unanswered}問。</>}
          {diff != null && <>前回 {previous.percent}%（{diff >= 0 ? "+" : ""}{diff}）。</>}
          {wrongRows.length > 0 && <>まちがえた {wrongRows.length}問は「今日の復習」に入りました（あしたから出ます）。</>}
        </div>
      </div>

      <div className="sm-sub-head">単元ごとの正答率（低い順）</div>
      <div style={{ maxWidth: 720, margin: "0 auto" }}>
        {units.map((u) => (
          <div className="sm-stat-row" key={u.unit.id} style={{ "--c": u.unit.color }}>
            <div className="sm-stat-name">{u.unit.label}</div>
            <div className="sm-stat-track"><div className="sm-stat-fill" style={{ width: `${u.pct}%` }} /></div>
            <div className="sm-stat-num">{u.correct}/{u.total}（{u.pct}%）</div>
          </div>
        ))}
      </div>

      <div className="sm-result-btns" style={{ marginTop: 18 }}>
        {wrongRows.length > 0 && (
          <button className="sm-btn" style={{ "--c": "#C8323D" }} onClick={() => onRetryWrong(wrongRows.map((r) => r.q))}>
            まちがえた {wrongRows.length} 問を解き直す（解説つき）
          </button>
        )}
        <button className="sm-btn-ghost" onClick={onRetrySame}>同じ単元でもう一度</button>
        <button className="sm-btn-ghost" onClick={onSetup}>条件を変える</button>
      </div>

      {wrongRows.length > 0 && (
        <>
          <div className="sm-sub-head">まちがえた問題（{wrongRows.length}問）</div>
          <div className="st-wrongs">
            {wrongRows.map((r) => (
              <WrongItem key={r.q.id} subject={subject} q={r.q} input={r.input} passages={test.units[r.q._unit].passages || {}} />
            ))}
          </div>
        </>
      )}

      <div className="sm-sub-head">得点推移（直近20回）</div>
      <div style={{ maxWidth: 720, margin: "0 auto" }}>
        <TestTrend subject={subject} key={graded.savedAt} />
      </div>
      <div className="sm-result-btns" style={{ marginTop: 18 }}>
        <button className="sm-btn-ghost" onClick={onBack}>単元一覧にもどる</button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------
   本体
   ------------------------------------------------------------ */

export default function SapixTest({ subject, onBack, onRetryWrong }) {
  const [stage, setStage] = useState("setup"); // setup | run | result
  const [settings, setSettings] = useState({ unitIds: subject.units.map((u) => u.id), count: 20, minutes: 0 });
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [test, setTest] = useState(null);
  const [graded, setGraded] = useState(null);
  const [previous, setPrevious] = useState(null);

  const start = (s = settings) => {
    setLoading(true);
    setLoadError(false);
    loadUnits(subject, s.unitIds)
      .then((units) => {
        const pools = s.unitIds.map((id) => ({ unitId: id, questions: units[id].questions }));
        const questions = pickTestQuestions(pools, s.count);
        setLoading(false);
        if (!questions.length) return;
        setTest({ ...s, units, questions, startedAt: Date.now() });
        setGraded(null);
        setStage("run");
      })
      .catch(() => {
        setLoading(false);
        setLoadError(true);
      });
  };

  const submit = (answers, byTimer) => {
    const g = gradeTest(test.questions, answers, checkAnswer, isAnswerEmpty);
    const elapsedSec = Math.min(Math.round((Date.now() - test.startedAt) / 1000), test.minutes ? test.minutes * 60 : Infinity);
    setPrevious(loadTestResults(subject)[0] || null);
    // 採点してから記録する（回答中は記録しない）。勉強履歴では 1 回のテストを 1 回として残す
    newStudySession();
    test.questions.forEach((q, i) => recordAnswer(subject, q._unit, q.id, g.marks[i], false, "まとめテスト"));
    const saved = saveTestResult(subject, {
      unitIds: test.unitIds,
      count: test.count,
      timeLimitMin: test.minutes,
      correct: g.correct,
      total: g.total,
      percent: g.percent,
      perUnit: g.perUnit,
      wrongIds: g.wrongIds,
      elapsedSec,
      byTimer: !!byTimer,
    });
    setTest({ ...test, answers, elapsedSec, byTimer });
    setGraded({ ...g, savedAt: saved.at });
    setStage("result");
    window.scrollTo && window.scrollTo(0, 0);
  };

  if (stage === "run" && test) {
    return <Run key={test.startedAt} subject={subject} test={test} onSubmit={submit} onQuit={() => setStage("setup")} />;
  }
  if (stage === "result" && test && graded) {
    return (
      <Result
        subject={subject}
        test={test}
        graded={graded}
        previous={previous}
        onRetryWrong={(qs) => onRetryWrong(qs, test.units)}
        onRetrySame={() => start({ unitIds: test.unitIds, count: test.count, minutes: test.minutes })}
        onSetup={() => setStage("setup")}
        onBack={onBack}
      />
    );
  }
  return (
    <>
      <Setup subject={subject} settings={settings} setSettings={setSettings} onStart={() => start()} loading={loading} />
      {loadError && <div className="sm-empty">問題を読みこめませんでした。通信を確かめてからもう一度ためしてください。</div>}
    </>
  );
}

