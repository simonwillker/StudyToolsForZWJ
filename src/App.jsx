import React, { useState } from "react";
import DailyDrill from "./DailyDrill.jsx";
import EikenApp from "./EikenApp.jsx";

const APP_STORAGE_KEY = "studyToolsActiveApp";

function loadInitialApp() {
  try {
    return window.localStorage.getItem(APP_STORAGE_KEY) || "menu";
  } catch (e) {
    return "menu";
  }
}

export default function App() {
  const [active, setActive] = useState(loadInitialApp);

  const choose = (id) => {
    setActive(id);
    try {
      window.localStorage.setItem(APP_STORAGE_KEY, id);
    } catch (e) {
      // 無視（localStorageが使えない環境）
    }
  };

  const backToMenu = () => choose("menu");

  if (active === "drill") return <DailyDrill onExitApp={backToMenu} />;
  if (active === "eiken") return <EikenApp onExitApp={backToMenu} />;

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
        .app-switcher-card .desc { font-size: 13px; color: #6B7280; margin-top: 6px; line-height: 1.6; }
      `}</style>
      <div className="app-switcher-inner">
        <div className="app-switcher-eyebrow">STUDY TOOLS FOR ZWJ</div>
        <div className="app-switcher-title">学習アプリを選ぶ</div>
        <div className="app-switcher-grid">
          <button className="app-switcher-card" style={{ "--c": "#2F5D8A" }} onClick={() => choose("drill")}>
            <div className="label">きょうのドリル</div>
            <div className="desc">小学生向けの算数・国語・理科・社会・英語ドリル、英検2級単語テスト</div>
          </button>
          <button className="app-switcher-card" style={{ "--c": "#8A3B2F" }} onClick={() => choose("eiken")}>
            <div className="label">英検マスター</div>
            <div className="desc">英検5級〜1級対応。単語・文法穴うめ・長文読解・リスニング・会話文・発音練習、学習記録つき</div>
          </button>
        </div>
      </div>
    </div>
  );
}
