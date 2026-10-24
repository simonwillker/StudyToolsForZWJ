import React, { useState, Suspense, lazy } from "react";
import { LEARNERS, getLearner, setLearner, clearLearner, getLastLearner, learnerKey, canUseApp } from "./learner";
import { migrateActiveApp } from "./sapixStorage";
import { migrateClaudeCertApp } from "./claudeCert/certs";

/* アプリ本体は選んだほうだけ読む。
   きょうのドリルを使う日に英検の問題まで読み込む必要はない。 */
const DailyDrill = lazy(() => import("./DailyDrill.jsx"));
const EikenApp = lazy(() => import("./EikenApp.jsx"));
const ClaudeCertApp = lazy(() => import("./claudeCert/ClaudeCertApp.jsx"));
const SapixApp = lazy(() => import("./SapixApp.jsx"));
const StudyHistory = lazy(() => import("./StudyHistory.jsx"));

function AppLoading() {
  return (
    <div style={{ minHeight: "100vh", background: "#F7F6F2", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Zen Kaku Gothic New', 'Hiragino Sans', sans-serif", color: "#6B7280", fontSize: 14 }}>
      読み込んでいます…
    </div>
  );
}

const APP_STORAGE_KEY = "studyToolsActiveApp";

/**
 * その勉強者が最後に開いたアプリ（勉強者ごとに覚える。ZWJ は以前からのキー）。
 * その人が使わないアプリだったときはアプリ選択画面から。v1.28.0 までの Sapix の科目別の値（"sapixMath" など）は
 * "sapix" に直して保存し直し、その科目（4年）を開く。
 * v1.31.0 までの "ccaof"（CCAO-F 対策）は "claudeCert"（Claude 認定）に直し、CCAO-F を開く。
 */
function loadInitialApp(learner) {
  try {
    const key = learnerKey(APP_STORAGE_KEY, learner);
    const stored = window.localStorage.getItem(key);
    const c = migrateClaudeCertApp(stored);
    const m = { ...migrateActiveApp(c.app), cert: c.cert };
    if (stored && m.app !== stored) window.localStorage.setItem(key, m.app);
    if (learner && !canUseApp(learner, m.app)) return { app: "menu", course: null, cert: null };
    return m;
  } catch (e) {
    return { app: "menu", course: null, cert: null };
  }
}

/** アプリの中でも、だれの記録になっているかが見えるように画面のすみに出す */
function LearnerBadge({ learner }) {
  const l = LEARNERS.find((x) => x.id === learner);
  if (!l) return null;
  return (
    <div
      style={{
        position: "fixed", left: 10, bottom: 10, zIndex: 50, background: "#fff", border: `1.5px solid ${l.color}`,
        color: l.color, borderRadius: 999, padding: "3px 10px", fontSize: 12, fontWeight: 800,
        fontFamily: "'Zen Kaku Gothic New', 'Hiragino Sans', sans-serif", boxShadow: "0 1px 4px rgba(0,0,0,0.08)", pointerEvents: "none",
      }}
    >
      👤 {l.label}
    </div>
  );
}

/** 起動したら、まずだれが勉強するかを選ぶ */
function LearnerPicker({ onPick }) {
  const last = getLastLearner();
  return (
    <div className="app-switcher">
      <style>{`
        .app-switcher { min-height: 100vh; background: #F7F6F2; font-family: 'Zen Kaku Gothic New', 'Hiragino Sans', sans-serif; display: flex; align-items: center; justify-content: center; padding: 24px 16px; }
        .app-switcher-inner { max-width: 520px; width: 100%; text-align: center; }
        .app-switcher-eyebrow { font-size: 11px; letter-spacing: 2px; color: #9AA093; font-weight: 700; }
        .app-switcher-title { font-family: 'Shippori Mincho', serif; font-size: 30px; margin: 8px 0 24px; }
        .learner-grid { display: flex; flex-direction: column; gap: 14px; }
        .learner-card { border: 2px solid var(--c); border-radius: 12px; padding: 20px; background: #fff; cursor: pointer; font-size: 24px; font-weight: 800; color: var(--c); display: flex; align-items: center; justify-content: space-between; }
        .learner-card:hover { box-shadow: 0 4px 12px rgba(0,0,0,0.08); }
        .learner-card small { font-size: 12px; font-weight: 700; color: #9AA093; }
      `}</style>
      <div className="app-switcher-inner">
        <div className="app-switcher-eyebrow">STUDY TOOLS FOR ZWJ</div>
        <div className="app-switcher-title">だれが勉強しますか？</div>
        <div className="learner-grid">
          {LEARNERS.map((l) => (
            <button key={l.id} className="learner-card" style={{ "--c": l.color }} onClick={() => onPick(l.id)}>
              <span>👤 {l.label}</span>
              <small>{last === l.id ? "前回・" : ""}{l.note}</small>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [initial] = useState(() => loadInitialApp(getLearner()));
  const [activeApp, setActive] = useState(initial.app);
  // 旧形式から移したときだけ、開いていた科目をそのまま開く（最初の 1 回だけ）
  const [sapixCourse, setSapixCourse] = useState(initial.course);
  const [initialCert, setInitialCert] = useState(initial.cert);
  const [learner, setLearnerState] = useState(getLearner);

  // 人によって使うアプリがちがうので、選んだ人が前回開いていたアプリから始める
  const pickLearner = (id) => {
    setLearner(id);
    setLearnerState(id);
    const m = loadInitialApp(id);
    setActive(m.app);
    setSapixCourse(m.course);
    setInitialCert(m.cert);
  };

  const switchLearner = () => {
    clearLearner();
    setLearnerState(null);
  };

  const choose = (id) => {
    setActive(id);
    setSapixCourse(null);
    setInitialCert(null);
    // 勉強履歴は次に開いたときの最初の画面にはしない
    if (id === "history") return;
    try {
      window.localStorage.setItem(learnerKey(APP_STORAGE_KEY, learner), id);
    } catch (e) {
      // 無視（localStorageが使えない環境）
    }
  };

  const backToMenu = () => choose("menu");

  // 学習記録は勉強者ごとに分けて保存するので、選ぶまではアプリを開かない
  if (!learner) return <LearnerPicker onPick={pickLearner} />;
  // その人が使わないアプリは開かない（念のため。メニューには出していない）
  const active = canUseApp(learner, activeApp) ? activeApp : "menu";
  const show = (app) => canUseApp(learner, app);

  if (active === "drill")
    return (
      <Suspense fallback={<AppLoading />}>
        <DailyDrill onExitApp={backToMenu} />
        <LearnerBadge learner={learner} />
      </Suspense>
    );
  if (active === "eiken")
    return (
      <Suspense fallback={<AppLoading />}>
        <EikenApp onExitApp={backToMenu} />
        <LearnerBadge learner={learner} />
      </Suspense>
    );
  if (active === "claudeCert")
    return (
      <Suspense fallback={<AppLoading />}>
        <ClaudeCertApp initialCert={initialCert} onExitApp={backToMenu} />
        <LearnerBadge learner={learner} />
      </Suspense>
    );
  if (active === "sapix")
    return (
      <Suspense fallback={<AppLoading />}>
        <SapixApp initialCourse={sapixCourse} onExitApp={backToMenu} />
        <LearnerBadge learner={learner} />
      </Suspense>
    );
  if (active === "history")
    return (
      <Suspense fallback={<AppLoading />}>
        <StudyHistory learner={learner} onBack={backToMenu} />
      </Suspense>
    );

  return (
    <div className="app-switcher">
      <style>{`
        .app-switcher {
          min-height: 100vh;
          background: #F7F6F2;
          font-family: 'Zen Kaku Gothic New', 'Hiragino Sans', sans-serif;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px 16px;
        }
        .app-switcher-inner { max-width: 520px; width: 100%; text-align: center; }
        .app-switcher-eyebrow { font-size: 11px; letter-spacing: 2px; color: #9AA093; font-weight: 700; }
        .app-switcher-title { font-family: 'Shippori Mincho', serif; font-size: 30px; margin: 8px 0 24px; }
        .app-switcher-grid { display: flex; flex-direction: column; gap: 14px; }
        .app-switcher-card {
          border: 2px solid var(--c); border-radius: 12px; padding: 22px; background: #fff;
          cursor: pointer; text-align: left; transition: transform 0.1s ease, box-shadow 0.15s ease;
        }
        .app-switcher-card:hover { transform: translateY(-2px); box-shadow: 0 4px 12px rgba(0,0,0,0.08); }
        .app-switcher-card .label { font-size: 19px; font-weight: 800; color: var(--c); }
        .app-switcher-learner { display: flex; align-items: center; justify-content: center; gap: 12px; margin: -10px 0 20px; font-size: 15px; color: #2B2E28; }
        .app-switcher-learner button { background: none; border: none; color: #6B7280; text-decoration: underline; cursor: pointer; font-size: 13px; }
        .app-switcher-card .desc { font-size: 13px; color: #6B7280; margin-top: 6px; line-height: 1.6; }
      `}</style>
      <div className="app-switcher-inner">
        <div className="app-switcher-eyebrow">STUDY TOOLS FOR {learner.toUpperCase()}</div>
        <div className="app-switcher-title">学習アプリを選ぶ</div>
        <div className="app-switcher-learner">
          <span>👤 <b>{learner}</b> さん</span>
          <button onClick={switchLearner}>勉強者を切りかえる</button>
        </div>
        <div className="app-switcher-grid">
          {show("drill") && (
            <button className="app-switcher-card" style={{ "--c": "#2F5D8A" }} onClick={() => choose("drill")}>
              <div className="label">きょうのドリル</div>
              <div className="desc">小学生向けの算数・国語・理科・社会ドリル、カスタム単語・漢字テスト</div>
            </button>
          )}
          {show("eiken") && (
            <button className="app-switcher-card" style={{ "--c": "#8A3B2F" }} onClick={() => choose("eiken")}>
              <div className="label">英検マスター</div>
              <div className="desc">英検5級〜1級対応。単語・文法穴うめ・長文読解・リスニング・会話文・発音練習、学習記録つき</div>
            </button>
          )}
          {show("claudeCert") && (
            <button className="app-switcher-card" style={{ "--c": "#C8743D" }} onClick={() => choose("claudeCert")}>
              <div className="label">Claude 認定</div>
              <div className="desc">Claude 認定資格の対策。CCAO-F（Associate）・CCDV-F（Developer）・CCAR-F（Architect）から選ぶ。ドメイン別練習・模擬試験・考点讲义・錯題本・合格予測・頻出単語つき</div>
            </button>
          )}
          {show("sapix") && (
            <button className="app-switcher-card" style={{ "--c": "#2F7A8A" }} onClick={() => choose("sapix")}>
              <div className="label">Sapix</div>
              <div className="desc">学年 → 科目（算数・国語・理科・社会・英語）→ 単元の順に選ぶ。いまは4年（冬期講習相当、英語は英検5級〜4級程度）。解説・まちがえた問題の復習・単元ごとの正答率つき</div>
            </button>
          )}
          <button className="app-switcher-card" style={{ "--c": "#5A3B8A" }} onClick={() => choose("history")}>
            <div className="label">📅 勉強履歴</div>
            <div className="desc">毎日、何をどれだけ勉強したか（解いた数・正解率・時間帯）を勉強者ごとに見られる</div>
          </button>
        </div>
      </div>
    </div>
  );
}
