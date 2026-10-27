/* ============================================================
   CCAO-F 音声読み上げの画面部品（v1.32.0〜）

   - SpeakButton：テキストの横の🔊。押すとそのテキストだけ読む。もう一度押すと止まる
   - AudioPlayer：音声モード（ハンズフリー）。トラックを順に自動で読み進める。
     一時停止／再開・前へ／次へ・速度・間・読む言語を切り替えられる
   - 音声が使えない端末では SpeakButton は出さず、音声モードは説明だけ出す
   ============================================================ */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  isSpeechSupported,
  hasVoice,
  onVoicesChanged,
  speakStep,
  stopSpeech,
  toggleSpeak,
  onSpeakingKeyChange,
  speakingKey,
  clearSpeakingKey,
  voicesFor,
  preferredVoice,
  setPreferredVoice,
} from "./speech";
import { LANGS, RATES, GAPS, normalizeSettings, filterTracks, pauseMs } from "./audioCore";

const SETTINGS_KEY = "ccaofAudioSettings";

function loadSettings(defaultZh) {
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (raw) return normalizeSettings(JSON.parse(raw));
  } catch (e) {
    // 読めなければ既定値
  }
  return normalizeSettings({ langs: { en: true, ja: true, zh: !!defaultZh } });
}

function saveSettings(s) {
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch (e) {
    // 保存できなくても今回の設定は効く
  }
}

/** 🔊ボタンの速度は音声モードの設定と同じものを使う */
function currentRate() {
  return loadSettings(false).rate;
}

export const AudioStyle = () => <style>{`
  .ccaof-say { display: inline-flex; align-items: center; justify-content: center; border: 1px solid #D8D5CB; background: #fff; border-radius: 999px; width: 26px; height: 26px; font-size: 12px; cursor: pointer; padding: 0; margin-left: 6px; vertical-align: middle; color: #4B5563; flex-shrink: 0; line-height: 1; }
  .ccaof-say.big { width: 34px; height: 34px; font-size: 15px; }
  .ccaof-say.on { background: #C8743D; border-color: #C8743D; color: #fff; }
  .ccaof-say:focus-visible { outline: 2px solid #C8743D; outline-offset: 2px; }
  .ccaof-audio-card { background: #fff; border: 2px solid #5B4B8A; border-radius: 10px; padding: 14px 16px; }
  .ccaof-audio-card-title { font-size: 15px; font-weight: 800; color: #5B4B8A; }
  .ccaof-audio-card-desc { font-size: 12.5px; color: #6B7280; line-height: 1.7; margin: 6px 0 10px; }
  .ccaof-audio-row { display: flex; gap: 8px; flex-wrap: wrap; }
  .ccaof-audio-na { font-size: 12.5px; color: #8A3324; background: #F7E9E7; border-radius: 8px; padding: 8px 10px; line-height: 1.6; }

  .ccaof-player { max-width: 720px; margin: 0 auto; }
  .ccaof-player-head { display: flex; justify-content: space-between; align-items: center; font-size: 12px; color: #9AA093; font-weight: 700; margin-bottom: 10px; gap: 10px; }
  .ccaof-player-now { background: #fff; border: 2px solid var(--c, #5B4B8A); border-radius: 12px; padding: 20px 18px; min-height: 190px; }
  .ccaof-player-title { font-size: 24px; font-weight: 800; text-align: center; word-break: break-word; }
  .ccaof-player-sub { font-size: 12.5px; color: #6B7280; text-align: center; margin-top: 4px; }
  .ccaof-player-text { font-size: 15px; line-height: 1.85; margin-top: 16px; padding: 10px 12px; background: #FBFAF6; border-left: 3px solid var(--c, #5B4B8A); border-radius: 4px; white-space: pre-wrap; }
  .ccaof-player-lang { display: inline-block; font-size: 10.5px; font-weight: 800; color: var(--c, #5B4B8A); border: 1px solid var(--c, #5B4B8A); border-radius: 999px; padding: 0 7px; margin-right: 6px; vertical-align: 1px; }
  .ccaof-player-state { text-align: center; font-size: 12px; color: #9AA093; margin-top: 10px; min-height: 18px; }
  .ccaof-player-progress { height: 4px; background: #EDEBE3; border-radius: 2px; margin-top: 12px; overflow: hidden; }
  .ccaof-player-progress > div { height: 100%; background: var(--c, #5B4B8A); }
  .ccaof-player-ctrl { display: grid; grid-template-columns: 1fr 1.4fr 1fr; gap: 10px; margin-top: 14px; }
  .ccaof-player-ctrl button { border: 2px solid var(--c, #5B4B8A); background: #fff; color: var(--c, #5B4B8A); border-radius: 12px; padding: 16px 6px; font-size: 16px; font-weight: 800; cursor: pointer; }
  .ccaof-player-ctrl button.main { background: var(--c, #5B4B8A); color: #fff; font-size: 18px; }
  .ccaof-player-ctrl button:disabled { opacity: 0.4; cursor: default; }
  .ccaof-player-set { background: #fff; border: 1px solid #E4E2DA; border-radius: 10px; padding: 10px 14px; margin-top: 14px; }
  .ccaof-player-set-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 6px 0; }
  .ccaof-player-set-row + .ccaof-player-set-row { border-top: 1px solid #F0EEE7; }
  .ccaof-player-set-label { font-size: 12px; font-weight: 800; color: #6B7280; min-width: 64px; }
  .ccaof-pchip { border: 1px solid #D8D5CB; background: #fff; border-radius: 999px; padding: 5px 12px; font-size: 12.5px; cursor: pointer; color: #4B5563; font-weight: 700; }
  .ccaof-pchip.on { background: var(--c, #5B4B8A); border-color: var(--c, #5B4B8A); color: #fff; }
  .ccaof-pchip small { font-weight: 400; opacity: 0.85; }
  .ccaof-voice-select { border: 1px solid #D8D5CB; border-radius: 8px; padding: 5px 8px; font-size: 12.5px; background: #fff; color: #374151; max-width: 100%; flex: 1 1 180px; min-width: 0; }
  .ccaof-player-note { font-size: 11.5px; color: #9AA093; line-height: 1.7; margin-top: 10px; }
`}</style>;

/**
 * テキストの横に置く🔊。segments は [{lang, text}]、text だけ渡せば lang の1つぶん。
 * 選択肢のボタンの中にも置けるよう、<button> ではなく role="button" の span にする
 * （button の中に button は置けない）。
 */
export function SpeakButton({ text, lang = "en", segments, big, label }) {
  const segs = useMemo(() => (segments || [{ lang, text }]).filter((s) => s && s.text), [segments, lang, text]);
  const key = useMemo(() => segs.map((s) => `${s.lang}:${s.text}`).join("|"), [segs]);
  const [on, setOn] = useState(() => speakingKey() === key);
  useEffect(() => onSpeakingKeyChange((k) => setOn(k === key)), [key]);
  if (!isSpeechSupported() || !segs.length) return null;
  const run = (e) => {
    e.stopPropagation();
    e.preventDefault();
    toggleSpeak(key, segs, currentRate());
  };
  return (
    <span
      role="button"
      tabIndex={0}
      className={"ccaof-say" + (big ? " big" : "") + (on ? " on" : "")}
      onClick={run}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") run(e);
      }}
      aria-label={on ? "読み上げを止める" : label || "読み上げる"}
      title={on ? "止める" : label || "読み上げる"}
    >
      {on ? "■" : "🔊"}
    </span>
  );
}

/** 問題・カードを切り替えたら、前の問題の読み上げを止める */
export function useStopSpeechOn(dep) {
  useEffect(() => () => stopSpeech(), [dep]);
}

/** 音声モードの入り口に出す。使えない端末では説明だけ */
export function AudioUnsupported() {
  return (
    <div className="ccaof-audio-na">
      この端末のブラウザは音声読み上げ（Web Speech API）に対応していないため、音声モードは使えません。
      iPhone・iPad は Safari、パソコンは Chrome・Edge・Safari の最新版で使えます。
    </div>
  );
}

/* ---------- 音声モード（ハンズフリー） ---------- */

const ZH_SAMPLE = "你好，这是标准普通话的朗读。我们来学习写出有效的提示词。";

/** 声の名前を短く：「Microsoft Xiaoxiao Online (Natural) - Chinese (Mainland)」→「Xiaoxiao Online (Natural)」 */
function voiceLabel(v) {
  const name = String(v.name || "").replace(/^Microsoft\s+/i, "").replace(/\s+-\s+.*$/, "").trim();
  const region = /tw|hant/i.test(v.lang || "") ? "・台湾" : "";
  return `${name}${region}${v.localService ? "" : "・ネット"}`;
}

function useVoiceAvailability() {
  const [, setN] = useState(0);
  useEffect(() => onVoicesChanged(() => setN((n) => n + 1)), []);
  return Object.fromEntries(LANGS.map(({ id }) => [id, hasVoice(id)]));
}

/* 画面が消えると読み上げが止まる端末（iPhone など）があるので、再生中は画面をつけておく */
function useWakeLock(active) {
  useEffect(() => {
    if (!active || typeof navigator === "undefined" || !navigator.wakeLock) return undefined;
    let lock = null;
    let cancelled = false;
    const acquire = () => {
      navigator.wakeLock
        .request("screen")
        .then((l) => {
          if (cancelled) l.release().catch(() => {});
          else lock = l;
        })
        .catch(() => {});
    };
    acquire();
    const onVis = () => {
      if (document.visibilityState === "visible") acquire();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVis);
      if (lock) lock.release().catch(() => {});
    };
  }, [active]);
}

/**
 * @param {{
 *   title: string, color?: string, tracks: object[],
 *   defaultZh?: boolean,
 *   onTrackDone?: (track) => void,   // 1トラックを最後まで聞いたとき（記録用）
 *   onExit: () => void, exitLabel?: string, recordNote?: string,
 * }} props
 */
export function AudioPlayer({ title, color = "#5B4B8A", tracks: rawTracks, defaultZh, needLang, onTrackDone, onExit, exitLabel = "もどる", recordNote }) {
  const [settings, setSettings] = useState(() => loadSettings(defaultZh));
  const tracks = useMemo(() => filterTracks(rawTracks, settings.langs), [rawTracks, settings.langs]);
  const [pos, setPos] = useState({ t: 0, s: 0 });
  const [status, setStatus] = useState("ready"); // ready | playing | paused | done
  const [heard, setHeard] = useState(0);
  const voices = useVoiceAvailability();

  /* 再生ループは1本だけ動かす。止める・飛ばすたびに番号を進め、古いループは自分で終わる */
  const runId = useRef(0);
  const timer = useRef(null);
  const latest = useRef({ tracks, settings, onTrackDone });
  latest.current = { tracks, settings, onTrackDone };

  const wake = useRef(null);
  const halt = useCallback(() => {
    runId.current += 1;
    clearTimeout(timer.current);
    if (wake.current) wake.current(false);
    stopSpeech();
  }, []);

  useEffect(() => {
    clearSpeakingKey();
    return () => halt();
  }, [halt]);

  useWakeLock(status === "playing");

  const wait = (ms, my) =>
    new Promise((resolve) => {
      wake.current = resolve;
      timer.current = setTimeout(() => resolve(my === runId.current), ms);
    });

  /* 呼び出し（タップ）の中で最初の speak() まで同期で進むよう、await より前に読み始める */
  const play = useCallback((from) => {
    halt();
    const my = runId.current;
    setStatus("playing");
    let { t, s } = from;
    const loop = async () => {
      while (my === runId.current) {
        const { tracks: ts, settings: st } = latest.current;
        if (t >= ts.length) {
          setStatus("done");
          return;
        }
        const track = ts[t];
        if (s >= track.steps.length) {
          if (latest.current.onTrackDone) latest.current.onTrackDone(track);
          setHeard((n) => n + 1);
          t += 1;
          s = 0;
          setPos({ t, s });
          continue;
        }
        setPos({ t, s });
        const step = track.steps[s];
        const ok = await speakStep(step, st.rate);
        if (!ok || my !== runId.current) return;
        if (!(await wait(pauseMs(step.pause, st), my))) return;
        s += 1;
      }
    };
    loop();
  }, [halt]);

  const pause = () => {
    halt();
    setStatus("paused");
  };

  const jump = (t) => {
    const nt = Math.max(0, Math.min(tracks.length - 1, t));
    if (status === "playing") play({ t: nt, s: 0 });
    else {
      halt();
      setPos({ t: nt, s: 0 });
      if (status === "done") setStatus("paused");
    }
  };

  const updateSettings = (patch) => {
    const next = normalizeSettings({ ...settings, ...patch, langs: { ...settings.langs, ...(patch.langs || {}) } });
    setSettings(next);
    saveSettings(next);
  };

  /* 言語を切り替えるとトラックの中身が変わる。読んでいる途中なら、そのトラックの頭から読み直す */
  const langsKey = LANGS.map(({ id }) => (settings.langs[id] ? id : "")).join();
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const t = Math.min(pos.t, Math.max(0, tracks.length - 1));
    if (status === "playing") play({ t, s: 0 });
    else setPos({ t, s: 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [langsKey]);

  /* 速度・間を変えたら、今の文から読み直す（すぐに効いたと分かるように） */
  const rateKey = `${settings.rate}/${settings.gap}`;
  const firstRate = useRef(true);
  useEffect(() => {
    if (firstRate.current) {
      firstRate.current = false;
      return;
    }
    if (status === "playing") play(pos);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rateKey]);

  if (!isSpeechSupported()) {
    return (
      <div className="ccaof-player">
        <AudioStyle />
        <AudioUnsupported />
        <div style={{ textAlign: "center", marginTop: 16 }}>
          <button className="ccaof-btn-ghost" onClick={onExit}>{exitLabel}</button>
        </div>
      </div>
    );
  }

  const track = tracks[Math.min(pos.t, tracks.length - 1)];
  const step = track && track.steps[Math.min(pos.s, track.steps.length - 1)];
  const langLabel = (id) => (LANGS.find((l) => l.id === id) || {}).label || id;
  const zhVoices = voicesFor("zh");
  const zhChoice = zhVoices.some((v) => (v.voiceURI || v.name) === preferredVoice("zh")) ? preferredVoice("zh") : "";
  const zhAuto = zhVoices[0];
  const missing = LANGS.filter(({ id }) => settings.langs[id] && voices[id] === false);
  /* 讲义のように本文が1つの言語だけのとき、その言語が OFF なら知らせる */
  const needOff = needLang && !settings.langs[needLang];
  const needBanner = needOff && (
    <div className="ccaof-audio-na" style={{ marginBottom: 10 }}>
      本文は{langLabel(needLang)}です。いまは {langLabel(needLang)} が OFF なので、英語の見出しだけを読みます。
      <button className="ccaof-pchip on" style={{ marginLeft: 8 }} onClick={() => updateSettings({ langs: { [needLang]: true } })}>
        {langLabel(needLang)}を ON にする
      </button>
    </div>
  );

  const settingsPanel = (
    <div className="ccaof-player-set" style={{ "--c": color }}>
      <div className="ccaof-player-set-row">
        <span className="ccaof-player-set-label">速度</span>
        {RATES.map((r) => (
          <button key={r} className={"ccaof-pchip" + (settings.rate === r ? " on" : "")} onClick={() => updateSettings({ rate: r })}>
            {r === 1 ? "1.0" : r}倍
          </button>
        ))}
      </div>
      <div className="ccaof-player-set-row">
        <span className="ccaof-player-set-label">間</span>
        {GAPS.map((g) => (
          <button key={g.id} className={"ccaof-pchip" + (settings.gap === g.id ? " on" : "")} onClick={() => updateSettings({ gap: g.id })}>
            {g.label}
          </button>
        ))}
      </div>
      <div className="ccaof-player-set-row">
        <span className="ccaof-player-set-label">読む言語</span>
        {LANGS.map(({ id, label }) => (
          <button
            key={id}
            className={"ccaof-pchip" + (settings.langs[id] ? " on" : "")}
            aria-pressed={settings.langs[id]}
            onClick={() => updateSettings({ langs: { [id]: !settings.langs[id] } })}
          >
            {settings.langs[id] ? "✓ " : ""}{label}
            {voices[id] === false && <small>（声なし）</small>}
          </button>
        ))}
      </div>
      {zhVoices.length > 0 && (
        <div className="ccaof-player-set-row">
          <span className="ccaof-player-set-label">中文の声</span>
          <select
            className="ccaof-voice-select"
            value={zhChoice}
            onChange={(e) => setPreferredVoice("zh", e.target.value)}
            aria-label="中文の声"
          >
            <option value="">おまかせ（{zhAuto ? voiceLabel(zhAuto) : "普通话"}）</option>
            {zhVoices.map((v) => (
              <option key={v.voiceURI || v.name} value={v.voiceURI || v.name}>{voiceLabel(v)}</option>
            ))}
          </select>
          <SpeakButton lang="zh" text={ZH_SAMPLE} label="中文の声を試す" />
        </div>
      )}
      {missing.length > 0 && (
        <div className="ccaof-player-note">
          この端末には {missing.map((m) => m.label).join("・")} の声が入っていないようです。
          端末の設定（読み上げ・音声コンテンツ）で声を追加すると読めるようになります。
        </div>
      )}
    </div>
  );

  if (!tracks.length) {
    return (
      <div className="ccaof-player">
        <AudioStyle />
        <div className="ccaof-player-head"><span>🎧 {title}</span></div>
        {needBanner}
        <div className="ccaof-empty">
          いま選んでいる言語では読める内容がありません。
          {rawTracks.length > 0 && "下の「読む言語」で 中文 などを ON にしてください（讲义は中文です）。"}
        </div>
        {settingsPanel}
        <div style={{ textAlign: "center", marginTop: 16 }}>
          <button className="ccaof-btn-ghost" onClick={onExit}>{exitLabel}</button>
        </div>
      </div>
    );
  }

  if (status === "done") {
    return (
      <div className="ccaof-result">
        <AudioStyle />
        <div className="ccaof-result-pct" style={{ "--c": color }}>🎧 {heard}</div>
        <div className="ccaof-result-sub">{title}：{tracks.length}件のうち {heard}件を最後まで聞きました</div>
        {recordNote && <div className="ccaof-result-note">{recordNote}</div>}
        <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
          <button className="ccaof-btn-ghost" onClick={() => { setHeard(0); play({ t: 0, s: 0 }); }}>もう一度はじめから</button>
          <button className="ccaof-btn" style={{ "--c": color }} onClick={onExit}>{exitLabel}</button>
        </div>
      </div>
    );
  }

  const playing = status === "playing";
  const progress = ((pos.t + (track ? pos.s / track.steps.length : 0)) / tracks.length) * 100;

  return (
    <div className="ccaof-player" style={{ "--c": color }}>
      <AudioStyle />
      <div className="ccaof-player-head">
        <span>🎧 {title}</span>
        <span>{pos.t + 1} / {tracks.length}</span>
      </div>
      {needBanner}
      <div className="ccaof-player-now" aria-live="polite">
        <div className="ccaof-player-title">{track.title}</div>
        {track.subtitle && <div className="ccaof-player-sub">{track.subtitle}</div>}
        {step && (
          <div className="ccaof-player-text">
            <span className="ccaof-player-lang">{langLabel(step.lang)}</span>
            {step.text}
          </div>
        )}
        <div className="ccaof-player-state">
          {playing ? "読み上げ中…" : status === "paused" ? "一時停止中（再開するとこの文の頭から）" : "▶ を押すと始まります。あとは画面を見なくても自動で進みます"}
        </div>
        <div className="ccaof-player-progress"><div style={{ width: `${progress}%` }} /></div>
      </div>

      <div className="ccaof-player-ctrl">
        <button onClick={() => jump(pos.t - 1)} disabled={pos.t === 0} aria-label="前へ">⏮ 前へ</button>
        {playing ? (
          <button className="main" onClick={pause} aria-label="一時停止">⏸ 一時停止</button>
        ) : (
          <button className="main" onClick={() => play(pos)} aria-label={status === "paused" ? "再開" : "再生"}>
            ▶ {status === "paused" ? "再開" : "再生"}
          </button>
        )}
        <button onClick={() => jump(pos.t + 1)} disabled={pos.t + 1 >= tracks.length} aria-label="次へ">次へ ⏭</button>
      </div>

      {settingsPanel}

      <div className="ccaof-player-note">
        読み上げは端末に入っている声（ブラウザの Web Speech API）を使います。画面を消したりほかのアプリに切り替えたりすると止まる端末があるので、
        再生中は画面をつけたままにしてください（対応している端末では自動で消えないようにしています）。
        {recordNote ? ` ${recordNote}` : ""}
      </div>

      <div style={{ textAlign: "center", marginTop: 16 }}>
        <button className="ccaof-back-link" onClick={() => { halt(); onExit(); }}>{exitLabel}</button>
      </div>
    </div>
  );
}
