import React, { useState } from "react";
import { formatDateTime } from "./eikenTestResults";

/* ============================================================
   英検マスター：得点推移の小さな縦棒グラフ（単語テスト・模擬テストで共用）
   results は古い→新しいの順（{ at, correct, total, percent }）。
   1系列なので凡例は出さず、見出しで名前を示す。値はキャプションとツールチップで出す。
   見た目のクラス（eiken-vt-*）は EikenApp.jsx の <style>。
   ============================================================ */

export default function ScoreTrend({ results, color, describe = () => "", empty = "まだ受けていません。" }) {
  const [hover, setHover] = useState(null);
  if (!results.length) return <div className="eiken-empty-note">{empty}</div>;
  const last = results[results.length - 1];
  const shown = hover != null && results[hover] ? results[hover] : last;
  return (
    <div className="eiken-vt-trend" style={{ "--c": color }}>
      <div className="eiken-vt-chart" role="img" aria-label={`得点推移：直近${results.length}回、最新 ${last.percent}%`}>
        <div className="eiken-vt-grid" style={{ bottom: "50%" }} />
        <div className="eiken-vt-grid" style={{ bottom: "100%" }} />
        {results.map((r, i) => (
          <div
            key={`${r.at}-${i}`}
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
        {formatDateTime(shown.at)}　{describe(shown)}
        <b>
          {shown.correct}/{shown.total}（{shown.percent}%）
        </b>
      </div>
    </div>
  );
}
