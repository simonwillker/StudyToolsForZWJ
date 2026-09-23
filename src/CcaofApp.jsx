import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  DOMAINS,
  BLUEPRINT,
  EXAM_FORMAT,
  findDomain,
  peekDomainItems,
  loadDomainItems,
  examBlueprintCounts,
} from "./ccaofDomains";
import {
  recordAnswer,
  recordReviewResult,
  getDomainStats,
  getAllDomainStats,
  accuracyPercent,
  getReviewIds,
  getReviewCount,
  getStreak,
  getTodayStats,
  resetProgress,
} from "./ccaofProgress";

const APP_VERSION = __APP_VERSION__;
const BUILD_DATE = __BUILD_DATE__;

/** 英検と同じく20問1組で出す */
const UNIT_SIZE = 20;

const OFFICIAL_LINKS = [
  { label: "Claude 認定プログラム（Pearson VUE） ↗", url: "https://www.pearsonvue.com/us/en/anthropic.html" },
  { label: "Claude ドキュメント ↗", url: "https://docs.claude.com/" },
  { label: "Anthropic 利用ポリシー ↗", url: "https://www.anthropic.com/legal/aup" },
];

/* 問題データは正解を choices[0] に置いていることがある。
   英検アプリで全モードが「1番目を押せば必ず正解」になっていた事故があったので、
   出題のたびに必ず並べ替える。 */
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function buildQuestions(items) {
  return shuffle(items).map((item) => ({
    ...item,
    selectCount: item.selectCount || 1,
    choices: shuffle(item.choices),
  }));
}

function unitCount(total) {
  return Math.max(1, Math.ceil(total / UNIT_SIZE));
}

function DomainLoading({ label }) {
  return (
    <div className="ccaof-loading">
      <div className="ccaof-spinner" />
      <div className="ccaof-loading-text">{label}</div>
    </div>
  );
}

/* ============================================================
   出題画面
   ============================================================ */

function Quiz({ domain, questions, onExit }) {
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState([]);
  const [submitted, setSubmitted] = useState(false);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);

  const q = questions[index];
  const total = questions.length;

  const toggle = (i) => {
    if (submitted) return;
    setPicked((prev) => {
      if (prev.includes(i)) return prev.filter((x) => x !== i);
      // 選ぶ数に達していたら、いちばん古い選択を外して入れ替える
      if (prev.length >= q.selectCount) return [...prev.slice(1), i];
      return [...prev, i];
    });
  };

  const submit = () => {
    if (submitted || picked.length !== q.selectCount) return;
    // 複数選択は完全一致のみ正解。本番も部分点はない
    const correctIdx = q.choices.map((c, i) => (c.correct ? i : -1)).filter((i) => i >= 0);
    const ok =
      picked.length === correctIdx.length && correctIdx.every((i) => picked.includes(i));
    setSubmitted(true);
    if (ok) setScore((s) => s + 1);
    recordAnswer(domain.id, q.id, ok);
    recordReviewResult(domain.id, q.id, ok);
  };

  const next = () => {
    if (index + 1 >= total) {
      setDone(true);
      return;
    }
    setIndex(index + 1);
    setPicked([]);
    setSubmitted(false);
  };

  if (!total) {
    return (
      <div className="ccaof-empty">
        このドメインにはまだ問題が入っていません。
        <div style={{ marginTop: 10 }}>
          <button className="ccaof-btn-ghost" onClick={onExit}>もどる</button>
        </div>
      </div>
    );
  }

  if (done) {
    const pct = Math.round((score / total) * 100);
    return (
      <div className="ccaof-result">
        <div className="ccaof-result-pct" style={{ "--c": domain.color }}>{pct}%</div>
        <div className="ccaof-result-sub">{total}問中 {score}問 正解</div>
        <div className="ccaof-result-note">
          本番は1000点満点で720点が合格。ここでの正答率はそのまま点数にはなりませんが、
          72%を下回るうちは同じドメインを解き直すのが近道です。
        </div>
        <button className="ccaof-btn" style={{ "--c": domain.color }} onClick={onExit}>ドメイン選択にもどる</button>
      </div>
    );
  }

  const correctIdx = q.choices.map((c, i) => (c.correct ? i : -1)).filter((i) => i >= 0);

  return (
    <div className="ccaof-quiz">
      <div className="ccaof-quiz-head">
        <span>{index + 1} / {total} 問</span>
        <span className="ccaof-quiz-domain" style={{ "--c": domain.color }}>{domain.label}</span>
      </div>

      {q.material && <div className="ccaof-material">{q.material}</div>}
      <div className="ccaof-stem">{q.stem}</div>
      {q.selectCount > 1 && (
        <div className="ccaof-select-hint">{q.selectCount}つ選んでください（{picked.length}/{q.selectCount} 選択中）</div>
      )}

      <div className="ccaof-choices">
        {q.choices.map((c, i) => {
          const isPicked = picked.includes(i);
          let cls = "ccaof-choice";
          if (submitted) {
            if (c.correct) cls += " correct";
            else if (isPicked) cls += " wrong";
          } else if (isPicked) cls += " picked";
          return (
            <button key={i} className={cls} onClick={() => toggle(i)} disabled={submitted}>
              <div className="ccaof-choice-text">{c.text}</div>
              {submitted && <div className="ccaof-choice-explain">{c.explain}</div>}
            </button>
          );
        })}
      </div>

      {submitted && (
        <div className="ccaof-source">
          出典：<a href={q.reference} target="_blank" rel="noopener noreferrer">{q.reference}</a>
          <span className="ccaof-reviewed">（最終確認 {q.reviewedAt}）</span>
        </div>
      )}

      <div className="ccaof-quiz-foot">
        <button className="ccaof-btn-ghost" onClick={onExit}>やめる</button>
        {submitted ? (
          <button className="ccaof-btn" style={{ "--c": domain.color }} onClick={next}>
            {index + 1 >= total ? "結果を見る" : "次の問題"}
          </button>
        ) : (
          <button
            className="ccaof-btn"
            style={{ "--c": domain.color }}
            onClick={submit}
            disabled={picked.length !== q.selectCount}
          >
            答え合わせ
          </button>
        )}
      </div>
      <div className="ccaof-answer-count">
        {submitted ? `正解は${correctIdx.length}つ` : ""}
      </div>
    </div>
  );
}

/* ============================================================
   メイン
   ============================================================ */

export default function CcaofApp({ onExitApp }) {
  const [screen, setScreen] = useState("domainSelect"); // domainSelect | unitSelect | quiz | progress
  const [domainId, setDomainId] = useState(null);
  const [items, setItems] = useState(null);
  const [loadError, setLoadError] = useState(false);
  const [loadNonce, setLoadNonce] = useState(0);
  const [questions, setQuestions] = useState([]);
  const [statsNonce, setStatsNonce] = useState(0);

  const domain = domainId ? findDomain(domainId) : null;
  const examCounts = useMemo(() => examBlueprintCounts(), []);

  useEffect(() => {
    if (!domainId) {
      setItems(null);
      setLoadError(false);
      return undefined;
    }
    const cached = peekDomainItems(domainId);
    if (cached) {
      setItems(cached);
      setLoadError(false);
      return undefined;
    }
    let alive = true;
    setItems(null);
    setLoadError(false);
    loadDomainItems(domainId)
      .then((data) => {
        if (alive) setItems(data);
      })
      .catch(() => {
        if (alive) setLoadError(true);
      });
    return () => {
      alive = false;
    };
  }, [domainId, loadNonce]);

  const goDomain = useCallback((id) => {
    loadDomainItems(id).catch(() => null);
    setDomainId(id);
    setScreen("unitSelect");
  }, []);

  const startUnit = (unit) => {
    if (!items) return;
    const slice = unit === "all" ? items : items.slice(unit * UNIT_SIZE, unit * UNIT_SIZE + UNIT_SIZE);
    setQuestions(buildQuestions(slice));
    setScreen("quiz");
  };

  const startReview = () => {
    if (!items) return;
    const ids = getReviewIds(domainId);
    setQuestions(buildQuestions(items.filter((i) => ids.includes(i.id))));
    setScreen("quiz");
  };

  const exitQuiz = () => {
    setStatsNonce((n) => n + 1);
    setScreen("unitSelect");
  };

  /* 学習記録は localStorage から毎回読む。useMemo にすると、出題中に
     解いた分が学習記録の画面に出ないまま残る（実際にそうなっていた）。
     7ドメインぶんの読み出しなので、描画のたびに読んでも十分に軽い。 */
  const domainStats = screen === "progress" ? getAllDomainStats(DOMAINS.map((d) => d.id)) : [];

  return (
    <div className="ccaof-app">
      <style>{`
        .ccaof-app {
          min-height: 100vh; background: #F7F6F2;
          font-family: 'Zen Kaku Gothic New', 'Hiragino Sans', sans-serif;
          color: #2A2E27; padding: 28px 16px 60px;
        }
        .ccaof-inner { max-width: 720px; margin: 0 auto; }
        .ccaof-top-nav { display: flex; justify-content: space-between; align-items: center; max-width: 720px; margin: 0 auto 12px; }
        .ccaof-version { font-size: 11px; color: #9AA093; font-weight: 700; display: flex; flex-direction: column; align-items: flex-end; line-height: 1.3; }
        .ccaof-build { font-weight: 400; }
        .ccaof-back-link { font-size: 13px; color: #6B7280; cursor: pointer; text-decoration: underline; text-underline-offset: 3px; background: none; border: none; padding: 0; }
        .ccaof-title-block { text-align: center; margin-bottom: 20px; }
        .ccaof-eyebrow { font-size: 11px; letter-spacing: 2px; color: #9AA093; font-weight: 700; }
        .ccaof-serif { font-family: 'Shippori Mincho', serif; font-size: 28px; margin: 6px 0; }
        .ccaof-under { width: 40px; height: 3px; background: #C8743D; margin: 0 auto; }
        .ccaof-lead { font-size: 12.5px; color: #6B7280; line-height: 1.7; max-width: 560px; margin: 12px auto 0; }

        .ccaof-exam-facts { max-width: 720px; margin: 20px auto 0; display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
        @media (max-width: 480px) { .ccaof-exam-facts { grid-template-columns: repeat(2, 1fr); } }
        .ccaof-fact { background: #fff; border: 1px solid #E4E2DA; border-radius: 8px; padding: 10px; text-align: center; }
        .ccaof-fact-num { font-size: 18px; font-weight: 800; color: #C8743D; }
        .ccaof-fact-label { font-size: 10.5px; color: #9AA093; margin-top: 2px; }

        .ccaof-domain-grid { display: flex; flex-direction: column; gap: 10px; max-width: 720px; margin: 20px auto 0; }
        .ccaof-domain-card { border: 2px solid var(--c); border-radius: 10px; padding: 14px 16px; text-align: left; background: #fff; cursor: pointer; }
        .ccaof-domain-card:hover { transform: translateY(-1px); box-shadow: 0 3px 8px rgba(0,0,0,0.07); }
        .ccaof-domain-top { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; }
        .ccaof-domain-label { font-size: 16px; font-weight: 800; color: var(--c); }
        .ccaof-domain-weight { font-size: 12px; font-weight: 800; color: var(--c); white-space: nowrap; }
        .ccaof-domain-en { font-size: 11.5px; color: #9AA093; margin-top: 2px; }
        .ccaof-domain-stat { font-size: 11.5px; color: #6B7280; margin-top: 6px; }
        .ccaof-weight-bar { height: 4px; background: #EDEBE3; border-radius: 2px; margin-top: 8px; overflow: hidden; }
        .ccaof-weight-fill { height: 100%; background: var(--c); }

        .ccaof-sub-head { font-size: 13px; font-weight: 800; color: #6B7280; max-width: 720px; margin: 24px auto 8px; }
        .ccaof-unit-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 8px; max-width: 720px; margin: 0 auto; }
        .ccaof-unit-btn { border: 1px solid #D8D5CB; background: #fff; border-radius: 8px; padding: 12px 8px; font-size: 13px; cursor: pointer; }
        .ccaof-unit-btn:hover { border-color: var(--c); color: var(--c); }
        .ccaof-review-btn { border: 2px solid #C8323D; color: #C8323D; background: #fff; border-radius: 8px; padding: 12px; font-weight: 700; cursor: pointer; width: 100%; max-width: 720px; margin: 0 auto; display: block; }

        .ccaof-objectives { max-width: 720px; margin: 0 auto; background: #FBFAF6; border: 1px solid #E4E2DA; border-radius: 10px; padding: 14px 16px; }
        .ccaof-objectives li { font-size: 12.5px; color: #4B5563; line-height: 1.7; margin-left: -8px; }

        .ccaof-quiz { max-width: 720px; margin: 0 auto; }
        .ccaof-quiz-head { display: flex; justify-content: space-between; font-size: 12px; color: #9AA093; font-weight: 700; margin-bottom: 10px; }
        .ccaof-quiz-domain { color: var(--c); }
        .ccaof-material { background: #FBFAF6; border-left: 3px solid #D8D5CB; padding: 12px 14px; font-size: 13.5px; line-height: 1.8; margin-bottom: 12px; white-space: pre-wrap; }
        .ccaof-stem { font-size: 15.5px; line-height: 1.8; font-weight: 600; margin-bottom: 10px; }
        .ccaof-select-hint { font-size: 12px; color: #C8743D; font-weight: 700; margin-bottom: 10px; }
        .ccaof-choices { display: flex; flex-direction: column; gap: 8px; }
        .ccaof-choice { border: 1.5px solid #D8D5CB; background: #fff; border-radius: 8px; padding: 12px 14px; text-align: left; cursor: pointer; }
        .ccaof-choice.picked { border-color: #C8743D; background: #FDF6F0; }
        .ccaof-choice.correct { border-color: #1F6B45; background: #F1F8F3; }
        .ccaof-choice.wrong { border-color: #C8323D; background: #FCF2F2; }
        .ccaof-choice-text { font-size: 13.5px; line-height: 1.7; }
        .ccaof-choice-explain { font-size: 12.5px; color: #6B7280; line-height: 1.7; margin-top: 8px; padding-top: 8px; border-top: 1px dashed #D8D5CB; }
        .ccaof-source { font-size: 11.5px; color: #9AA093; margin-top: 12px; word-break: break-all; }
        .ccaof-source a { color: #2F5D8A; }
        .ccaof-reviewed { white-space: nowrap; }
        .ccaof-quiz-foot { display: flex; justify-content: space-between; align-items: center; margin-top: 16px; }
        .ccaof-answer-count { font-size: 11.5px; color: #9AA093; text-align: right; margin-top: 6px; }
        .ccaof-btn { border: none; background: var(--c); color: #fff; border-radius: 8px; padding: 11px 20px; font-weight: 700; font-size: 14px; cursor: pointer; }
        .ccaof-btn:disabled { background: #D8D5CB; cursor: not-allowed; }
        .ccaof-btn-ghost { border: 1px solid #D8D5CB; background: #fff; border-radius: 8px; padding: 10px 16px; font-size: 13px; cursor: pointer; }

        .ccaof-result { max-width: 560px; margin: 40px auto; text-align: center; }
        .ccaof-result-pct { font-size: 56px; font-weight: 800; color: var(--c); }
        .ccaof-result-sub { font-size: 14px; color: #6B7280; margin-top: 4px; }
        .ccaof-result-note { font-size: 12.5px; color: #9AA093; line-height: 1.8; margin: 16px 0 24px; }

        .ccaof-loading { max-width: 720px; margin: 40px auto; display: flex; flex-direction: column; align-items: center; gap: 14px; }
        .ccaof-spinner { width: 28px; height: 28px; border: 3px solid #E4E2DA; border-top-color: #C8743D; border-radius: 50%; animation: ccaof-spin 0.8s linear infinite; }
        @keyframes ccaof-spin { to { transform: rotate(360deg); } }
        @media (prefers-reduced-motion: reduce) { .ccaof-spinner { animation-duration: 2.4s; } }
        .ccaof-loading-text { font-size: 13px; color: #6B7280; }
        .ccaof-empty { text-align: center; padding: 40px 20px; color: #9AA093; }

        .ccaof-stat-row { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
        .ccaof-stat-name { font-size: 12.5px; width: 150px; flex-shrink: 0; }
        .ccaof-stat-track { flex: 1; height: 8px; background: #EDEBE3; border-radius: 4px; overflow: hidden; }
        .ccaof-stat-fill { height: 100%; background: var(--c); }
        .ccaof-stat-num { font-size: 11.5px; color: #6B7280; width: 110px; text-align: right; flex-shrink: 0; }
        .ccaof-official-box { max-width: 720px; margin: 24px auto 0; background: #FBFAF6; border: 1px solid #E4E2DA; border-radius: 10px; padding: 16px 18px; }
        .ccaof-official-title { font-weight: 800; font-size: 14px; margin-bottom: 6px; }
        .ccaof-official-desc { font-size: 12.5px; color: #6B7280; line-height: 1.7; margin-bottom: 10px; }
        .ccaof-official-link { font-size: 13px; color: #2F5D8A; text-decoration: underline; display: block; margin-bottom: 6px; }
      `}</style>

      <div className="ccaof-top-nav">
        <div style={{ display: "flex", gap: 12 }}>
          <button className="ccaof-back-link" onClick={onExitApp}>他のアプリへ</button>
          <button className="ccaof-back-link" onClick={() => setScreen("progress")}>📊 学習記録</button>
        </div>
        <div className="ccaof-version">
          <span>v{APP_VERSION}</span>
          <span className="ccaof-build">{BUILD_DATE}</span>
        </div>
      </div>

      {screen === "domainSelect" && (
        <>
          <div className="ccaof-title-block">
            <div className="ccaof-eyebrow">CCAO-F — CLAUDE CERTIFIED ASSOCIATE (FOUNDATIONS)</div>
            <h1 className="ccaof-serif">CCAO-F 対策</h1>
            <div className="ccaof-under" />
            <div className="ccaof-lead">
              公式 Exam Guide v1.0（2026年7月発効）の7ドメインに沿った練習問題です。
              問題文はすべてオリジナルで、公式の試験問題は使っていません。
            </div>
          </div>

          <div className="ccaof-exam-facts">
            <div className="ccaof-fact"><div className="ccaof-fact-num">{EXAM_FORMAT.items}</div><div className="ccaof-fact-label">問</div></div>
            <div className="ccaof-fact"><div className="ccaof-fact-num">{EXAM_FORMAT.minutes}</div><div className="ccaof-fact-label">分</div></div>
            <div className="ccaof-fact"><div className="ccaof-fact-num">{EXAM_FORMAT.passScaled}</div><div className="ccaof-fact-label">合格点（{EXAM_FORMAT.scaleMax}点満点）</div></div>
            <div className="ccaof-fact"><div className="ccaof-fact-num">{EXAM_FORMAT.validityMonths}</div><div className="ccaof-fact-label">か月有効</div></div>
          </div>

          <div className="ccaof-sub-head">ドメインを選ぶ（数字は本番の配点比率）</div>
          <div className="ccaof-domain-grid">
            {DOMAINS.map((d) => {
              const st = getDomainStats(d.id);
              const pct = accuracyPercent(st);
              return (
                <button key={d.id} className="ccaof-domain-card" style={{ "--c": d.color }} onClick={() => goDomain(d.id)}>
                  <div className="ccaof-domain-top">
                    <span className="ccaof-domain-label">{d.label}</span>
                    <span className="ccaof-domain-weight">{d.weight}% · 本番 {examCounts[d.id]}問</span>
                  </div>
                  <div className="ccaof-domain-en">{d.labelEn}</div>
                  <div className="ccaof-weight-bar"><div className="ccaof-weight-fill" style={{ width: `${d.weight * 4}%` }} /></div>
                  <div className="ccaof-domain-stat">{pct === null ? "まだ未学習" : `正答率 ${pct}%（${st.attempted}問）`}</div>
                </button>
              );
            })}
          </div>

          <div className="ccaof-official-box">
            <div className="ccaof-official-title">📄 公式情報</div>
            <div className="ccaof-official-desc">
              受験料 ${EXAM_FORMAT.feeUsd}、Pearson VUE のオンライン監督またはテストセンターで受験します。
              申し込みは Anthropic Partner Academy から。問題はすべてオリジナルで、
              公式の試験問題（機密扱い）は一切含みません。
            </div>
            {OFFICIAL_LINKS.map((l) => (
              <a key={l.url} className="ccaof-official-link" href={l.url} target="_blank" rel="noopener noreferrer">{l.label}</a>
            ))}
          </div>
        </>
      )}

      {screen === "unitSelect" && domain && (
        <>
          <button className="ccaof-back-link" style={{ marginBottom: 12 }} onClick={() => { setDomainId(null); setScreen("domainSelect"); }}>← ドメインを選び直す</button>
          <div className="ccaof-title-block">
            <div className="ccaof-eyebrow">{domain.labelEn} — {domain.weight}%</div>
            <h1 className="ccaof-serif">{domain.label}</h1>
            <div className="ccaof-under" />
          </div>

          <div className="ccaof-sub-head">このドメインで問われること（公式 Exam Guide）</div>
          <div className="ccaof-objectives">
            <ul>{domain.objectives.map((o) => <li key={o}>{o}</li>)}</ul>
          </div>

          {!items ? (
            loadError ? (
              <div className="ccaof-empty">
                問題を読み込めませんでした。通信を確認して、もう一度ためしてください。
                <div style={{ marginTop: 10 }}>
                  <button className="ccaof-btn-ghost" onClick={() => setLoadNonce((n) => n + 1)}>もう一度</button>
                </div>
              </div>
            ) : (
              <DomainLoading label="問題を読み込んでいます…" />
            )
          ) : (
            <>
              {getReviewCount(domainId) > 0 && (
                <>
                  <div className="ccaof-sub-head">まちがえた問題</div>
                  <button className="ccaof-review-btn" onClick={startReview}>
                    🔁 復習する（{getReviewCount(domainId)}問）
                  </button>
                </>
              )}
              <div className="ccaof-sub-head">出題範囲（{items.length}問）</div>
              <div className="ccaof-unit-grid">
                {Array.from({ length: unitCount(items.length) }, (_, u) => {
                  const from = u * UNIT_SIZE + 1;
                  const to = Math.min((u + 1) * UNIT_SIZE, items.length);
                  return (
                    <button key={u} className="ccaof-unit-btn" style={{ "--c": domain.color }} onClick={() => startUnit(u)}>
                      {u + 1}組（{from}〜{to}）
                    </button>
                  );
                })}
                {items.length > UNIT_SIZE && (
                  <button className="ccaof-unit-btn" style={{ "--c": domain.color }} onClick={() => startUnit("all")}>
                    すべて（{items.length}問）
                  </button>
                )}
              </div>
            </>
          )}
        </>
      )}

      {screen === "quiz" && domain && (
        <Quiz domain={domain} questions={questions} onExit={exitQuiz} />
      )}

      {screen === "progress" && (
        <div className="ccaof-inner">
          <button className="ccaof-back-link" style={{ marginBottom: 12 }} onClick={() => setScreen(domainId ? "unitSelect" : "domainSelect")}>← もどる</button>
          <div className="ccaof-title-block">
            <h1 className="ccaof-serif">学習記録</h1>
            <div className="ccaof-under" />
          </div>
          <div className="ccaof-exam-facts">
            <div className="ccaof-fact"><div className="ccaof-fact-num">{getStreak()}</div><div className="ccaof-fact-label">日連続</div></div>
            <div className="ccaof-fact"><div className="ccaof-fact-num">{getTodayStats().attempted}</div><div className="ccaof-fact-label">きょう解いた</div></div>
            <div className="ccaof-fact"><div className="ccaof-fact-num">{domainStats.reduce((n, s) => n + s.attempted, 0)}</div><div className="ccaof-fact-label">のべ解答数</div></div>
            <div className="ccaof-fact"><div className="ccaof-fact-num">{BLUEPRINT.blueprintVersion}</div><div className="ccaof-fact-label">ブループリント版</div></div>
          </div>

          <div className="ccaof-sub-head">ドメイン別の正答率</div>
          <div style={{ maxWidth: 720, margin: "0 auto" }}>
            {domainStats.map((s) => {
              const d = findDomain(s.id);
              const pct = accuracyPercent(s);
              return (
                <div className="ccaof-stat-row" key={s.id} style={{ "--c": d.color }}>
                  <div className="ccaof-stat-name">{d.label}</div>
                  <div className="ccaof-stat-track"><div className="ccaof-stat-fill" style={{ width: `${pct ?? 0}%` }} /></div>
                  <div className="ccaof-stat-num">{pct === null ? "未学習" : `${pct}%（${s.attempted}問）`}</div>
                </div>
              );
            })}
          </div>
          <div className="ccaof-official-box">
            <div className="ccaof-official-desc">
              本番の score report もドメイン別の正答率を出します（合否はスケールドスコアの合計で決まり、
              ドメイン別は参考値）。ここで弱いドメインは、配点比率の高いものから先に埋めるのが効率的です。
            </div>
            <button className="ccaof-btn-ghost" onClick={() => { if (window.confirm("CCAO-F の学習記録をすべて消します。よろしいですか？")) { resetProgress(); setStatsNonce((n) => n + 1); } }}>
              学習記録をリセット
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
