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
  buildExam,
  gradeExam,
  isCorrect,
  passRatio,
  loadResults,
  saveResult,
  clearResults,
  saveInProgress,
  loadInProgress,
  clearInProgress,
  remainingMs,
  formatClock,
} from "./ccaofExam";
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

const ZH_KEY = "ccaofShowZh";

function loadShowZh() {
  try {
    return window.localStorage.getItem(ZH_KEY) !== "0";
  } catch (e) {
    return true;
  }
}

function Quiz({ domain, questions, onExit, showZh, onToggleZh }) {
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
        <span className="ccaof-quiz-head-right">
          {/* 英語だけで解きたいときのために消せるようにしておく。本番は英語 */}
          <button className="ccaof-zh-toggle" onClick={onToggleZh}>
            中文訳 {showZh ? "ON" : "OFF"}
          </button>
          <span className="ccaof-quiz-domain" style={{ "--c": domain.color }}>{domain.label}</span>
        </span>
      </div>

      {q.material && <div className="ccaof-material">{q.material}</div>}
      {q.materialZh && showZh && <div className="ccaof-material zh">{q.materialZh}</div>}
      <div className="ccaof-stem">{q.stem}</div>
      {q.stemZh && showZh && <div className="ccaof-stem-zh">{q.stemZh}</div>}
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
              {c.textZh && showZh && <div className="ccaof-choice-zh">{c.textZh}</div>}
              {submitted && <div className="ccaof-choice-explain">{c.explain}</div>}
            </button>
          );
        })}
      </div>

      {submitted && q.commentaryZh && (
        <div className="ccaof-note">
          <div className="ccaof-note-title">中文注解</div>
          <div className="ccaof-note-body">{q.commentaryZh}</div>
        </div>
      )}

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
   模擬試験

   本番と同じ 60問 / 120分。途中で解答を確認できないのも本番どおり。
   採点は提出後にまとめて行い、ドメイン別の正答率も出す
   （本番の score report と同じ形）。
   ============================================================ */

function ExamRunner({ questions, answers, onPick, startedAt, onSubmit, onAbandon, showZh }) {
  const [index, setIndex] = useState(0);
  const [left, setLeft] = useState(() => remainingMs(startedAt));
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    const id = setInterval(() => {
      const ms = remainingMs(startedAt);
      setLeft(ms);
      // 時間切れは自動提出。本番も終了時刻で締め切られる
      if (ms <= 0) onSubmit(true);
    }, 1000);
    return () => clearInterval(id);
  }, [startedAt, onSubmit]);

  const q = questions[index];
  const answered = answers.filter((a) => a && a.length > 0).length;
  const picked = answers[index] || [];
  const low = left <= 10 * 60 * 1000;

  const toggle = (i) => {
    const next = picked.includes(i)
      ? picked.filter((x) => x !== i)
      : picked.length >= q.selectCount
        ? [...picked.slice(1), i]
        : [...picked, i];
    onPick(index, next);
  };

  return (
    <div className="ccaof-exam">
      <div className="ccaof-exam-bar">
        <span className={"ccaof-clock" + (low ? " low" : "")}>⏱ {formatClock(left)}</span>
        <span className="ccaof-exam-count">{index + 1} / {questions.length}（解答済み {answered}）</span>
      </div>

      <div className="ccaof-exam-grid">
        {questions.map((_, i) => (
          <button
            key={i}
            className={
              "ccaof-exam-dot" +
              (i === index ? " current" : "") +
              (answers[i] && answers[i].length > 0 ? " done" : "")
            }
            onClick={() => setIndex(i)}
          >
            {i + 1}
          </button>
        ))}
      </div>

      {q.material && <div className="ccaof-material">{q.material}</div>}
      <div className="ccaof-stem">{q.stem}</div>
      {q.stemZh && showZh && <div className="ccaof-stem-zh">{q.stemZh}</div>}
      {q.selectCount > 1 && (
        <div className="ccaof-select-hint">{q.selectCount}つ選んでください（{picked.length}/{q.selectCount} 選択中）</div>
      )}

      <div className="ccaof-choices">
        {q.choices.map((c, i) => (
          <button
            key={i}
            className={"ccaof-choice" + (picked.includes(i) ? " picked" : "")}
            onClick={() => toggle(i)}
          >
            <div className="ccaof-choice-text">{c.text}</div>
            {c.textZh && showZh && <div className="ccaof-choice-zh">{c.textZh}</div>}
          </button>
        ))}
      </div>

      <div className="ccaof-quiz-foot">
        <button className="ccaof-btn-ghost" onClick={() => setIndex(Math.max(0, index - 1))} disabled={index === 0}>← 前の問題</button>
        {index + 1 < questions.length ? (
          <button className="ccaof-btn" style={{ "--c": "#C8743D" }} onClick={() => setIndex(index + 1)}>次の問題 →</button>
        ) : (
          <button className="ccaof-btn" style={{ "--c": "#C8743D" }} onClick={() => setConfirming(true)}>提出する</button>
        )}
      </div>

      <div className="ccaof-exam-foot">
        <button className="ccaof-back-link" onClick={() => setConfirming(true)}>提出して採点する</button>
        <button className="ccaof-back-link" onClick={onAbandon}>試験をやめる</button>
      </div>

      {confirming && (
        <div className="ccaof-confirm">
          <div className="ccaof-confirm-box">
            <div className="ccaof-confirm-title">提出しますか？</div>
            <div className="ccaof-confirm-body">
              {answered < questions.length
                ? `未解答が ${questions.length - answered} 問あります。提出すると不正解になります。`
                : "全問に解答済みです。"}
            </div>
            <div className="ccaof-delete-actions">
              <button className="ccaof-btn-ghost" onClick={() => setConfirming(false)}>まだ見直す</button>
              <button className="ccaof-btn" style={{ "--c": "#C8743D" }} onClick={() => onSubmit(false)}>提出する</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ExamResult({ result, questions, onReview, onBack }) {
  const need = Math.ceil(passRatio() * result.total);
  return (
    <div className="ccaof-result">
      <div className={"ccaof-verdict " + (result.passed ? "pass" : "fail")}>
        {result.passed ? "合格ライン到達" : "合格ラインに届かず"}
      </div>
      <div className="ccaof-result-pct" style={{ "--c": result.passed ? "#1F6B45" : "#C8323D" }}>
        {result.correct} / {result.total}
      </div>
      <div className="ccaof-result-sub">
        目安スコア {result.scaled}（合格 {EXAM_FORMAT.passScaled}）／ 合格には {need} 問以上
      </div>
      <div className="ccaof-result-note">
        本番のスケールドスコアの換算方法は公表されていません。ここの点数は
        正答率を 100〜1000 に置き換えた<strong>目安</strong>で、本番の得点の予測ではありません。
        確かなのは「何問正解したか」と、下のドメイン別の正答率です。
      </div>

      <div className="ccaof-sub-head">ドメイン別（本番の score report と同じ形）</div>
      <div style={{ maxWidth: 720, margin: "0 auto", textAlign: "left" }}>
        {DOMAINS.map((d) => {
          const st = result.perDomain[d.id] || { attempted: 0, correct: 0 };
          const pct = st.attempted ? Math.round((st.correct / st.attempted) * 100) : null;
          return (
            <div className="ccaof-stat-row" key={d.id} style={{ "--c": d.color }}>
              <div className="ccaof-stat-name">{d.label}</div>
              <div className="ccaof-stat-track"><div className="ccaof-stat-fill" style={{ width: `${pct ?? 0}%` }} /></div>
              <div className="ccaof-stat-num">{pct === null ? "—" : `${pct}%（${st.correct}/${st.attempted}）`}</div>
            </div>
          );
        })}
      </div>

      <div className="ccaof-quiz-foot" style={{ maxWidth: 720, margin: "20px auto 0" }}>
        <button className="ccaof-btn-ghost" onClick={onBack}>もどる</button>
        <button className="ccaof-btn" style={{ "--c": "#C8743D" }} onClick={onReview}>間違えた問題を見る</button>
      </div>
    </div>
  );
}

function ExamReview({ result, questions, showZh, onBack }) {
  const wrong = result.details
    .map((d, i) => ({ ...d, q: questions[i], no: i + 1 }))
    .filter((d) => !d.correct);

  return (
    <div className="ccaof-inner">
      <div className="ccaof-sub-head">まちがえた問題（{wrong.length}問）</div>
      {wrong.length === 0 && <div className="ccaof-empty">全問正解です。</div>}
      {wrong.map((w) => (
        <div className="ccaof-review-item" key={w.id}>
          <div className="ccaof-review-no">第 {w.no} 問 · {findDomain(w.q.domain).label}</div>
          <div className="ccaof-stem">{w.q.stem}</div>
          {w.q.stemZh && showZh && <div className="ccaof-stem-zh">{w.q.stemZh}</div>}
          <div className="ccaof-choices">
            {w.q.choices.map((c, i) => {
              let cls = "ccaof-choice";
              if (c.correct) cls += " correct";
              else if (w.picked.includes(i)) cls += " wrong";
              return (
                <div key={i} className={cls}>
                  <div className="ccaof-choice-text">{c.text}</div>
                  {c.textZh && showZh && <div className="ccaof-choice-zh">{c.textZh}</div>}
                  <div className="ccaof-choice-explain">{c.explain}</div>
                </div>
              );
            })}
          </div>
          {w.q.commentaryZh && (
            <div className="ccaof-note">
              <div className="ccaof-note-title">中文注解</div>
              <div className="ccaof-note-body">{w.q.commentaryZh}</div>
            </div>
          )}
          <div className="ccaof-source">
            出典：<a href={w.q.reference} target="_blank" rel="noopener noreferrer">{w.q.reference}</a>
          </div>
        </div>
      ))}
      <div style={{ textAlign: "center", marginTop: 20 }}>
        <button className="ccaof-btn-ghost" onClick={onBack}>結果にもどる</button>
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
  const [showZh, setShowZh] = useState(loadShowZh);

  /* 模擬試験。questions とは別に持つ（ドリルと状態が混ざらないように） */
  const [exam, setExam] = useState(null);          // { questions, answers, startedAt }
  const [examResult, setExamResult] = useState(null);
  const [examBusy, setExamBusy] = useState(false);
  const [resumable, setResumable] = useState(() => loadInProgress());

  const toggleZh = useCallback(() => {
    setShowZh((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(ZH_KEY, next ? "1" : "0");
      } catch (e) {
        // localStorage が使えなくても表示そのものは切り替わる
      }
      return next;
    });
  }, []);

  const startExam = useCallback(async (resume) => {
    setExamBusy(true);
    try {
      const state = resume || {
        questions: await buildExam(),
        answers: [],
        startedAt: Date.now(),
      };
      saveInProgress(state);
      setExam(state);
      setExamResult(null);
      setResumable(null);
      setScreen("exam");
    } finally {
      setExamBusy(false);
    }
  }, []);

  const pickExamAnswer = useCallback((index, next) => {
    setExam((prev) => {
      if (!prev) return prev;
      const answers = [...prev.answers];
      answers[index] = next;
      const updated = { ...prev, answers };
      saveInProgress(updated);
      return updated;
    });
  }, []);

  const submitExam = useCallback((timedOut) => {
    setExam((prev) => {
      if (!prev) return prev;
      const result = gradeExam(prev.questions, prev.answers);
      result.timedOut = !!timedOut;
      saveResult(result);
      clearInProgress();
      // 模試の結果はドメイン別の学習記録にも反映する
      prev.questions.forEach((q, i) => {
        const ok = isCorrect(q, prev.answers[i]);
        recordAnswer(q.domain, q.id, ok);
        recordReviewResult(q.domain, q.id, ok);
      });
      setExamResult(result);
      setScreen("examResult");
      return prev;
    });
  }, []);

  const abandonExam = useCallback(() => {
    if (!window.confirm("試験をやめますか？ ここまでの解答は採点されずに消えます。")) return;
    clearInProgress();
    setExam(null);
    setExamResult(null);
    setScreen("domainSelect");
  }, []);

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
  /* 受験履歴も localStorage から毎回読む（useMemo にすると採点直後に古い値が残る） */
  const pastResults = screen === "domainSelect" ? loadResults() : [];

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
        .ccaof-quiz-head-right { display: flex; align-items: center; gap: 10px; }
        .ccaof-zh-toggle { border: 1px solid #D8D5CB; background: #fff; border-radius: 6px; padding: 3px 8px; font-size: 10.5px; color: #6B7280; font-weight: 700; cursor: pointer; }
        .ccaof-material.zh { border-left-color: #C8743D; color: #4B5563; font-size: 13px; margin-top: -6px; }
        .ccaof-stem-zh { font-size: 14px; line-height: 1.85; color: #5A5F55; margin: -4px 0 10px; padding-left: 10px; border-left: 3px solid #E4D3C4; }
        .ccaof-choice-zh { font-size: 12.5px; line-height: 1.75; color: #6B7280; margin-top: 5px; }
        .ccaof-note { background: #FBF6F1; border: 1px solid #E4D3C4; border-radius: 8px; padding: 12px 14px; margin-top: 14px; }
        .ccaof-note-title { font-size: 11px; font-weight: 800; color: #C8743D; letter-spacing: 1px; margin-bottom: 6px; }
        .ccaof-note-body { font-size: 13px; line-height: 1.9; color: #4B5563; }
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

        /* ---- 模擬試験 ---- */
        .ccaof-exam-card { max-width: 720px; margin: 0 auto; background: #fff; border: 2px solid #C8743D; border-radius: 10px; padding: 16px 18px; }
        .ccaof-exam-card-title { font-size: 15px; font-weight: 800; color: #C8743D; }
        .ccaof-exam-card-desc { font-size: 12.5px; color: #6B7280; line-height: 1.7; margin: 6px 0 12px; }
        .ccaof-exam-history { margin-top: 14px; border-top: 1px dashed #E4D3C4; padding-top: 10px; }
        .ccaof-exam-history-title { font-size: 11px; font-weight: 800; color: #9AA093; margin-bottom: 6px; }
        .ccaof-exam-history-row { display: flex; justify-content: space-between; font-size: 12px; color: #6B7280; padding: 3px 0; }
        .ccaof-exam-history-row .pass { color: #1F6B45; font-weight: 700; }
        .ccaof-exam-history-row .fail { color: #C8323D; font-weight: 700; }

        .ccaof-exam { max-width: 720px; margin: 0 auto; }
        .ccaof-exam-bar { display: flex; justify-content: space-between; align-items: center; position: sticky; top: 0; background: #F7F6F2; padding: 8px 0; z-index: 2; border-bottom: 1px solid #E4E2DA; }
        .ccaof-clock { font-size: 18px; font-weight: 800; color: #2A2E27; font-variant-numeric: tabular-nums; }
        .ccaof-clock.low { color: #C8323D; }
        .ccaof-exam-count { font-size: 12px; color: #6B7280; }
        .ccaof-exam-grid { display: flex; flex-wrap: wrap; gap: 4px; margin: 10px 0 16px; }
        .ccaof-exam-dot { width: 28px; height: 28px; border: 1px solid #D8D5CB; background: #fff; border-radius: 6px; font-size: 11px; color: #9AA093; cursor: pointer; padding: 0; }
        .ccaof-exam-dot.done { background: #EDE4DA; color: #2A2E27; border-color: #C8A98A; }
        .ccaof-exam-dot.current { border: 2px solid #C8743D; color: #C8743D; font-weight: 800; }
        .ccaof-exam-foot { display: flex; justify-content: space-between; margin-top: 18px; }

        .ccaof-confirm { position: fixed; inset: 0; background: rgba(0,0,0,0.35); display: flex; align-items: center; justify-content: center; padding: 16px; z-index: 10; }
        .ccaof-confirm-box { background: #fff; border-radius: 12px; padding: 22px; max-width: 360px; width: 100%; }
        .ccaof-confirm-title { font-size: 16px; font-weight: 800; margin-bottom: 8px; }
        .ccaof-confirm-body { font-size: 13px; color: #6B7280; line-height: 1.7; margin-bottom: 16px; }

        .ccaof-verdict { font-size: 13px; font-weight: 800; letter-spacing: 1px; }
        .ccaof-verdict.pass { color: #1F6B45; }
        .ccaof-verdict.fail { color: #C8323D; }
        .ccaof-review-item { max-width: 720px; margin: 0 auto 28px; padding-bottom: 20px; border-bottom: 1px solid #E4E2DA; }
        .ccaof-review-no { font-size: 11px; font-weight: 800; color: #9AA093; margin-bottom: 8px; }

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

          <div className="ccaof-sub-head">模擬試験</div>
          <div className="ccaof-exam-card">
            <div className="ccaof-exam-card-title">本番と同じ {EXAM_FORMAT.items}問 / {EXAM_FORMAT.minutes}分</div>
            <div className="ccaof-exam-card-desc">
              配点比率どおりに全ドメインから出題します（D2 から {examCounts.D2}問、D4 から {examCounts.D4}問…）。
              解答は提出するまで採点されません。途中で閉じても、制限時間内なら続きから再開できます。
            </div>
            {resumable ? (
              <div className="ccaof-delete-actions" style={{ justifyContent: "flex-start" }}>
                <button className="ccaof-btn" style={{ "--c": "#C8743D" }} onClick={() => startExam(resumable)}>
                  続きから再開（残り {formatClock(remainingMs(resumable.startedAt))}）
                </button>
                <button className="ccaof-btn-ghost" onClick={() => { clearInProgress(); setResumable(null); }}>破棄する</button>
              </div>
            ) : (
              <button className="ccaof-btn" style={{ "--c": "#C8743D" }} onClick={() => startExam(null)} disabled={examBusy}>
                {examBusy ? "問題を準備しています…" : "模擬試験をはじめる"}
              </button>
            )}
            {pastResults.length > 0 && (
              <div className="ccaof-exam-history">
                <div className="ccaof-exam-history-title">これまでの結果</div>
                {pastResults.slice(0, 5).map((r) => (
                  <div className="ccaof-exam-history-row" key={r.finishedAt}>
                    <span>{new Date(r.finishedAt).toLocaleDateString()}</span>
                    <span>{r.correct} / {r.total}</span>
                    <span className={r.passed ? "pass" : "fail"}>目安 {r.scaled}</span>
                  </div>
                ))}
              </div>
            )}
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

      {screen === "exam" && exam && (
        <ExamRunner
          questions={exam.questions}
          answers={exam.answers}
          startedAt={exam.startedAt}
          onPick={pickExamAnswer}
          onSubmit={submitExam}
          onAbandon={abandonExam}
          showZh={showZh}
        />
      )}

      {screen === "examResult" && examResult && exam && (
        <ExamResult
          result={examResult}
          questions={exam.questions}
          onReview={() => setScreen("examReview")}
          onBack={() => { setStatsNonce((n) => n + 1); setScreen("domainSelect"); }}
        />
      )}

      {screen === "examReview" && examResult && exam && (
        <ExamReview
          result={examResult}
          questions={exam.questions}
          showZh={showZh}
          onBack={() => setScreen("examResult")}
        />
      )}

      {screen === "quiz" && domain && (
        <Quiz domain={domain} questions={questions} onExit={exitQuiz} showZh={showZh} onToggleZh={toggleZh} />
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
