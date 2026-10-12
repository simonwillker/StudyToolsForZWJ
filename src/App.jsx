import React, { useState, Suspense, lazy } from "react";
import { LEARNERS, getLearner, setLearner, clearLearner, getLastLearner } from "./learner";

/* アプリ本体は選んだほうだけ読む。
   きょうのドリルを使う日に英検の問題まで読み込む必要はない。 */
const DailyDrill = lazy(() => import("./DailyDrill.jsx"));
const EikenApp = lazy(() => import("./EikenApp.jsx"));
const CcaofApp = lazy(() => import("./CcaofApp.jsx"));
const SapixApp = lazy(() => import("./SapixApp.jsx"));
/** Sapix の4教科。どれも SapixApp を教科を変えて使う */
const SAPIX_APPS = ["sapixMath", "sapixKokugo", "sapixShakai", "sapixRika"];
const StudyHistory = lazy(() => import("./StudyHistory.jsx"));

function AppLoading() {
  return (
    <div style={{ minHeight: "100vh", background: "#F7F6F2", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Zen Kaku Gothic New', 'Hiragino Sans', sans-serif", color: "#6B7280", fontSize: 14 }}>
      読み込んでいます…
    </div>
  );
}

const APP_STORAGE_KEY = "studyToolsActiveApp";

function loadInitialApp() {
  try {
    return window.localStorage.getItem(APP_STORAGE_KEY) || "menu";
  } catch (e) {
    return "menu";
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
              {last === l.id && <small>前回</small>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [active, setActive] = useState(loadInitialApp);
  const [learner, setLearnerState] = useState(getLearner);

  const pickLearner = (id) => {
    setLearner(id);
    setLearnerState(id);
  };

  const switchLearner = () => {
    clearLearner();
    setLearnerState(null);
  };

  const choose = (id) => {
    setActive(id);
    // 勉強履歴は次に開いたときの最初の画面にはしない
    if (id === "history") return;
    try {
      window.localStorage.setItem(APP_STORAGE_KEY, id);
    } catch (e) {
      // 無視（localStorageが使えない環境）
    }
  };

  const backToMenu = () => choose("menu");

  // 学習記録は勉強者ごとに分けて保存するので、選ぶまではアプリを開かない
  if (!learner) return <LearnerPicker onPick={pickLearner} />;

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
  if (active === "ccaof")
    return (
      <Suspense fallback={<AppLoading />}>
        <CcaofApp onExitApp={backToMenu} />
        <LearnerBadge learner={learner} />
      </Suspense>
    );
  if (SAPIX_APPS.includes(active))
    return (
      <Suspense fallback={<AppLoading />}>
        <SapixApp key={active} subjectId={active} onExitApp={backToMenu} />
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
        <div className="app-switcher-eyebrow">STUDY TOOLS FOR ZWJ</div>
        <div className="app-switcher-title">学習アプリを選ぶ</div>
        <div className="app-switcher-learner">
          <span>👤 <b>{learner}</b> さん</span>
          <button onClick={switchLearner}>勉強者を切りかえる</button>
        </div>
        <div className="app-switcher-grid">
          <button className="app-switcher-card" style={{ "--c": "#2F5D8A" }} onClick={() => choose("drill")}>
            <div className="label">きょうのドリル</div>
            <div className="desc">小学生向けの算数・国語・理科・社会ドリル、カスタム単語・漢字テスト</div>
          </button>
          <button className="app-switcher-card" style={{ "--c": "#8A3B2F" }} onClick={() => choose("eiken")}>
            <div className="label">英検マスター</div>
            <div className="desc">英検5級〜1級対応。単語・文法穴うめ・長文読解・リスニング・会話文・発音練習、学習記録つき</div>
          </button>
          <button className="app-switcher-card" style={{ "--c": "#C8743D" }} onClick={() => choose("ccaof")}>
            <div className="label">CCAO-F 対策</div>
            <div className="desc">Claude Certified Associate – Foundations の練習問題。公式ブループリントの7ドメイン別、ドメイン別正答率つき</div>
          </button>
          <button className="app-switcher-card" style={{ "--c": "#2F7A8A" }} onClick={() => choose("sapixMath")}>
            <div className="label">Sapix 算数</div>
            <div className="desc">小4 冬期講習相当の15単元×20問（計算のくふう・つるかめ算・角度・場合の数など）。解き方の解説・まちがえた問題の復習・単元ごとの正答率つき</div>
          </button>
          <button className="app-switcher-card" style={{ "--c": "#9A4A2F" }} onClick={() => choose("sapixKokugo")}>
            <div className="label">Sapix 国語</div>
            <div className="desc">小4 冬期講習相当の10単元×20問。漢字の読み書き・慣用句・ことわざ・四字熟語・文法・説明文と物語文の読解</div>
          </button>
          <button className="app-switcher-card" style={{ "--c": "#3F6F52" }} onClick={() => choose("sapixShakai")}>
            <div className="label">Sapix 社会</div>
            <div className="desc">小4 冬期講習相当の10単元×20問。地図の見方・都道府県・地形・気候・農業・水産業・工業・くらし</div>
          </button>
          <button className="app-switcher-card" style={{ "--c": "#6A4A9A" }} onClick={() => choose("sapixRika")}>
            <div className="label">Sapix 理科</div>
            <div className="desc">小4 冬期講習相当の10単元×20問。植物・こん虫・季節・星・月・太陽・電気・磁石・温まり方・水のすがた</div>
          </button>
          <button className="app-switcher-card" style={{ "--c": "#5A3B8A" }} onClick={() => choose("history")}>
            <div className="label">📅 勉強履歴</div>
            <div className="desc">毎日、何をどれだけ勉強したか（解いた数・正解率・時間帯）を勉強者ごとに見られる</div>
          </button>
        </div>
      </div>
    </div>
  );
}
