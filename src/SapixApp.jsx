import React, { useEffect, useMemo, useRef, useState } from "react";
import { newStudySession } from "./studyLog";
import {
  getSubject,
  findUnit,
  peekUnit,
  loadUnit,
  checkAnswer,
  isAnswerEmpty,
  parseFraction,
  toMixed,
  choiceOrder,
} from "./sapixSubjects";
import {
  recordAnswer,
  recordRun,
  getUnitStats,
  accuracyPercent,
  getReviewIds,
  getTotalReviewCount,
  getStreak,
  getTodayStats,
  resetProgress,
} from "./sapixProgress";
import { downloadBackup, parseBackup, applyBackup, describeBackup } from "./sapixBackup";

/* ============================================================
   Sapix 算数・国語・社会・理科（小4 冬期講習相当）・英語（英検5級〜4級程度）

   教科（subjectId）ごとに同じ画面を使う。単元一覧 → 単元を選んで20問 →
   1問ずつ答え合わせと解説 → 結果 → まちがえた問題だけもう一度、の流れ。
   見た目と操作は CCAO-F 対策（CcaofApp.jsx）にそろえてある。
   問題データは src/data/ の sapixMath・sapixKokugo・sapixShakai・sapixRika・sapixEigo（スキーマは各フォルダの README.md）。
   ============================================================ */

const APP_VERSION = __APP_VERSION__;
const BUILD_DATE = __BUILD_DATE__;
const LEVEL_COLOR = { 基本: "#2F7A4F", 標準: "#C8743D", 発展: "#C8323D" };

function shortDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/** 分数を縦書き（分子／線／分母）で表示する */
function Frac({ n, d }) {
  return (
    <span className="sm-frac">
      <span>{n}</span>
      <span className="sm-frac-bar" />
      <span>{d}</span>
    </span>
  );
}

/** 正解の表示。分数は帯分数（1より大きいとき）と仮分数を両方出す */
function AnswerText({ q }) {
  if (q.type === "choice") return <span>{q.choices[q.answer]}</span>;
  if (q.type === "text") return <span>{q.accepted[0]}</span>;
  if (q.type === "number") return <span>{q.answer}{q.unit ? ` ${q.unit}` : ""}</span>;
  const f = parseFraction(q.answer);
  const m = toMixed(f);
  if (m.whole === 0) return <Frac n={f.n} d={f.d} />;
  return (
    <span className="sm-frac-line">
      {m.whole}<Frac n={m.n} d={m.d} />
      <span className="sm-frac-alt">（仮分数で <Frac n={f.n} d={f.d} />）</span>
    </span>
  );
}

/** 問題文の中の「a/b」を縦書きの分数で表示する（「1と2/5」の「と」は帯分数の区切り） */
function RichText({ text, fractions = true }) {
  if (!fractions) return <>{text}</>;
  const parts = String(text).split(/(\d+と\d+\/\d+|\d+\/\d+)/g);
  return (
    <>
      {parts.map((p, i) => {
        const mixed = /^(\d+)と(\d+)\/(\d+)$/.exec(p);
        if (mixed) return <span key={i} className="sm-frac-line">{mixed[1]}<Frac n={mixed[2]} d={mixed[3]} /></span>;
        const fr = /^(\d+)\/(\d+)$/.exec(p);
        if (fr) return <Frac key={i} n={fr[1]} d={fr[2]} />;
        return <React.Fragment key={i}>{p}</React.Fragment>;
      })}
    </>
  );
}

function Figure({ q }) {
  if (!q.figure) return null;
  // 図は問題データ（リポジトリ内の JSON）にある SVG。検証スクリプトでスクリプトを含まないことを確かめている
  return <div className="sm-figure" role="img" aria-label={q.figureAlt || "図"} dangerouslySetInnerHTML={{ __html: q.figure }} />;
}

function AnswerInput({ q, order, input, setInput, disabled, onEnter }) {
  const onKey = (e) => {
    if (e.key === "Enter") onEnter();
  };
  if (q.type === "choice") {
    return (
      <div className={`sm-choices${q.choices.some((c) => c.length > 8) ? " list" : ""}`}>
        {order.map((i) => {
          const c = q.choices[i];
          let cls = "sm-choice";
          if (disabled) {
            if (i === q.answer) cls += " correct";
            else if (input.choice === i) cls += " wrong";
          } else if (input.choice === i) cls += " picked";
          return (
            <button key={i} className={cls} disabled={disabled} onClick={() => setInput({ choice: i })}>
              {c}
            </button>
          );
        })}
      </div>
    );
  }
  if (q.type === "fraction") {
    const set = (k) => (e) => setInput({ ...input, [k]: e.target.value });
    return (
      <div className="sm-answer-row">
        <span className="sm-answer-label">答え</span>
        <input className="sm-input sm-input-whole" inputMode="numeric" aria-label="整数部分" placeholder="整数"
          value={input.whole || ""} onChange={set("whole")} onKeyDown={onKey} disabled={disabled} />
        <span className="sm-frac-input">
          <input className="sm-input sm-input-small" inputMode="numeric" aria-label="分子" placeholder="分子"
            value={input.n || ""} onChange={set("n")} onKeyDown={onKey} disabled={disabled} />
          <span className="sm-frac-bar wide" />
          <input className="sm-input sm-input-small" inputMode="numeric" aria-label="分母" placeholder="分母"
            value={input.d || ""} onChange={set("d")} onKeyDown={onKey} disabled={disabled} />
        </span>
        <span className="sm-answer-hint">帯分数は左に整数、仮分数は整数を空けたまま</span>
      </div>
    );
  }
  if (q.type === "text") {
    return (
      <div className="sm-answer-row">
        <span className="sm-answer-label">答え</span>
        <input className="sm-input sm-input-text" lang={/^[A-Za-z]/.test(q.accepted[0]) ? "en" : "ja"} aria-label="答え" autoComplete="off" autoCapitalize="off" spellCheck={false}
          value={input.value || ""} onChange={(e) => setInput({ value: e.target.value })} onKeyDown={onKey} disabled={disabled} />
      </div>
    );
  }
  return (
    <div className="sm-answer-row">
      <span className="sm-answer-label">答え</span>
      <input className="sm-input" inputMode="decimal" aria-label="答え" autoComplete="off"
        value={input.value || ""} onChange={(e) => setInput({ value: e.target.value })} onKeyDown={onKey} disabled={disabled} />
      {q.unit && <span className="sm-unit">{q.unit}</span>}
    </div>
  );
}

function Quiz({ subject, unit, questions, passages, review, onFinish, onExit }) {
  const [index, setIndex] = useState(0);
  const [input, setInput] = useState({});
  const [result, setResult] = useState(null); // { ok, reason }
  const [wrongIds, setWrongIds] = useState([]);
  const [score, setScore] = useState(0);
  const topRef = useRef(null);

  const q = questions[index];
  const total = questions.length;
  // 選択肢の並びは問題ごとに1回だけ決める（答え合わせの前後で入れかわらないように）
  const order = useMemo(() => (q.type === "choice" ? choiceOrder(subject, q) : []), [q, subject]);
  const passage = q.passage ? passages[q.passage] : null;
  const [showPassage, setShowPassage] = useState(true);

  // 勉強履歴：出題が始まるたびに新しい回
  useEffect(() => {
    newStudySession();
  }, [questions]);

  useEffect(() => {
    if (topRef.current && topRef.current.scrollIntoView) topRef.current.scrollIntoView({ block: "start" });
  }, [index]);

  const submit = () => {
    if (result || isAnswerEmpty(q, input)) return;
    const r = checkAnswer(q, input);
    setResult(r);
    recordAnswer(subject, unit.id, q.id, r.ok, review);
    if (r.ok) setScore((s) => s + 1);
    else setWrongIds((w) => [...w, q.id]);
  };

  const next = () => {
    if (index + 1 >= total) {
      onFinish({ score, total, wrongIds });
      return;
    }
    setIndex(index + 1);
    setInput({});
    setResult(null);
  };

  return (
    <div className="sm-quiz" ref={topRef}>
      <div className="sm-quiz-head">
        <span>{index + 1} / {total} 問{review ? "（復習）" : ""}</span>
        <span className="sm-quiz-head-right">
          <span className="sm-level" style={{ "--c": LEVEL_COLOR[q.level] }}>{q.level}</span>
          <span style={{ color: unit.color }}>{unit.label}</span>
        </span>
      </div>
      <div className="sm-progress-bar"><div style={{ width: `${(index / total) * 100}%`, background: unit.color }} /></div>

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

      <AnswerInput q={q} order={order} input={input} setInput={setInput} disabled={!!result} onEnter={result ? next : submit} />

      {result && (
        <div className={`sm-judge ${result.ok ? "ok" : "ng"}`}>
          <div className="sm-judge-title">{result.ok ? "⭕ 正解！" : "❌ ざんねん"}</div>
          {result.reason && <div className="sm-judge-reason">{result.reason}</div>}
          <div className="sm-judge-answer">正解：<AnswerText q={q} /></div>
          <div className="sm-explain-title">{subject.fractions ? "解き方" : "解説"}</div>
          <div className="sm-explain"><RichText text={q.explain} fractions={subject.fractions} /></div>
        </div>
      )}

      <div className="sm-quiz-foot">
        <button className="sm-btn-ghost" onClick={onExit}>やめる</button>
        {result ? (
          <button className="sm-btn" style={{ "--c": unit.color }} onClick={next}>
            {index + 1 >= total ? "結果を見る" : "次の問題"}
          </button>
        ) : (
          <button className="sm-btn" style={{ "--c": unit.color }} onClick={submit} disabled={isAnswerEmpty(q, input)}>
            答え合わせ
          </button>
        )}
      </div>
    </div>
  );
}

function Result({ unit, run, questions, onRetryWrong, onBack }) {
  const pct = Math.round((run.score / run.total) * 100);
  const wrong = questions.filter((q) => run.wrongIds.includes(q.id));
  const msg = pct === 100 ? "全問正解！すばらしい！" : pct >= 80 ? "よくできました。まちがえた問題を見直そう。" : pct >= 50 ? "あと少し。解き方を読んでからもう一度やってみよう。" : "解説を読んで、まちがえた問題からやり直そう。";
  return (
    <div className="sm-result">
      <div className="sm-result-unit" style={{ color: unit.color }}>{unit.label}</div>
      <div className="sm-result-pct" style={{ color: unit.color }}>{pct}%</div>
      <div className="sm-result-sub">{run.total}問中 {run.score}問 正解</div>
      <div className="sm-result-note">{msg}</div>
      {wrong.length > 0 && (
        <div className="sm-wrong-list">
          <div className="sm-sub-head" style={{ margin: "0 0 6px" }}>まちがえた問題</div>
          {wrong.map((q) => (
            <div className="sm-wrong-row" key={q.id}>
              <span className="sm-level" style={{ "--c": LEVEL_COLOR[q.level] }}>{q.level}</span>
              <span className="sm-wrong-q">{q.q.replace(/\n/g, " ")}</span>
            </div>
          ))}
        </div>
      )}
      <div className="sm-result-btns">
        {wrong.length > 0 && (
          <button className="sm-btn" style={{ "--c": "#C8323D" }} onClick={() => onRetryWrong(wrong)}>
            まちがえた {wrong.length} 問だけもう一度
          </button>
        )}
        <button className="sm-btn-ghost" onClick={onBack}>単元一覧にもどる</button>
      </div>
    </div>
  );
}

export default function SapixApp({ subjectId, onExitApp }) {
  const subject = getSubject(subjectId);
  const ACCENT = subject.accent;
  const [screen, setScreen] = useState("units"); // units | unit | quiz | result | progress
  const [unitId, setUnitId] = useState(null);
  const [unitData, setUnitData] = useState(null); // { questions（単元の全20問）, passages（読解の本文） }
  const [loadError, setLoadError] = useState(false);
  const [session, setSession] = useState(null); // { questions, review }
  const [run, setRun] = useState(null);
  const [, setNonce] = useState(0);
  const [backupMsg, setBackupMsg] = useState(null);
  const backupInputRef = useRef(null);

  const unit = unitId ? findUnit(subject, unitId) : null;
  const questions = unitData ? unitData.questions : null;

  useEffect(() => {
    if (!unitId) return;
    const cached = peekUnit(subject, unitId);
    if (cached) {
      setUnitData(cached);
      return;
    }
    setUnitData(null);
    setLoadError(false);
    loadUnit(subject, unitId)
      .then(setUnitData)
      .catch(() => setLoadError(true));
  }, [subject, unitId]);

  const openUnit = (id) => {
    setUnitId(id);
    setScreen("unit");
  };

  const start = (qs, review) => {
    setSession({ id: Date.now(), questions: qs, review });
    setRun(null);
    setScreen("quiz");
  };

  const finish = (r) => {
    // 通しの20問だけを「前回の点数」として残す（復習は数が少ないので混ぜない）
    if (!session.review && r.total === (questions || []).length) recordRun(subject, unit.id, r.score, r.total);
    setRun(r);
    setScreen("result");
  };

  const handleBackupExport = () => {
    const d = downloadBackup();
    setBackupMsg({ kind: "ok", text: `${d.attempted}問ぶんの記録を書き出しました。ファイルを安全な場所に保存してください。` });
  };

  const handleBackupImport = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = ""; // 同じファイルを続けて選べるようにする
    if (!file) return;
    const result = parseBackup(await file.text());
    if (!result.ok) {
      setBackupMsg({ kind: "ng", text: result.error });
      return;
    }
    const d = describeBackup(result.backup);
    const when = d.exportedAt ? new Date(d.exportedAt).toLocaleDateString() : "日付不明";
    const okToApply = window.confirm(
      `${when} のバックアップです。\n\n` +
        `・解いた問題　${d.attempted}問（正解 ${d.correct}問）\n` +
        (d.subjects.length ? `・教科　${d.subjects.join("、")}\n` : "") +
        `・学習した日数　${d.days}日\n` +
        `・復習リスト　${d.reviewCount}問\n\n` +
        `今この端末にある、バックアップに入っている教科の Sapix の記録は、これで置き換えられます。よろしいですか？`
    );
    if (!okToApply) return;
    applyBackup(result.backup);
    window.location.reload();
  };

  /* 学習記録は localStorage から毎回読む（解いた直後の画面に古い値が残らないように） */
  const allStats = screen === "units" || screen === "progress" ? subject.units.map((u) => ({ u, s: getUnitStats(subject, u.id), review: getReviewIds(subject, u.id).length })) : [];
  const totalAttempted = allStats.reduce((n, x) => n + x.s.attempted, 0);

  return (
    <div className="sm-app">
      <style>{`
        .sm-app { min-height: 100vh; background: #F7F6F2; font-family: 'Zen Kaku Gothic New', 'Hiragino Sans', sans-serif; color: #2A2E27; padding: 28px 16px 60px; }
        .sm-inner { max-width: 720px; margin: 0 auto; }
        .sm-top-nav { display: flex; justify-content: space-between; align-items: center; max-width: 720px; margin: 0 auto 12px; }
        .sm-version { font-size: 11px; color: #9AA093; font-weight: 700; display: flex; flex-direction: column; align-items: flex-end; line-height: 1.3; }
        .sm-version span:last-child { font-weight: 400; }
        .sm-back-link { font-size: 13px; color: #6B7280; cursor: pointer; text-decoration: underline; text-underline-offset: 3px; background: none; border: none; padding: 0; }
        .sm-title-block { text-align: center; margin-bottom: 20px; }
        .sm-eyebrow { font-size: 11px; letter-spacing: 2px; color: #9AA093; font-weight: 700; }
        .sm-serif { font-family: 'Shippori Mincho', serif; font-size: 28px; margin: 6px 0; }
        .sm-under { width: 40px; height: 3px; background: ${ACCENT}; margin: 0 auto; }
        .sm-lead { font-size: 12.5px; color: #6B7280; line-height: 1.7; max-width: 560px; margin: 12px auto 0; }

        .sm-facts { max-width: 720px; margin: 20px auto 0; display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
        @media (max-width: 480px) { .sm-facts { grid-template-columns: repeat(2, 1fr); } }
        .sm-fact { background: #fff; border: 1px solid #E4E2DA; border-radius: 8px; padding: 10px; text-align: center; }
        .sm-fact-num { font-size: 18px; font-weight: 800; color: ${ACCENT}; }
        .sm-fact-label { font-size: 10.5px; color: #9AA093; margin-top: 2px; }

        .sm-sub-head { font-size: 13px; font-weight: 800; color: #6B7280; max-width: 720px; margin: 24px auto 8px; display: flex; align-items: center; gap: 8px; }
        .sm-cat-dot { width: 10px; height: 10px; border-radius: 50%; background: var(--c); display: inline-block; }
        .sm-unit-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 10px; max-width: 720px; margin: 0 auto; }
        .sm-unit-card { border: 2px solid var(--c); border-radius: 10px; padding: 12px 14px; text-align: left; background: #fff; cursor: pointer; min-height: 84px; }
        .sm-unit-card:hover { transform: translateY(-1px); box-shadow: 0 3px 8px rgba(0,0,0,0.07); }
        .sm-unit-label { font-size: 15.5px; font-weight: 800; color: var(--c); line-height: 1.4; }
        .sm-unit-stat { font-size: 11.5px; color: #6B7280; margin-top: 6px; line-height: 1.6; }
        .sm-unit-review { color: #C8323D; font-weight: 700; }
        .sm-bar { height: 4px; background: #EDEBE3; border-radius: 2px; margin-top: 8px; overflow: hidden; }
        .sm-bar > div { height: 100%; background: var(--c); }

        .sm-unit-box { max-width: 720px; margin: 0 auto; background: #fff; border: 2px solid var(--c); border-radius: 10px; padding: 16px 18px; }
        .sm-unit-box-title { font-size: 20px; font-weight: 800; color: var(--c); }
        .sm-unit-box-desc { font-size: 12.5px; color: #6B7280; line-height: 1.8; margin: 6px 0 14px; }
        .sm-start-btns { display: flex; flex-direction: column; gap: 10px; }
        .sm-big-btn { border: none; background: var(--c); color: #fff; border-radius: 10px; padding: 16px; font-weight: 800; font-size: 16px; cursor: pointer; width: 100%; }
        .sm-big-btn.outline { background: #fff; color: #C8323D; border: 2px solid #C8323D; }
        .sm-big-btn:disabled { background: #D8D5CB; cursor: default; }
        .sm-level-row { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 12px; }
        .sm-item-dots { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 10px; }
        .sm-item-dot { width: 26px; height: 26px; border-radius: 6px; font-size: 11px; display: flex; align-items: center; justify-content: center; border: 1px solid #D8D5CB; color: #9AA093; background: #fff; }
        .sm-item-dot.o { background: #EAF3EC; border-color: #7DB592; color: #1F6B45; font-weight: 700; }
        .sm-item-dot.x { background: #FCF2F2; border-color: #E2A0A5; color: #C8323D; font-weight: 700; }

        .sm-quiz { max-width: 720px; margin: 0 auto; scroll-margin-top: 12px; }
        .sm-quiz-head { display: flex; justify-content: space-between; align-items: center; font-size: 12.5px; color: #9AA093; font-weight: 700; margin-bottom: 8px; }
        .sm-quiz-head-right { display: flex; align-items: center; gap: 8px; }
        .sm-level { display: inline-block; font-size: 11px; font-weight: 800; color: var(--c); border: 1.5px solid var(--c); border-radius: 999px; padding: 1px 8px; background: #fff; white-space: nowrap; }
        .sm-progress-bar { height: 4px; background: #EDEBE3; border-radius: 2px; overflow: hidden; margin-bottom: 16px; }
        .sm-progress-bar > div { height: 100%; transition: width 0.2s ease; }
        .sm-stem { font-size: 17px; line-height: 2; font-weight: 600; margin-bottom: 14px; white-space: pre-wrap; background: #fff; border: 1px solid #E4E2DA; border-radius: 10px; padding: 14px 16px; }
        .sm-figure { background: #fff; border: 1px solid #E4E2DA; border-radius: 10px; padding: 10px; margin-bottom: 14px; text-align: center; }
        .sm-figure svg { width: 100%; max-width: 340px; height: auto; display: inline-block; }

        .sm-frac { display: inline-flex; flex-direction: column; align-items: center; vertical-align: middle; line-height: 1.15; margin: 0 2px; font-size: 0.92em; }
        .sm-frac-bar { display: block; height: 1.5px; background: currentColor; width: 100%; min-width: 0.9em; margin: 1px 0; }
        .sm-frac-line { display: inline-flex; align-items: center; }
        .sm-frac-alt { font-size: 12px; color: #6B7280; margin-left: 8px; display: inline-flex; align-items: center; }

        .sm-answer-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; background: #FBFAF6; border: 1px solid #E4E2DA; border-radius: 10px; padding: 12px 14px; }
        .sm-answer-label { font-size: 13px; font-weight: 800; color: #6B7280; }
        .sm-input { font-size: 20px; padding: 8px 10px; width: 140px; border: 2px solid #D8D5CB; border-radius: 8px; background: #fff; font-family: inherit; text-align: center; }
        .sm-input:focus { outline: none; border-color: ${ACCENT}; }
        .sm-input:disabled { background: #F2F1EC; color: #4B5563; }
        .sm-input-whole { width: 72px; }
        .sm-input-small { width: 72px; font-size: 18px; padding: 5px 6px; }
        .sm-frac-input { display: inline-flex; flex-direction: column; align-items: center; gap: 2px; }
        .sm-frac-bar.wide { width: 80px; height: 2px; background: #2A2E27; }
        .sm-unit { font-size: 16px; font-weight: 700; }
        .sm-answer-hint { font-size: 11px; color: #9AA093; flex-basis: 100%; }
        .sm-choices { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 8px; }
        .sm-choices.list { grid-template-columns: 1fr; }
        .sm-choices.list .sm-choice { text-align: left; font-size: 15.5px; font-weight: 600; line-height: 1.6; padding: 12px 14px; }
        .sm-input-text { width: min(260px, 100%); font-size: 20px; }
        .sm-passage { background: #FFFDF7; border: 1px solid #E4D9BF; border-radius: 10px; margin-bottom: 12px; overflow: hidden; }
        .sm-passage-head { width: 100%; display: flex; justify-content: space-between; align-items: center; gap: 8px; background: #FBF5E6; border: none; padding: 10px 14px; font-size: 13.5px; font-weight: 800; color: #6B5A2E; cursor: pointer; font-family: inherit; text-align: left; }
        .sm-passage-toggle { font-size: 12px; font-weight: 700; white-space: nowrap; }
        .sm-passage-text { font-size: 15.5px; line-height: 2.1; white-space: pre-wrap; padding: 12px 16px 16px; max-height: 46vh; overflow-y: auto; }
        .sm-choice { border: 2px solid #D8D5CB; background: #fff; border-radius: 10px; padding: 14px 10px; font-size: 17px; font-weight: 700; cursor: pointer; font-family: inherit; color: #2A2E27; }
        .sm-choice.picked { border-color: ${ACCENT}; background: #EEF3F8; }
        .sm-choice.correct { border-color: #1F6B45; background: #F1F8F3; }
        .sm-choice.wrong { border-color: #C8323D; background: #FCF2F2; }

        .sm-judge { margin-top: 14px; border-radius: 10px; padding: 14px 16px; border: 2px solid; }
        .sm-judge.ok { border-color: #7DB592; background: #F1F8F3; }
        .sm-judge.ng { border-color: #E2A0A5; background: #FCF2F2; }
        .sm-judge-title { font-size: 18px; font-weight: 800; }
        .sm-judge.ok .sm-judge-title { color: #1F6B45; }
        .sm-judge.ng .sm-judge-title { color: #C8323D; }
        .sm-judge-reason { font-size: 13px; color: #8A3324; margin-top: 4px; }
        .sm-judge-answer { font-size: 16px; font-weight: 800; margin-top: 8px; display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
        .sm-explain-title { font-size: 11px; font-weight: 800; color: #6B7280; letter-spacing: 1px; margin-top: 12px; }
        .sm-explain { font-size: 14.5px; line-height: 2; white-space: pre-wrap; margin-top: 4px; background: #fff; border-radius: 8px; padding: 10px 12px; }

        .sm-quiz-foot { display: flex; justify-content: space-between; align-items: center; margin-top: 16px; gap: 10px; }
        .sm-btn { border: none; background: var(--c); color: #fff; border-radius: 8px; padding: 13px 22px; font-weight: 800; font-size: 15px; cursor: pointer; font-family: inherit; }
        .sm-btn:disabled { background: #D8D5CB; cursor: not-allowed; }
        .sm-btn-ghost { border: 1px solid #D8D5CB; background: #fff; border-radius: 8px; padding: 11px 16px; font-size: 13.5px; cursor: pointer; font-family: inherit; color: #2A2E27; }

        .sm-result { max-width: 560px; margin: 24px auto; text-align: center; }
        .sm-result-unit { font-size: 14px; font-weight: 800; }
        .sm-result-pct { font-size: 56px; font-weight: 800; }
        .sm-result-sub { font-size: 14px; color: #6B7280; margin-top: 4px; }
        .sm-result-note { font-size: 13px; color: #6B7280; line-height: 1.8; margin: 12px 0 18px; }
        .sm-wrong-list { text-align: left; background: #fff; border: 1px solid #E4E2DA; border-radius: 10px; padding: 12px 14px; margin-bottom: 18px; }
        .sm-wrong-row { display: flex; gap: 8px; align-items: baseline; padding: 6px 0; border-top: 1px solid #EEE; font-size: 13px; line-height: 1.6; }
        .sm-wrong-q { color: #4B5563; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
        .sm-result-btns { display: flex; flex-direction: column; gap: 10px; align-items: center; }

        .sm-stat-row { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
        .sm-stat-name { font-size: 12.5px; width: 170px; flex-shrink: 0; }
        .sm-stat-track { flex: 1; height: 8px; background: #EDEBE3; border-radius: 4px; overflow: hidden; }
        .sm-stat-fill { height: 100%; background: var(--c); }
        .sm-stat-num { font-size: 11.5px; color: #6B7280; width: 120px; text-align: right; flex-shrink: 0; }
        @media (max-width: 480px) { .sm-stat-name { width: 110px; } .sm-stat-num { width: 92px; } }
        .sm-box { max-width: 720px; margin: 24px auto 0; background: #FBFAF6; border: 1px solid #E4E2DA; border-radius: 10px; padding: 16px 18px; }
        .sm-box-desc { font-size: 12.5px; color: #6B7280; line-height: 1.7; margin-bottom: 10px; }
        .sm-backup-row { display: flex; gap: 8px; flex-wrap: wrap; }
        .sm-backup-msg { margin-top: 8px; padding: 8px 10px; border-radius: 8px; font-size: 13px; line-height: 1.6; }
        .sm-backup-msg.ok { background: #EAF3EC; color: #2F5D3A; }
        .sm-backup-msg.ng { background: #F7E9E7; color: #8A3324; }
        .sm-empty { text-align: center; padding: 40px 20px; color: #9AA093; }
      `}</style>

      <div className="sm-top-nav">
        <div style={{ display: "flex", gap: 12 }}>
          <button className="sm-back-link" onClick={onExitApp}>他のアプリへ</button>
          <button className="sm-back-link" onClick={() => setScreen("progress")}>📊 学習記録</button>
        </div>
        <div className="sm-version">
          <span>v{APP_VERSION}</span>
          <span>{BUILD_DATE}</span>
        </div>
      </div>

      {screen === "units" && (
        <>
          <div className="sm-title-block">
            <div className="sm-eyebrow">{subject.eyebrow}</div>
            <h1 className="sm-serif">{subject.title}</h1>
            <div className="sm-under" />
            <div className="sm-lead">{subject.lead}</div>
          </div>
          <div className="sm-facts">
            <div className="sm-fact"><div className="sm-fact-num">{getStreak(subject)}</div><div className="sm-fact-label">日連続</div></div>
            <div className="sm-fact"><div className="sm-fact-num">{getTodayStats(subject).attempted}</div><div className="sm-fact-label">きょう解いた</div></div>
            <div className="sm-fact"><div className="sm-fact-num">{totalAttempted}</div><div className="sm-fact-label">のべ解答数</div></div>
            <div className="sm-fact"><div className="sm-fact-num">{getTotalReviewCount(subject)}</div><div className="sm-fact-label">復習待ち</div></div>
          </div>
          {subject.categories.map((c) => (
            <React.Fragment key={c.id}>
              <div className="sm-sub-head"><span className="sm-cat-dot" style={{ "--c": c.color }} />{c.label}</div>
              <div className="sm-unit-grid">
                {allStats.filter((x) => x.u.category === c.id).map(({ u, s, review }) => {
                  const pct = accuracyPercent(s);
                  return (
                    <button key={u.id} className="sm-unit-card" style={{ "--c": u.color }} onClick={() => openUnit(u.id)}>
                      <div className="sm-unit-label">{u.label}</div>
                      <div className="sm-unit-stat">
                        {pct === null ? "未学習" : `正答率 ${pct}%・最終 ${shortDate(s.lastAt)}`}
                        {s.lastRun && <>　前回 {s.lastRun.correct}/{s.lastRun.total}</>}
                        {review > 0 && <span className="sm-unit-review">　復習 {review}問</span>}
                      </div>
                      <div className="sm-bar"><div style={{ width: `${pct ?? 0}%` }} /></div>
                    </button>
                  );
                })}
              </div>
            </React.Fragment>
          ))}
        </>
      )}

      {screen === "unit" && unit && (
        <div className="sm-inner">
          <button className="sm-back-link" style={{ marginBottom: 12 }} onClick={() => { setUnitId(null); setScreen("units"); }}>← 単元を選び直す</button>
          <div className="sm-unit-box" style={{ "--c": unit.color }}>
            <div className="sm-unit-box-title">{unit.label}</div>
            {(() => {
              const s = getUnitStats(subject, unit.id);
              const pct = accuracyPercent(s);
              return (
                <div className="sm-unit-box-desc">
                  {pct === null ? "まだ解いていません。" : `これまで ${s.attempted} 問・正答率 ${pct}%・最終学習日 ${shortDate(s.lastAt)}`}
                  {s.bestRun && <><br />いちばんよかった回：{s.bestRun.correct} / {s.bestRun.total} 問</>}
                </div>
              );
            })()}
            {loadError && <div className="sm-empty">問題を読みこめませんでした。通信を確かめてからもう一度開いてください。</div>}
            {!loadError && !questions && <div className="sm-empty">読み込んでいます…</div>}
            {questions && (
              <>
                <div className="sm-start-btns">
                  <button className="sm-big-btn" onClick={() => start(questions, false)}>{questions.length} 問を解く</button>
                  {(() => {
                    const ids = getReviewIds(subject, unit.id);
                    const qs = questions.filter((q) => ids.includes(q.id));
                    return (
                      <button className="sm-big-btn outline" disabled={!qs.length} onClick={() => start(qs, true)}>
                        {qs.length ? `まちがえた問題だけ復習（${qs.length}問）` : "復習する問題はありません"}
                      </button>
                    );
                  })()}
                </div>
                <div className="sm-level-row">
                  {["基本", "標準", "発展"].map((lv) => (
                    <span key={lv} className="sm-level" style={{ "--c": LEVEL_COLOR[lv] }}>
                      {lv} {questions.filter((q) => q.level === lv).length}問
                    </span>
                  ))}
                </div>
                {(() => {
                  const items = getUnitStats(subject, unit.id).items;
                  return (
                    <div className="sm-item-dots" aria-label="問題ごとの最後の結果">
                      {questions.map((q, i) => {
                        const it = items[q.id];
                        return <span key={q.id} className={`sm-item-dot ${it ? it.last : ""}`}>{i + 1}</span>;
                      })}
                    </div>
                  );
                })()}
              </>
            )}
          </div>
        </div>
      )}

      {screen === "quiz" && unit && session && (
        <Quiz
          key={session.id}
          subject={subject}
          unit={unit}
          questions={session.questions}
          passages={unitData ? unitData.passages : {}}
          review={session.review}
          onFinish={finish}
          onExit={() => { setNonce((n) => n + 1); setScreen("unit"); }}
        />
      )}

      {screen === "result" && unit && run && session && (
        <Result
          unit={unit}
          run={run}
          questions={session.questions}
          onRetryWrong={(qs) => start(qs, true)}
          onBack={() => { setUnitId(null); setScreen("units"); }}
        />
      )}

      {screen === "progress" && (
        <div className="sm-inner">
          <button className="sm-back-link" style={{ marginBottom: 12 }} onClick={() => setScreen(unitId ? "unit" : "units")}>← もどる</button>
          <div className="sm-title-block">
            <h1 className="sm-serif">学習記録</h1>
            <div className="sm-under" />
          </div>
          <div className="sm-facts">
            <div className="sm-fact"><div className="sm-fact-num">{getStreak(subject)}</div><div className="sm-fact-label">日連続</div></div>
            <div className="sm-fact"><div className="sm-fact-num">{getTodayStats(subject).attempted}</div><div className="sm-fact-label">きょう解いた</div></div>
            <div className="sm-fact"><div className="sm-fact-num">{totalAttempted}</div><div className="sm-fact-label">のべ解答数</div></div>
            <div className="sm-fact"><div className="sm-fact-num">{getTotalReviewCount(subject)}</div><div className="sm-fact-label">復習待ち</div></div>
          </div>
          <div className="sm-sub-head">単元ごとの正答率と最終学習日</div>
          <div style={{ maxWidth: 720, margin: "0 auto" }}>
            {allStats.map(({ u, s }) => {
              const pct = accuracyPercent(s);
              return (
                <div className="sm-stat-row" key={u.id} style={{ "--c": u.color }}>
                  <div className="sm-stat-name">{u.label}</div>
                  <div className="sm-stat-track"><div className="sm-stat-fill" style={{ width: `${pct ?? 0}%` }} /></div>
                  <div className="sm-stat-num">{pct === null ? "未学習" : `${pct}%（${s.attempted}問）${shortDate(s.lastAt)}`}</div>
                </div>
              );
            })}
          </div>
          <div className="sm-box">
            <div className="sm-box-desc">
              学習記録はこの端末のブラウザにだけ保存されます。別の端末に替えたときや、閲覧データを消したときに失われるので、
              ときどき書き出しておいてください。
            </div>
            <div className="sm-backup-row">
              <button className="sm-btn-ghost" onClick={handleBackupExport}>⬇ ファイルに書き出す</button>
              <button className="sm-btn-ghost" onClick={() => backupInputRef.current?.click()}>⬆ ファイルから戻す</button>
              <input ref={backupInputRef} type="file" accept="application/json,.json" style={{ display: "none" }} onChange={handleBackupImport} />
            </div>
            {backupMsg && <div className={`sm-backup-msg ${backupMsg.kind}`}>{backupMsg.text}</div>}
          </div>
          <div className="sm-box">
            <div className="sm-box-desc">{subject.title}の記録だけを消します（ほかの教科や英検・CCAO-F の記録はそのまま）。</div>
            <button className="sm-btn-ghost" onClick={() => { if (window.confirm(`${subject.title}の学習記録と復習リストをすべて消します。よろしいですか？`)) { resetProgress(subject); setNonce((n) => n + 1); } }}>
              学習記録をリセット
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
