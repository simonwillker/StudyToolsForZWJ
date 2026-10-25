import React from "react";
import { parseFraction, toMixed } from "./sapixSubjects";

/* ============================================================
   Sapix：問題の表示部品（単元練習・今日の復習・まとめテストで共用）
   SapixApp.jsx から切り出したもの。見た目のクラス（sm-*）は SapixApp.jsx の <style>。
   ============================================================ */

export const LEVEL_COLOR = { 基本: "#2F7A4F", 標準: "#C8743D", 発展: "#C8323D" };

export function shortDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/** 分数を縦書き（分子／線／分母）で表示する */
export function Frac({ n, d }) {
  return (
    <span className="sm-frac">
      <span>{n}</span>
      <span className="sm-frac-bar" />
      <span>{d}</span>
    </span>
  );
}

/** 正解の表示。分数は帯分数（1より大きいとき）と仮分数を両方出す */
export function AnswerText({ q }) {
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
export function RichText({ text, fractions = true }) {
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

export function Figure({ q }) {
  if (!q.figure) return null;
  // 図は問題データ（リポジトリ内の JSON）にある SVG。検証スクリプトでスクリプトを含まないことを確かめている
  return <div className="sm-figure" role="img" aria-label={q.figureAlt || "図"} dangerouslySetInnerHTML={{ __html: q.figure }} />;
}

export function AnswerInput({ q, order, input, setInput, disabled, onEnter }) {
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
