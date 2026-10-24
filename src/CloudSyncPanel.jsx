import React, { useEffect, useState } from "react";
import { getSyncConfig, setSyncConfig, getSyncStatus, onSyncStatus, syncNow } from "./cloudSync";

/* ============================================================
   アプリ選択画面の「☁️ 記録の同期（GitHub）」

   設定はこの端末にだけ保存する（トークンをほかへ送らない）。
   端末ごとに 1 回、リポジトリとトークンを入れれば、以後は自動で同期する。
   ============================================================ */

const DEFAULT_OWNER = "simonwillker";
const DEFAULT_REPO = "StudyToolsData";

function when(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export default function CloudSyncPanel() {
  const [cfg, setCfg] = useState(getSyncConfig);
  const [status, setStatus] = useState(getSyncStatus);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState(() => ({ owner: (cfg && cfg.owner) || DEFAULT_OWNER, repo: (cfg && cfg.repo) || DEFAULT_REPO, token: "" }));

  useEffect(() => onSyncStatus(setStatus), []);

  const run = async () => {
    setBusy(true);
    await syncNow();
    setBusy(false);
  };

  const save = async () => {
    if (!form.owner.trim() || !form.repo.trim() || !form.token.trim()) return;
    setSyncConfig(form);
    setCfg(getSyncConfig());
    setEditing(false);
    setForm((f) => ({ ...f, token: "" }));
    await run();
    // 取り込んだ記録を画面に出すため読み直す
    window.location.reload();
  };

  const stop = () => {
    setSyncConfig(null);
    setCfg(null);
    setEditing(false);
  };

  return (
    <div className="cloud-sync">
      <style>{`
        .cloud-sync { margin-top: 18px; background: #fff; border: 1.5px dashed #C9CEC3; border-radius: 12px; padding: 14px 16px; text-align: left; font-size: 13px; color: #2B2E28; }
        .cloud-sync-title { font-weight: 800; font-size: 15px; }
        .cloud-sync-status { margin-top: 4px; color: #6B7280; line-height: 1.6; }
        .cloud-sync-status.ng { color: #B42318; }
        .cloud-sync-row { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px; }
        .cloud-sync button { border: 1.5px solid #5A3B8A; background: #fff; color: #5A3B8A; border-radius: 8px; padding: 6px 12px; font-weight: 700; cursor: pointer; font-size: 13px; }
        .cloud-sync button.primary { background: #5A3B8A; color: #fff; }
        .cloud-sync button:disabled { opacity: 0.5; cursor: default; }
        .cloud-sync label { display: block; margin-top: 8px; font-weight: 700; }
        .cloud-sync input { width: 100%; box-sizing: border-box; margin-top: 3px; padding: 7px 9px; border: 1.5px solid #D8DCD3; border-radius: 8px; font-size: 14px; }
        .cloud-sync-help { margin-top: 8px; color: #6B7280; line-height: 1.6; }
      `}</style>
      <div className="cloud-sync-title">☁️ 記録の同期（GitHub）</div>
      {cfg ? (
        <div className={`cloud-sync-status ${status.ok === false ? "ng" : ""}`}>
          {cfg.owner}/{cfg.repo} と同期しています。
          {status.at && <><br />{when(status.at)}：{status.message}</>}
        </div>
      ) : (
        <div className="cloud-sync-status">
          いまは記録がこの端末の中だけにあります。設定すると iPad・iPhone・PC のどれで勉強しても同じ記録になります。
        </div>
      )}

      {!editing && (
        <div className="cloud-sync-row">
          {cfg && <button className="primary" disabled={busy} onClick={run}>{busy ? "同期中…" : "今すぐ同期"}</button>}
          <button onClick={() => setEditing(true)}>{cfg ? "設定を変える" : "設定する"}</button>
        </div>
      )}

      {editing && (
        <div>
          <label>
            GitHub のユーザー名
            <input value={form.owner} onChange={(e) => setForm({ ...form, owner: e.target.value })} autoCapitalize="off" autoCorrect="off" />
          </label>
          <label>
            記録を置く非公開リポジトリ
            <input value={form.repo} onChange={(e) => setForm({ ...form, repo: e.target.value })} autoCapitalize="off" autoCorrect="off" />
          </label>
          <label>
            トークン（fine-grained token）
            <input type="password" value={form.token} placeholder={cfg ? "変えるときだけ入力" : "github_pat_…"} onChange={(e) => setForm({ ...form, token: e.target.value })} autoCapitalize="off" autoCorrect="off" />
          </label>
          <div className="cloud-sync-help">
            トークンはこの端末にだけ保存します。権限は「そのリポジトリだけ・Contents の Read and write」にしてください。
          </div>
          <div className="cloud-sync-row">
            <button className="primary" disabled={busy || !form.token.trim()} onClick={save}>保存して同期</button>
            <button onClick={() => setEditing(false)}>やめる</button>
            {cfg && <button onClick={stop}>この端末の同期をやめる</button>}
          </div>
        </div>
      )}
    </div>
  );
}
