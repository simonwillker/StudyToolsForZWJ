import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./index.css";

// オフラインでも使えるように Service Worker を登録する。
// 開発サーバーでは登録しない（ビルド前のファイルをキャッシュしても混乱するだけ）。
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`)
      .catch(() => {
        // 登録できない環境（プライベートbrowsing等）でも、
        // オンラインであればアプリ自体は普通に動く
      });
  });
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
