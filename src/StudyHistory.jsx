import React, { useMemo, useState } from "react";
import { LEARNERS } from "./learner";
import { getDailySummaries } from "./studyLog";

/* ============================================================
   勉強履歴：日ごとに、何をどれだけ勉強したかを一覧する。
   勉強者のタブで、ほかの人の履歴も見られる（家族で見せ合う用）。
   ============================================================ */

const WEEKDAY = ["日", "月", "火", "水", "木", "金", "土"];
const PAGE_DAYS = 14;

function dayLabel(date) {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((today - dt) / 86400000);
  const base = `${m}月${d}日（${WEEKDAY[dt.getDay()]}）`;
  if (diff === 0) return `今日 ${base}`;
  if (diff === 1) return `昨日 ${base}`;
  return y === today.getFullYear() ? base : `${y}年${base}`;
}

function clock(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function pct(correct, attempted) {
  return attempted ? Math.round((correct / attempted) * 100) : 0;
}

/** ⭕❌の並び。長いときは先頭だけ出して残りの数を添える */
function Marks({ marks, attempted }) {
  if (!marks) return null;
  const SHOW = 50;
  const head = marks.slice(0, SHOW);
  const rest = attempted - head.length;
  return (
    <div className="sh-marks" aria-label="1問ごとの正解と不正解">
      {head.split("").map((m, i) => (m === "o" ? "⭕" : "❌")).join("")}
      {rest > 0 && <span className="sh-marks-rest">　ほか{rest}問</span>}
    </div>
  );
}

export default function StudyHistory({ learner, onBack }) {
  const [who, setWho] = useState(learner);
  const [shown, setShown] = useState(PAGE_DAYS);
  const days = useMemo(() => getDailySummaries(who), [who]);
  const color = (LEARNERS.find((l) => l.id === who) || LEARNERS[0]).color;

  return (
    <div className="study-history">
      <style>{`
        .study-history { min-height: 100vh; background: #F7F6F2; font-family: 'Zen Kaku Gothic New', 'Hiragino Sans', sans-serif; padding: 20px 16px 40px; color: #2B2E28; }
        .study-history-inner { max-width: 640px; margin: 0 auto; }
        .sh-back { background: none; border: none; color: #6B7280; font-size: 14px; cursor: pointer; padding: 0; text-decoration: underline; }
        .sh-title { font-family: 'Shippori Mincho', serif; font-size: 26px; margin: 14px 0 4px; }
        .sh-who { font-size: 15px; margin-bottom: 12px; color: #6B7280; }
        .sh-who b { color: var(--c); font-size: 18px; }
        .sh-tabs { display: flex; gap: 8px; margin-bottom: 16px; flex-wrap: wrap; }
        .sh-tab { border: 2px solid var(--c); background: #fff; color: var(--c); border-radius: 999px; padding: 6px 16px; font-weight: 800; font-size: 14px; cursor: pointer; }
        .sh-tab.active { background: var(--c); color: #fff; }
        .sh-day { background: #fff; border: 1px solid #E4E2DA; border-radius: 12px; padding: 14px 16px; margin-bottom: 12px; }
        .sh-day-head { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; flex-wrap: wrap; padding-bottom: 8px; }
        .sh-day-date { font-weight: 800; font-size: 16px; }
        .sh-day-total { font-size: 13px; color: #6B7280; }
        .sh-day-total b { color: var(--c); font-size: 15px; }
        .sh-run { padding: 10px 0; border-top: 1px dashed #E4E2DA; font-size: 14px; }
        .sh-run-top { display: flex; justify-content: space-between; gap: 8px; align-items: baseline; }
        .sh-run-time { font-size: 12px; color: #6B7280; font-variant-numeric: tabular-nums; white-space: nowrap; }
        .sh-run-app { font-size: 11.5px; color: #9AA093; font-weight: 700; }
        .sh-run-label { font-weight: 800; }
        .sh-run-round { display: inline-block; margin-left: 6px; font-size: 11.5px; font-weight: 800; color: var(--c); border: 1px solid var(--c); border-radius: 999px; padding: 0 7px; }
        .sh-run-score { margin-top: 4px; font-size: 14px; font-variant-numeric: tabular-nums; }
        .sh-run-score small { color: #6B7280; }
        .sh-marks { margin-top: 4px; font-size: 13px; line-height: 1.5; letter-spacing: 1px; word-break: break-all; }
        .sh-marks-rest { font-size: 12px; color: #6B7280; letter-spacing: 0; }
        .sh-note { font-size: 11.5px; color: #9AA093; margin-top: 6px; }
        .sh-empty { background: #fff; border: 1px dashed #D8DCD3; border-radius: 12px; padding: 24px; text-align: center; color: #6B7280; font-size: 14px; }
        .sh-more { display: block; margin: 8px auto 0; background: #fff; border: 1.5px solid #D8DCD3; border-radius: 10px; padding: 8px 18px; cursor: pointer; font-size: 14px; }
      `}</style>
      <div className="study-history-inner" style={{ "--c": color }}>
        <button className="sh-back" onClick={onBack}>← アプリの選択にもどる</button>
        <h1 className="sh-title">📅 勉強履歴</h1>
        <div className="sh-who">勉強者：<b>👤 {who}</b></div>
        <div className="sh-tabs">
          {LEARNERS.map((l) => (
            <button
              key={l.id}
              className={`sh-tab ${who === l.id ? "active" : ""}`}
              style={{ "--c": l.color }}
              onClick={() => { setWho(l.id); setShown(PAGE_DAYS); }}
            >
              {l.label}
            </button>
          ))}
        </div>

        {days.length === 0 ? (
          <div className="sh-empty">{who} さんの勉強履歴はまだありません。<br />問題を解くと、その日の内容がここに記録されます。</div>
        ) : (
          days.slice(0, shown).map((d) => (
            <div key={d.date} className="sh-day">
              <div className="sh-day-head">
                <div className="sh-day-date">{dayLabel(d.date)}</div>
                <div className="sh-day-total">
                  {d.firstAt ? `${clock(d.firstAt)}〜${clock(d.lastAt)}　` : ""}テスト <b>{d.tests}</b>回 ・ ⭕ {d.correct} ❌ {d.attempted - d.correct}
                </div>
              </div>
              {d.sessions.map((x, i) => (
                <div key={i} className="sh-run">
                  <div className="sh-run-top">
                    <div>
                      <div className="sh-run-app">{x.app}</div>
                      <div>
                        <span className="sh-run-label">{x.label}</span>
                        <span className="sh-run-round">第{x.round}回</span>
                      </div>
                    </div>
                    <div className="sh-run-time">{x.startAt ? `${clock(x.startAt)}〜${clock(x.endAt)}` : "時刻不明"}</div>
                  </div>
                  <div className="sh-run-score">
                    ⭕ {x.correct}　❌ {x.attempted - x.correct}　<small>（{x.attempted}問・正解率 {pct(x.correct, x.attempted)}%）</small>
                  </div>
                  <Marks marks={x.marks} attempted={x.attempted} />
                </div>
              ))}
              {d.legacy && <div className="sh-note">※ 勉強履歴を記録し始める前の日なので、残っていた記録から作った概要です（回の区切りは目安）。</div>}
            </div>
          ))
        )}
        {days.length > shown && (
          <button className="sh-more" onClick={() => setShown((n) => n + PAGE_DAYS)}>もっと前の日を見る</button>
        )}
      </div>
    </div>
  );
}
