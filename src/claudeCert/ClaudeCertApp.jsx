/* ============================================================
   Claude 認定（トップの 1 枚のカード）

   中で資格（CCAO-F / CCAR-F、のちに CCDV-F / CCAR-P）を選ぶ。
   資格を選んだら activateCert() でデータと保存キーを切り替えてから
   共通の画面（CertApp.jsx）を開く。CCAO-F の保存キーは v1.31.0 までと
   同じなので、これまでの学習記録はそのまま出る。
   ============================================================ */

import React, { useState } from "react";
import { learnerKey } from "../learner";
import { CERTS, findCert } from "./certs";
import { activateCert, getCertMeta } from "./domains";
import CertApp from "./CertApp";

const LAST_CERT_KEY = "claudeCertLastCert";

function readJson(key) {
  try {
    const raw = window.localStorage.getItem(learnerKey(key));
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

/** 一覧に出す、その資格のこれまでの記録 */
function certSummary(cert) {
  const progress = readJson(`${cert.prefix}ProgressV1`) || {};
  let attempted = 0;
  let correct = 0;
  Object.values(progress.domains || {}).forEach((d) => {
    attempted += d.attempted || 0;
    correct += d.correct || 0;
  });
  const results = readJson(`${cert.prefix}ExamResultsV1`);
  return { attempted, correct, exams: Array.isArray(results) ? results.length : 0 };
}

function loadLastCert() {
  try {
    return window.localStorage.getItem(LAST_CERT_KEY);
  } catch (e) {
    return null;
  }
}

export default function ClaudeCertApp({ onExitApp, initialCert = null }) {
  const [certId, setCertId] = useState(() => {
    if (initialCert && findCert(initialCert) && getCertMeta(initialCert)) {
      activateCert(initialCert);
      return initialCert;
    }
    return null;
  });
  const last = loadLastCert();

  const open = (id) => {
    activateCert(id);
    try {
      window.localStorage.setItem(LAST_CERT_KEY, id);
    } catch (e) {
      // 覚えておけなくても開ける
    }
    setCertId(id);
    window.scrollTo(0, 0);
  };

  if (certId) {
    return <CertApp key={certId} onExitApp={onExitApp} onBackToCerts={() => setCertId(null)} />;
  }

  return (
    <div className="cc-picker">
      <style>{`
        .cc-picker { min-height: 100vh; background: #F7F6F2; font-family: 'Zen Kaku Gothic New', 'Hiragino Sans', sans-serif; color: #2A2E27; padding: 28px 16px 60px; }
        .cc-inner { max-width: 720px; margin: 0 auto; }
        .cc-back { font-size: 13px; color: #6B7280; cursor: pointer; text-decoration: underline; text-underline-offset: 3px; background: none; border: none; padding: 0; }
        .cc-title-block { text-align: center; margin: 12px 0 20px; }
        .cc-eyebrow { font-size: 11px; letter-spacing: 2px; color: #9AA093; font-weight: 700; }
        .cc-title { font-family: 'Shippori Mincho', serif; font-size: 28px; margin: 6px 0; }
        .cc-under { width: 40px; height: 3px; background: #C8743D; margin: 0 auto; }
        .cc-lead { font-size: 12.5px; color: #6B7280; line-height: 1.7; max-width: 560px; margin: 12px auto 0; }
        .cc-grid { display: flex; flex-direction: column; gap: 12px; }
        .cc-card { border: 2px solid var(--c); border-radius: 12px; padding: 16px 18px; background: #fff; cursor: pointer; text-align: left; width: 100%; font: inherit; color: inherit; }
        .cc-card:hover:not(:disabled) { box-shadow: 0 4px 12px rgba(0,0,0,0.08); transform: translateY(-1px); }
        .cc-card:disabled { cursor: default; opacity: 0.55; border-style: dashed; }
        .cc-top { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; }
        .cc-code { font-size: 20px; font-weight: 800; color: var(--c); }
        .cc-badge { font-size: 11px; font-weight: 800; color: var(--c); white-space: nowrap; }
        .cc-name { font-size: 12.5px; color: #4B5563; margin-top: 2px; }
        .cc-desc { font-size: 12px; color: #6B7280; margin-top: 6px; line-height: 1.6; }
        .cc-stat { font-size: 11.5px; color: #6B7280; margin-top: 6px; }
      `}</style>
      <div className="cc-inner">
        <button className="cc-back" onClick={onExitApp}>他のアプリへ</button>
        <div className="cc-title-block">
          <div className="cc-eyebrow">CLAUDE CERTIFICATION PROGRAM</div>
          <h1 className="cc-title">Claude 認定</h1>
          <div className="cc-under" />
          <div className="cc-lead">
            資格を選んでください。どの資格も、ドメイン別練習・模擬試験・考点讲义・考点別の成績と弱点練習・
            錯題本（今日の復習）・合格予測・頻出単語が使えます。学習記録は資格ごとに別に保存されます。
          </div>
        </div>
        <div className="cc-grid">
          {CERTS.map((c) => {
            const ready = c.status === "ready" && !!getCertMeta(c.id);
            const meta = ready ? getCertMeta(c.id) : null;
            const sum = ready ? certSummary(c) : null;
            return (
              <button key={c.id} className="cc-card" style={{ "--c": c.color }} disabled={!ready} onClick={() => open(c.id)} data-testid={`cert-${c.id}`}>
                <div className="cc-top">
                  <span className="cc-code">{c.code}</span>
                  <span className="cc-badge">{ready ? (last === c.id ? "前回" : "") : "準備中"}</span>
                </div>
                <div className="cc-name">{c.name}</div>
                <div className="cc-desc">{c.audience}</div>
                {ready && (
                  <div className="cc-stat">
                    {meta.domains.length} ドメイン・{meta.domains.reduce((n, d) => n + d.objectives.length, 0)} 考点
                    {meta.scenarios ? `・${meta.scenarios.length} シナリオ` : ""}
                    {" ／ "}
                    {sum.attempted ? `これまで ${sum.attempted}問（正答率 ${Math.round((sum.correct / sum.attempted) * 100)}%）・模試 ${sum.exams}回` : "まだ未学習"}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
