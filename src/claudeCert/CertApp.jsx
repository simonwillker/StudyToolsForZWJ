import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { newStudySession } from "../studyLog";
import CertVocab from "./CertVocab";
import { activeCert } from "./certState";
import { SpeakButton, AudioPlayer, AudioStyle, AudioUnsupported, useStopSpeechOn } from "./CertAudio";
import { isSpeechSupported } from "./speech";
import { questionTracks, lessonTracks, splitMixed } from "./audioCore";
import { recordListen, getListenSummary } from "./listen";
import { getVocabSummary } from "./vocabProgress";
import { analyseWeakness, pickFocusItems, MIN_ATTEMPTS } from "./weakness";
import {
  downloadBackup,
  parseBackup,
  applyBackup,
  describeBackup,
} from "./backup";
import {
  buildObjectiveIndex,
  collectObjectiveStats,
  rankWeakObjectives,
  pickPracticeItems,
  predictScore,
  nextActions,
  pctOf,
  MIN_OBJECTIVE_ATTEMPTS,
  paceSummary,
  formatSeconds,
} from "./studyCore";
import { recordMistakeAnswer, getMistakeSummary, getDueMistakeIds } from "./mistakes";
import {
  DOMAINS,
  OBJECTIVES,
  loadLessons,
  loadAllDomainItems,
  BLUEPRINT,
  EXAM_FORMAT,
  findDomain,
  peekDomainItems,
  loadDomainItems,
  examBlueprintCounts,
  SCENARIOS,
  findScenario,
} from "./domains";
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
} from "./exam";
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
  loadProgress,
} from "./progress";

const APP_VERSION = __APP_VERSION__;
const BUILD_DATE = __BUILD_DATE__;

/** 英検と同じく20問1組で出す */
const UNIT_SIZE = 20;

/** 非公式・推定の値に付ける印。meta.json の examFormatSource で "unofficial" とした項目 */
function UnofficialMark({ field }) {
  const src = (BLUEPRINT.examFormatSource || {})[field];
  if (src !== "unofficial") return null;
  return <span className="ccaof-unofficial" title="公式資料で確認できない値。第三者情報からの推定">非公式・推定</span>;
}

/* ============================================================
   シナリオ（CCAR-F）。本番はシナリオの説明文のあとに複数の問題が続く。
   問題ごとに同じ説明を出すと長いので、たためるようにしておく。
   ============================================================ */

function ScenarioBox({ id, showZh, defaultOpen = true }) {
  const sc = findScenario(id);
  if (!sc) return null;
  return (
    <details className="ccaof-scenario" open={defaultOpen} data-testid="scenario-box">
      <summary>
        <span className="ccaof-scenario-tag">シナリオ {sc.no}</span> {sc.title}
        {showZh && sc.titleZh && <span className="ccaof-scenario-zh-title">（{sc.titleZh}）</span>}
      </summary>
      <div className="ccaof-scenario-body">{sc.description}</div>
      {showZh && sc.descriptionZh && <div className="ccaof-scenario-body zh">{sc.descriptionZh}</div>}
    </details>
  );
}

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

function Quiz({ domain, questions, onExit, showZh, onToggleZh, studyLabel, exitLabel = "ドメイン選択にもどる" }) {
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState([]);
  const [submitted, setSubmitted] = useState(false);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);

  const q = questions[index];
  const total = questions.length;
  useStopSpeechOn(index);

  // 勉強履歴：出題が始まるたびに新しい回
  useEffect(() => {
    newStudySession();
  }, [questions]);

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
    /* 重点演習では複数ドメインが混ざる。記録先は画面のドメインではなく
       問題自身のドメインにする（そうしないと弱点判定の材料が壊れる） */
    const recordDomain = q.domain || domain.id;
    recordAnswer(recordDomain, q.id, ok, studyLabel);
    recordReviewResult(recordDomain, q.id, ok);
    /* 錯題本：どの練習でまちがえても登録し、期限の来た問題の正解は復習の進み具合に数える */
    recordMistakeAnswer({ id: q.id, domain: recordDomain }, ok);
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
        <button className="ccaof-btn" style={{ "--c": domain.color }} onClick={onExit}>{exitLabel}</button>
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

      {q.scenario && <ScenarioBox id={q.scenario} showZh={showZh} key={q.id} defaultOpen={index === 0 || questions[index - 1].scenario !== q.scenario} />}
      {q.material && <div className="ccaof-material">{q.material}<SpeakButton text={q.material} /></div>}
      {q.materialZh && showZh && <div className="ccaof-material zh">{q.materialZh}<SpeakButton text={q.materialZh} lang="zh" /></div>}
      <div className="ccaof-stem">{q.stem}<SpeakButton text={q.stem} label="問題文を読み上げる" /></div>
      {q.stemZh && showZh && <div className="ccaof-stem-zh">{q.stemZh}<SpeakButton text={q.stemZh} lang="zh" label="中文を読み上げる" /></div>}
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
            /* 答え合わせのあとも🔊は押せるように、無効化（disabled）はせず onClick で止める */
            <div
              key={i}
              role="button"
              tabIndex={submitted ? -1 : 0}
              className={cls + (submitted ? " done" : "")}
              onClick={() => toggle(i)}
              onKeyDown={(e) => {
                if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
                  e.preventDefault();
                  toggle(i);
                }
              }}
            >
              <div className="ccaof-choice-text">{c.text}<SpeakButton text={c.text} label="選択肢を読み上げる" /></div>
              {c.textZh && showZh && <div className="ccaof-choice-zh">{c.textZh}<SpeakButton text={c.textZh} lang="zh" label="中文を読み上げる" /></div>}
              {submitted && <div className="ccaof-choice-explain">{c.explain}<SpeakButton text={c.explain} lang="ja" label="解説を読み上げる" /></div>}
            </div>
          );
        })}
      </div>

      {submitted && q.commentaryZh && (
        <div className="ccaof-note">
          <div className="ccaof-note-title">中文注解<SpeakButton text={q.commentaryZh} lang="zh" label="中文注解を読み上げる" /></div>
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

/** 1回開いていた時間の上限。画面を開いたまま離れた分で平均が狂わないように */
const MAX_VISIT_MS = 10 * 60 * 1000;

function ExamRunner({ questions, answers, onPick, startedAt, onSubmit, onAbandon, showZh, englishOnly, onTime }) {
  const [index, setIndex] = useState(0);
  const [left, setLeft] = useState(() => remainingMs(startedAt));
  const [confirming, setConfirming] = useState(false);
  // 英文のみモードでは、全体の「中文訳」設定に関係なく訳を出さない（本番どおり）
  const zh = showZh && !englishOnly;

  // いま開いている問題に入った時刻。問題を移るたびにその問題の時間として足す
  const enteredAt = useRef(Date.now());
  const indexRef = useRef(0);
  const flushTime = useCallback(() => {
    const now = Date.now();
    onTime(indexRef.current, Math.min(MAX_VISIT_MS, now - enteredAt.current));
    enteredAt.current = now;
  }, [onTime]);
  const goTo = (next) => {
    if (next === index) return;
    flushTime();
    indexRef.current = next;
    setIndex(next);
  };
  const submit = useCallback((timedOut) => {
    flushTime();
    onSubmit(timedOut);
  }, [flushTime, onSubmit]);

  useEffect(() => {
    const id = setInterval(() => {
      const ms = remainingMs(startedAt);
      setLeft(ms);
      // 時間切れは自動提出。本番も終了時刻で締め切られる
      if (ms <= 0) submit(true);
    }, 1000);
    return () => clearInterval(id);
  }, [startedAt, submit]);

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
        <span className="ccaof-exam-count">
          {englishOnly && <span className="ccaof-en-badge">英文のみ</span>}
          {index + 1} / {questions.length}（解答済み {answered}）
        </span>
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
            onClick={() => goTo(i)}
          >
            {i + 1}
          </button>
        ))}
      </div>

      {q.scenario && (index === 0 || questions[index - 1].scenario !== q.scenario) && (
        <div className="ccaof-scenario-new">ここから新しいシナリオです</div>
      )}
      {q.scenario && <ScenarioBox id={q.scenario} showZh={zh} key={q.id} />}
      {q.material && <div className="ccaof-material">{q.material}</div>}
      <div className="ccaof-stem">{q.stem}</div>
      {q.stemZh && zh && <div className="ccaof-stem-zh">{q.stemZh}</div>}
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
            {c.textZh && zh && <div className="ccaof-choice-zh">{c.textZh}</div>}
          </button>
        ))}
      </div>

      <div className="ccaof-quiz-foot">
        <button className="ccaof-btn-ghost" onClick={() => goTo(Math.max(0, index - 1))} disabled={index === 0}>← 前の問題</button>
        {index + 1 < questions.length ? (
          <button className="ccaof-btn" style={{ "--c": "#C8743D" }} onClick={() => goTo(index + 1)}>次の問題 →</button>
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
              <button className="ccaof-btn" style={{ "--c": "#C8743D" }} onClick={() => submit(false)}>提出する</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PaceReport({ pace }) {
  if (!pace || !pace.seen) return null;
  const slow = pace.avgMs > pace.targetMs;
  return (
    <>
      <div className="ccaof-sub-head">解答ペース（1問あたりの目安 {formatSeconds(pace.targetMs)}）</div>
      <div style={{ maxWidth: 720, margin: "0 auto", textAlign: "left" }} data-testid="pace">
        <div className={"ccaof-pace-main " + (slow ? "fail" : "pass")}>
          平均 {formatSeconds(pace.avgMs)} / 問
          {slow ? "（目安より遅い）" : "（目安以内）"}
        </div>
        <div className="ccaof-focus-desc">
          目安を超えた問題：{pace.overCount}問。
          {slow
            ? "英文を読むのに時間がかかっています。問題文の最後の1文（何を聞かれているか）を先に読み、BEST / NOT / FIRST などのキーワードに印をつけてから選択肢を読む練習をしましょう。"
            : "このペースなら見直しの時間も残せます。"}
        </div>
        {DOMAINS.map((d) => {
          const st = pace.perDomain[d.id];
          if (!st || !st.count) return null;
          const ratio = Math.min(1, st.avgMs / (pace.targetMs * 2));
          return (
            <div className="ccaof-stat-row" key={d.id} style={{ "--c": st.avgMs > pace.targetMs ? "#C8323D" : d.color }}>
              <div className="ccaof-stat-name">{d.label}</div>
              <div className="ccaof-stat-track"><div className="ccaof-stat-fill" style={{ width: `${ratio * 100}%` }} /></div>
              <div className="ccaof-stat-num">平均 {formatSeconds(st.avgMs)}</div>
            </div>
          );
        })}
        {pace.slowest.length > 0 && (
          <div className="ccaof-focus-desc" style={{ marginTop: 8 }}>
            時間がかかった問題：{pace.slowest.map((r) => `第${r.no}問 ${formatSeconds(r.ms)}`).join("、")}
          </div>
        )}
      </div>
    </>
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
        {result.englishOnly && " この回は中文訳なし（英文のみ・本番どおり）で受けました。"}
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

      <PaceReport pace={result.pace} />

      <div className="ccaof-quiz-foot" style={{ maxWidth: 720, margin: "20px auto 0" }}>
        <button className="ccaof-btn-ghost" onClick={onBack}>もどる</button>
        <button className="ccaof-btn" style={{ "--c": "#C8743D" }} onClick={onReview}>間違えた問題を見る</button>
      </div>
    </div>
  );
}

function ExamReview({ result, questions, showZh, timeSpent = [], onBack }) {
  const wrong = result.details
    .map((d, i) => ({ ...d, q: questions[i], no: i + 1 }))
    .filter((d) => !d.correct);

  return (
    <div className="ccaof-inner">
      <div className="ccaof-sub-head">まちがえた問題（{wrong.length}問）</div>
      {wrong.length === 0 && <div className="ccaof-empty">全問正解です。</div>}
      {wrong.map((w) => (
        <div className="ccaof-review-item" key={w.id}>
          <div className="ccaof-review-no">
            第 {w.no} 問 · {findDomain(w.q.domain).label}
            {timeSpent[w.no - 1] > 0 && ` · ${formatSeconds(timeSpent[w.no - 1])}`}
          </div>
          {w.q.scenario && <ScenarioBox id={w.q.scenario} showZh={showZh} defaultOpen={false} />}
          <div className="ccaof-stem">{w.q.stem}<SpeakButton text={w.q.stem} label="問題文を読み上げる" /></div>
          {w.q.stemZh && showZh && <div className="ccaof-stem-zh">{w.q.stemZh}<SpeakButton text={w.q.stemZh} lang="zh" /></div>}
          <div className="ccaof-choices">
            {w.q.choices.map((c, i) => {
              let cls = "ccaof-choice";
              if (c.correct) cls += " correct";
              else if (w.picked.includes(i)) cls += " wrong";
              return (
                <div key={i} className={cls}>
                  <div className="ccaof-choice-text">{c.text}<SpeakButton text={c.text} /></div>
                  {c.textZh && showZh && <div className="ccaof-choice-zh">{c.textZh}<SpeakButton text={c.textZh} lang="zh" /></div>}
                  <div className="ccaof-choice-explain">{c.explain}<SpeakButton text={c.explain} lang="ja" label="解説を読み上げる" /></div>
                </div>
              );
            })}
          </div>
          {w.q.commentaryZh && (
            <div className="ccaof-note">
              <div className="ccaof-note-title">中文注解<SpeakButton text={w.q.commentaryZh} lang="zh" /></div>
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
   合格予測

   本番の換算式は非公開。模試の目安スコアと考点別の正答率から出す
   「目安」なので、断定する言い方はしない。データが足りないときは
   数字を出さずに、何が足りないかを書く。
   ============================================================ */

function PredictionCard({ prediction, actions, loading }) {
  if (loading || !prediction) {
    return (
      <div className="ccaof-focus-card" style={{ borderColor: "#C8743D" }}>
        <div className="ccaof-focus-desc">{loading ? "成績を集計しています…" : ""}</div>
      </div>
    );
  }
  const pass = EXAM_FORMAT.passScaled;
  return (
    <div className="ccaof-focus-card ccaof-predict" style={{ borderColor: "#C8743D" }} data-testid="prediction">
      {prediction.ready ? (
        <>
          <div className="ccaof-predict-top">
            <div>
              <div className="ccaof-predict-label">予測スコア（目安）</div>
              <div className={"ccaof-predict-num " + (prediction.gap <= 0 ? "pass" : "fail")}>{prediction.predicted}</div>
            </div>
            <div className="ccaof-predict-gap">
              {prediction.gap > 0
                ? <>合格 {pass} まで<br /><strong>あと {prediction.gap} 点</strong>（約 {prediction.questionsShort} 問）</>
                : <>合格 {pass} を<br /><strong>{-prediction.gap} 点 上回る</strong></>}
            </div>
          </div>
          <div className="ccaof-predict-track">
            <div className="ccaof-predict-fill" style={{ width: `${((prediction.predicted - EXAM_FORMAT.scaleMin) / (EXAM_FORMAT.scaleMax - EXAM_FORMAT.scaleMin)) * 100}%` }} />
            <div className="ccaof-predict-pass" style={{ left: `${((pass - EXAM_FORMAT.scaleMin) / (EXAM_FORMAT.scaleMax - EXAM_FORMAT.scaleMin)) * 100}%` }} />
          </div>
          <div className="ccaof-focus-desc" style={{ marginBottom: 0 }}>
            材料：
            {prediction.examScaled !== null ? `模擬試験 ${prediction.examCount}回（直近の目安 ${prediction.examScaled}）` : "模擬試験なし"}
            {" ／ "}
            {prediction.practiceScaled !== null
              ? `考点別の正答率（配点の ${prediction.coveredWeight}% ぶん、配点で加重 → ${prediction.practiceScaled}）`
              : `考点別の正答率は材料不足（配点の ${prediction.coveredWeight}% ぶん）`}
            。確からしさ：<strong>{prediction.confidence}</strong>。
            本番の換算式は公表されていないので、これは目安で、合否を保証するものではありません。
          </div>
        </>
      ) : (
        <div className="ccaof-focus-desc" style={{ marginBottom: 0 }}>{prediction.reason}</div>
      )}
      {actions.length > 0 && (
        <div className="ccaof-next">
          <div className="ccaof-next-title">次にやること</div>
          <ol>{actions.map((a) => <li key={a}>{a}</li>)}</ol>
        </div>
      )}
    </div>
  );
}

/* ============================================================
   考点讲义

   本文は中国語（学習者は中国語話者）、用語は英語を併記する。
   試験は英語なので、考点の見出しは公式 Exam Guide の英文のまま出す。
   ============================================================ */

function LessonView({ lesson, stat, itemCount, color, onBack, onPractice, onListen }) {
  const pct = pctOf(stat);
  const zh = (t) => <SpeakButton text={t} lang="zh" />;
  return (
    <div className="ccaof-inner">
      <button className="ccaof-back-link" style={{ marginBottom: 12 }} onClick={onBack}>← 考点一覧にもどる</button>
      <div className="ccaof-title-block">
        <div className="ccaof-eyebrow">{lesson.id} · {findDomain(lesson.domain).labelEn}</div>
        <h1 className="ccaof-serif ccaof-lesson-title">{lesson.titleZh}</h1>
        <div className="ccaof-under" />
        <div className="ccaof-lead ccaof-lesson-obj">{lesson.objective}<SpeakButton text={lesson.objective} /></div>
      </div>

      <div className="ccaof-lesson-actions" style={{ marginTop: 0, marginBottom: 12 }}>
        {isSpeechSupported() ? (
          <button className="ccaof-btn" style={{ "--c": "#5B4B8A" }} onClick={onListen}>🎧 この讲义を聞く（ハンズフリー）</button>
        ) : (
          <AudioUnsupported />
        )}
      </div>

      <div className="ccaof-lesson-stat">
        {pct === null ? `この考点の問題 ${itemCount}問（まだ未学習）` : `この考点：正答率 ${pct}%（のべ ${stat.attempted}問）／ 問題 ${itemCount}問`}
      </div>

      <div className="ccaof-lesson-box summary" style={{ "--c": color }}>{lesson.summaryZh}{zh(lesson.summaryZh)}</div>

      <div className="ccaof-lesson-h">核心概念</div>
      <div className="ccaof-lesson-box">
        {lesson.concepts.map((c) => (
          <div className="ccaof-lesson-concept" key={c.term}>
            <div className="ccaof-lesson-term" style={{ "--c": color }}>{c.term}</div>
            <div className="ccaof-lesson-text">{c.zh}<SpeakButton segments={[...splitMixed(c.term, "zh"), { lang: "zh", text: c.zh }]} /></div>
          </div>
        ))}
      </div>

      <div className="ccaof-lesson-h">正例与反例</div>
      <div className="ccaof-lesson-box">
        <div className="ccaof-lesson-ex bad"><span className="ccaof-lesson-tag">✕ 反例</span>{lesson.example.bad}{zh(lesson.example.bad)}</div>
        <div className="ccaof-lesson-ex good"><span className="ccaof-lesson-tag">○ 正例</span>{lesson.example.good}{zh(lesson.example.good)}</div>
        <div className="ccaof-lesson-text" style={{ marginTop: 8 }}>{lesson.example.whyZh}{zh(lesson.example.whyZh)}</div>
      </div>

      <div className="ccaof-lesson-h">常见陷阱</div>
      <ul className="ccaof-lesson-list">{lesson.pitfalls.map((t) => <li key={t}>{t}{zh(t)}</li>)}</ul>

      <div className="ccaof-lesson-h">考试怎么考</div>
      <ul className="ccaof-lesson-list">{lesson.examTips.map((t) => <li key={t}>{t}{zh(t)}</li>)}</ul>

      <div className="ccaof-lesson-h">实务应用</div>
      <div className="ccaof-lesson-box"><div className="ccaof-lesson-text">{lesson.practiceZh}{zh(lesson.practiceZh)}</div></div>

      <div className="ccaof-lesson-h">官方文档</div>
      <div className="ccaof-lesson-box">
        {lesson.references.map((r) => (
          <a key={r.url} className="ccaof-official-link" href={r.url} target="_blank" rel="noopener noreferrer">{r.title} ↗</a>
        ))}
        <div className="ccaof-lesson-note">价格、模型版本、上限值等会变化，请以官方页面为准。</div>
      </div>

      <div className="ccaof-lesson-actions">
        <button className="ccaof-btn" style={{ "--c": color }} onClick={() => onPractice(UNIT_SIZE)} disabled={!itemCount}>
          この考点の問題を解く（{Math.min(UNIT_SIZE, itemCount)}問）
        </button>
        {itemCount > UNIT_SIZE && (
          <button className="ccaof-btn-ghost" onClick={() => onPractice(itemCount)}>すべて（{itemCount}問）</button>
        )}
      </div>
    </div>
  );
}

/* ============================================================
   メイン
   ============================================================ */

export default function CertApp({ onExitApp, onBackToCerts }) {
  const cert = activeCert();
  const [screen, setScreen] = useState("domainSelect"); // domainSelect | unitSelect | quiz | progress | vocab
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

  /* 考点（objective）まわり。考点別の成績・合格予測・今日の復習は全ドメインの
     問題が要るので、資格を開いたら全ドメインぶんと讲义を読んでおく
     （英検など他のアプリでは読まれない）。 */
  const [allItems, setAllItems] = useState(null);
  const [lessons, setLessons] = useState(null);
  const [studyLoadError, setStudyLoadError] = useState(false);
  const [lessonDomainId, setLessonDomainId] = useState(DOMAINS[0].id);
  const [lessonId, setLessonId] = useState(null);
  const [lessonBack, setLessonBack] = useState("lessonList");
  /* 考点練習・弱点考点・今日の復習の出題情報 { label, color, studyLabel, returnTo, exitLabel } */
  const [quizCtx, setQuizCtx] = useState(null);
  /* 音声モード { title, color, tracks, returnTo, exitLabel } */
  const [audioCtx, setAudioCtx] = useState(null);

  const startAudio = useCallback((ctx) => {
    if (!ctx.tracks.length) return;
    setAudioCtx(ctx);
    setScreen("audio");
    window.scrollTo(0, 0);
  }, []);

  const exitAudio = () => {
    setStatsNonce((n) => n + 1);
    setScreen(audioCtx ? audioCtx.returnTo : "domainSelect");
    setAudioCtx(null);
  };

  const onAudioTrackDone = useCallback((t) => {
    if (t.record) recordListen(t.record.kind, t.record.id);
  }, []);

  /* CCAR-F のシナリオ問題は、シナリオが変わったときだけ説明を読み上げる（同じ説明を毎回読まない） */
  const withScenarioText = (qs) =>
    qs.map((q, i) => {
      const sc = q.scenario && !q.material && (i === 0 || qs[i - 1].scenario !== q.scenario) ? findScenario(q.scenario) : null;
      return sc ? { ...q, material: `Scenario: ${sc.title}. ${sc.description}`, materialZh: `场景：${sc.titleZh}。${sc.descriptionZh}` } : q;
    });

  const listenQuestions = (picked, title, color, returnTo, exitLabel) =>
    startAudio({ title, color, tracks: questionTracks(withScenarioText(buildQuestions(picked))), returnTo, exitLabel });

  useEffect(() => {
    let alive = true;
    Promise.all([loadAllDomainItems(), loadLessons()])
      .then(([items, ls]) => {
        if (!alive) return;
        setAllItems(items);
        setLessons(ls);
      })
      .catch(() => {
        if (alive) setStudyLoadError(true);
      });
    return () => {
      alive = false;
    };
  }, [loadNonce]);

  const objectiveIndex = useMemo(() => buildObjectiveIndex(BLUEPRINT, lessons || []), [lessons]);
  const lessonById = useMemo(() => new Map((lessons || []).map((l) => [l.id, l])), [lessons]);
  const lessonTitles = useMemo(() => Object.fromEntries((lessons || []).map((l) => [l.id, l.titleZh])), [lessons]);
  const itemsByObjective = useMemo(() => {
    const m = new Map(OBJECTIVES.map((o) => [o.id, []]));
    (allItems || []).forEach((item) => {
      const id = objectiveIndex.get(item.objective);
      if (id && m.has(id)) m.get(id).push(item);
    });
    return m;
  }, [allItems, objectiveIndex]);

  const startCtxQuiz = useCallback((picked, ctx) => {
    if (!picked.length) return;
    setDomainId(null);
    setQuizCtx(ctx);
    setQuestions(buildQuestions(picked));
    setScreen("quiz");
  }, []);

  const openLesson = (id, back) => {
    setLessonId(id);
    setLessonBack(back);
    setScreen("lesson");
    window.scrollTo(0, 0);
  };

  const startObjectivePractice = (objId, limit) => {
    const items = itemsByObjective.get(objId) || [];
    const picked = pickPracticeItems(items, loadProgress(), getMistakeSummary().ids, limit, shuffle);
    const d = findDomain(objId.split("-")[0]);
    startCtxQuiz(picked, {
      label: `考点 ${objId}`,
      color: d.color,
      studyLabel: `考点 ${objId} 練習`,
      returnTo: "lesson",
      exitLabel: "讲义にもどる",
    });
  };

  const startWeakObjectives = (picks) => {
    const progress = loadProgress();
    const mistakeIds = getMistakeSummary().ids;
    /* 3つの考点から均等に取る（1つの考点の未解答だけで埋まらないように） */
    const per = Math.ceil(UNIT_SIZE / Math.max(1, picks.length));
    const picked = picks
      .flatMap((p) => pickPracticeItems(itemsByObjective.get(p.id) || [], progress, mistakeIds, per, shuffle))
      .slice(0, UNIT_SIZE);
    startCtxQuiz(picked, {
      label: "弱い考点",
      color: "#3F6F52",
      studyLabel: "弱い考点の練習",
      returnTo: "domainSelect",
      exitLabel: "トップにもどる",
    });
  };

  const listenLessons = (fromId, returnTo = "lesson") => {
    const l = lessonById.get(fromId);
    if (!l) return;
    /* その考点から、同じドメインの残りの讲义まで続けて読む */
    const same = (lessons || []).filter((x) => x.domain === l.domain);
    const rest = same.slice(same.findIndex((x) => x.id === fromId));
    startAudio({
      title: rest.length > 1 ? `讲义 ${rest[0].id}〜${rest[rest.length - 1].id}` : `讲义 ${l.id}`,
      color: findDomain(l.domain).color,
      tracks: lessonTracks(rest),
      needLang: "zh",
      returnTo,
      exitLabel: returnTo === "lesson" ? "讲义にもどる" : "讲义一覧にもどる",
    });
  };

  const startTodayReview = () => {
    if (!allItems) return;
    const due = new Set(getDueMistakeIds());
    startCtxQuiz(
      allItems.filter((i) => due.has(i.id)),
      {
        label: "今日の復習",
        color: "#C8323D",
        studyLabel: "錯題本 今日の復習",
        returnTo: "domainSelect",
        exitLabel: "トップにもどる",
      }
    );
  };

  /* シナリオ別練習（CCAR-F）。そのシナリオの問題を、まちがえ → 未解答 → 解答済み の順に */
  const startScenarioPractice = (sc, limit) => {
    if (!allItems) return;
    const items = allItems.filter((i) => i.scenario === sc.id);
    const picked = pickPracticeItems(items, loadProgress(), getMistakeSummary().ids, limit, shuffle);
    startCtxQuiz(picked, {
      label: `シナリオ ${sc.no}`,
      color: "#2F5D8A",
      studyLabel: `シナリオ ${sc.no} ${sc.title}`,
      returnTo: "domainSelect",
      exitLabel: "トップにもどる",
    });
  };

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

  const startExam = useCallback(async (resume, englishOnly = false) => {
    setExamBusy(true);
    try {
      const state = resume || {
        questions: await buildExam(),
        answers: [],
        startedAt: Date.now(),
        englishOnly,
        timeSpent: [],
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

  const recordExamTime = useCallback((index, ms) => {
    if (!(ms > 0)) return;
    setExam((prev) => {
      if (!prev) return prev;
      const timeSpent = [...(prev.timeSpent || [])];
      timeSpent[index] = (timeSpent[index] || 0) + ms;
      const updated = { ...prev, timeSpent };
      saveInProgress(updated);
      return updated;
    });
  }, []);

  const submitExam = useCallback((timedOut) => {
    setExam((prev) => {
      if (!prev) return prev;
      const result = gradeExam(prev.questions, prev.answers);
      result.timedOut = !!timedOut;
      result.englishOnly = !!prev.englishOnly;
      result.pace = paceSummary(prev.questions, prev.timeSpent || [], EXAM_FORMAT);
      saveResult(result);
      clearInProgress();
      // 模試の結果はドメイン別の学習記録にも反映する（勉強履歴は「模擬試験」1回として）
      newStudySession();
      prev.questions.forEach((q, i) => {
        const ok = isCorrect(q, prev.answers[i]);
        recordAnswer(q.domain, q.id, ok, "模擬試験");
        recordReviewResult(q.domain, q.id, ok);
        recordMistakeAnswer({ id: q.id, domain: q.domain }, ok);
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
  /* 重点演習は特定のドメインに属さない。表示用だけの擬似ドメインを使う */
  const FOCUS_DOMAIN = { id: "focus", name: "弱点の重点演習", label: "弱点の重点演習", color: "#3F6F52" };
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

  /* ---- 弱点ドメインの重点演習 ---- */
  const [focusBusy, setFocusBusy] = useState(false);
  const [focusMode, setFocusMode] = useState(false);

  const startFocus = async () => {
    const analysis = analyseWeakness();
    if (!analysis.ready) return;
    setFocusBusy(true);
    try {
      /* 重点対象のドメインだけ読み込む。全部は読まない */
      const loaded = await Promise.all(analysis.focus.map((id) => loadDomainItems(id)));
      const byDomain = {};
      analysis.focus.forEach((id, i) => {
        byDomain[id] = loaded[i];
      });
      const picked = pickFocusItems(byDomain, analysis.focus, UNIT_SIZE);
      if (picked.length === 0) return;
      setDomainId(null);
      setFocusMode(true);
      setQuestions(buildQuestions(picked));
      setScreen("quiz");
    } catch (e) {
      /* 読み込みに失敗したら画面は変えない。利用者はもう一度押せる */
    } finally {
      setFocusBusy(false);
    }
  };

  const exitQuiz = () => {
    setStatsNonce((n) => n + 1);
    if (quizCtx) {
      setScreen(quizCtx.returnTo);
      setQuizCtx(null);
      return;
    }
    if (focusMode) {
      /* 重点演習はドメインに属さないので、ドメイン選択へ戻す */
      setFocusMode(false);
      setScreen("domainSelect");
      return;
    }
    setScreen("unitSelect");
  };

  /* 学習記録は localStorage から毎回読む。useMemo にすると、出題中に
     解いた分が学習記録の画面に出ないまま残る（実際にそうなっていた）。
     ドメインぶんの読み出しなので、描画のたびに読んでも十分に軽い。 */
  /* ---- 学習記録のバックアップ ---- */
  const backupInputRef = useRef(null);
  const [backupMsg, setBackupMsg] = useState(null);

  const handleBackupExport = () => {
    const d = downloadBackup();
    setBackupMsg({
      kind: "ok",
      text: `${d.attempted}問ぶんの記録を書き出しました。ファイルを安全な場所に保存してください。`,
    });
  };

  const handleBackupImport = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = ""; // 同じファイルを続けて選べるようにする
    if (!file) return;
    const result = parseBackup(await file.text());
    if (!result.ok) {
      setBackupMsg({ kind: "ng", text: result.error });
      return;
    }
    const d = describeBackup(result.backup);
    const when = d.exportedAt ? new Date(d.exportedAt).toLocaleDateString() : "日付不明";
    /* 復元は今の記録を置き換える。取り返しがつかないので必ず中身を見せて確認する */
    const okToApply = window.confirm(
      `${when} のバックアップです。\n\n` +
        `・解いた問題　${d.attempted}問（正解 ${d.correct}問）\n` +
        `・学習した日数　${d.days}日\n` +
        `・復習リスト　${d.reviewCount}問\n` +
        `・模擬試験　${d.exams}回\n` +
        `・頻出単語　学習 ${d.vocabWords}語（復習待ち ${d.vocabReview}語）\n` +
        `・錯題本　${d.mistakeCount === null ? "（復習リストから作り直します）" : `${d.mistakeCount}問`}\n` +
        `・音声で聞いた　問題 ${d.listenedItems}問・讲义 ${d.listenedLessons}個\n\n` +
        `今この端末にある記録は、これで置き換えられます。よろしいですか？`
    );
    if (!okToApply) return;
    applyBackup(result.backup);
    window.location.reload();
  };

  const domainStats = screen === "progress" ? getAllDomainStats(DOMAINS.map((d) => d.id)) : [];
  /* 受験履歴も localStorage から毎回読む（useMemo にすると採点直後に古い値が残る） */
  const pastResults = screen === "domainSelect" ? loadResults() : [];
  /* 弱点の判定も localStorage から毎回読む（演習直後に古い値が残らないように） */
  const weakness = screen === "domainSelect" || screen === "progress" ? analyseWeakness() : null;
  /* 考点別の成績・錯題本・合格予測も同じ理由で毎回読む */
  const studyScreens = ["domainSelect", "progress", "lessonList", "lesson"];
  const onStudyScreen = studyScreens.includes(screen);
  const objectiveStats = onStudyScreen && allItems ? collectObjectiveStats(allItems, loadProgress(), objectiveIndex) : null;
  const mistakeSummary = onStudyScreen ? getMistakeSummary() : null;
  const weakObjectives = objectiveStats ? rankWeakObjectives(OBJECTIVES, objectiveStats) : null;
  const prediction =
    objectiveStats && (screen === "domainSelect" || screen === "progress")
      ? predictScore({
          results: loadResults(),
          objectives: OBJECTIVES,
          objectiveStats,
          domains: DOMAINS,
          examFormat: EXAM_FORMAT,
        })
      : null;
  const actions =
    prediction && mistakeSummary
      ? nextActions({
          prediction,
          dueCount: mistakeSummary.due,
          weak: weakObjectives ? weakObjectives.picks : [],
          titles: lessonTitles,
          untouchedCount: OBJECTIVES.filter((o) => !objectiveStats[o.id] || !objectiveStats[o.id].attempted).length,
        })
      : [];
  /* 頻出単語の記録も同じ理由で毎回読む */
  const vocabSummary = screen === "domainSelect" || screen === "progress" ? getVocabSummary() : null;
  const listenSummary = screen === "progress" ? getListenSummary() : null;

  return (
    <div className="ccaof-app">
      <AudioStyle />
      <style>{`
        .ccaof-focus-card {
          max-width: 720px; margin: 0 auto; background: #fff;
          border: 2px solid #3F6F52; border-radius: 10px; padding: 16px 18px;
        }
        .ccaof-focus-title { font-size: 15px; font-weight: 800; color: #3F6F52; }
        .ccaof-focus-desc { font-size: 12.5px; color: #6B7280; line-height: 1.7; margin: 6px 0 12px; }
        .ccaof-focus-rows { margin-bottom: 12px; }
        .ccaof-focus-row {
          display: flex; align-items: baseline; gap: 8px;
          padding: 6px 0; border-top: 1px solid #EEE; font-size: 13px;
        }
        .ccaof-focus-id { font-weight: 800; color: #3F6F52; min-width: 26px; }
        .ccaof-focus-name { flex: 1; color: #333; }
        .ccaof-focus-pct { color: #6B7280; font-size: 12px; white-space: nowrap; }
        .ccaof-backup-row {
          display: flex; gap: 8px; flex-wrap: wrap; margin-top: 4px;
        }
        .ccaof-backup-msg {
          margin-top: 8px; padding: 8px 10px; border-radius: 8px;
          font-size: 13px; line-height: 1.6;
        }
        .ccaof-backup-msg.ok { background: #EAF3EC; color: #2F5D3A; }
        .ccaof-backup-msg.ng { background: #F7E9E7; color: #8A3324; }

        /* ---- 合格予測・錯題本・考点讲义（v1.31.0） ---- */
        .ccaof-badge {
          display: inline-block; min-width: 22px; padding: 1px 7px; margin-left: 8px;
          border-radius: 11px; background: #C8323D; color: #fff; font-size: 12px;
          text-align: center; vertical-align: 2px;
        }
        .ccaof-predict-top { display: flex; justify-content: space-between; align-items: flex-end; gap: 12px; flex-wrap: wrap; }
        .ccaof-predict-label { font-size: 12px; color: #6B7280; font-weight: 700; }
        .ccaof-predict-num { font-size: 36px; font-weight: 800; line-height: 1.1; }
        .ccaof-predict-num.pass { color: #1F6B45; }
        .ccaof-predict-num.fail { color: #C8743D; }
        .ccaof-predict-gap { font-size: 13px; color: #4B5563; text-align: right; line-height: 1.6; }
        .ccaof-predict-track { position: relative; height: 8px; background: #EDEBE3; border-radius: 4px; margin: 10px 0 8px; }
        .ccaof-predict-fill { height: 100%; background: #C8743D; border-radius: 4px; }
        .ccaof-predict-pass { position: absolute; top: -4px; width: 2px; height: 16px; background: #1F6B45; }
        .ccaof-next { margin-top: 10px; padding-top: 10px; border-top: 1px solid #EEE; }
        .ccaof-next-title { font-size: 13px; font-weight: 800; color: #3F6F52; margin-bottom: 4px; }
        .ccaof-next ol { margin: 0; padding-left: 20px; list-style: decimal; }
        .ccaof-next li { font-size: 13px; line-height: 1.7; color: #333; }
        .ccaof-row-btn { width: 100%; background: none; border-left: none; border-right: none; border-bottom: none; cursor: pointer; text-align: left; font: inherit; color: inherit; }
        .ccaof-stat-row.ccaof-row-btn { border: none; padding: 2px 0; }
        .ccaof-row-btn:hover .ccaof-focus-name, .ccaof-row-btn:hover .ccaof-stat-name { text-decoration: underline; }
        .ccaof-obj-group { margin-bottom: 12px; }
        .ccaof-obj-group-head { font-size: 12.5px; font-weight: 800; margin: 6px 0; }
        .ccaof-inline-link { background: none; border: none; padding: 0; color: #2F5D8A; text-decoration: underline; cursor: pointer; font-size: 12px; }
        .ccaof-chips { display: flex; flex-wrap: wrap; gap: 6px; max-width: 720px; margin: 0 auto; }
        .ccaof-chip { border: 2px solid var(--c); color: var(--c); background: #fff; border-radius: 16px; padding: 6px 14px; font-weight: 800; font-size: 13px; cursor: pointer; min-width: 48px; }
        .ccaof-chip.on { background: var(--c); color: #fff; }
        .ccaof-lesson-title { font-size: 24px; line-height: 1.4; }
        .ccaof-lesson-obj { font-style: italic; }
        .ccaof-lesson-stat { text-align: center; font-size: 12.5px; color: #6B7280; margin-bottom: 12px; }
        .ccaof-lesson-h { font-size: 14px; font-weight: 800; color: #2A2E27; margin: 20px 0 8px; }
        .ccaof-lesson-box { background: #fff; border: 1px solid #E4E2DA; border-radius: 10px; padding: 12px 14px; }
        .ccaof-lesson-box.summary { border-left: 4px solid var(--c); font-size: 14px; line-height: 1.9; }
        .ccaof-lesson-concept + .ccaof-lesson-concept { border-top: 1px solid #EEE; margin-top: 10px; padding-top: 10px; }
        .ccaof-lesson-term { font-weight: 800; color: var(--c); font-size: 13.5px; margin-bottom: 2px; }
        .ccaof-lesson-text { font-size: 14px; line-height: 1.85; color: #333; }
        .ccaof-lesson-ex { font-size: 14px; line-height: 1.8; padding: 8px 10px; border-radius: 8px; margin-bottom: 6px; }
        .ccaof-lesson-ex.bad { background: #F7E9E7; }
        .ccaof-lesson-ex.good { background: #EAF3EC; }
        .ccaof-lesson-tag { font-weight: 800; margin-right: 6px; font-size: 12.5px; }
        .ccaof-lesson-ex.bad .ccaof-lesson-tag { color: #8A3324; }
        .ccaof-lesson-ex.good .ccaof-lesson-tag { color: #2F5D3A; }
        .ccaof-lesson-list { background: #fff; border: 1px solid #E4E2DA; border-radius: 10px; padding: 10px 14px 10px 30px; margin: 0; list-style: disc; }
        .ccaof-lesson-list li { font-size: 14px; line-height: 1.85; color: #333; margin: 2px 0; }
        .ccaof-lesson-note { font-size: 12px; color: #9AA093; margin-top: 6px; }
        .ccaof-lesson-actions { display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; margin-top: 24px; }
        @media (max-width: 480px) {
          .ccaof-stat-name { width: 120px; }
          .ccaof-stat-num { width: 92px; }
          .ccaof-lesson-actions .ccaof-btn { width: 100%; }
        }
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
        .ccaof-choice.done { cursor: default; }
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
        .ccaof-en-badge { display: inline-block; font-size: 11px; font-weight: 700; color: #fff; background: #2F5D8A; border-radius: 4px; padding: 1px 6px; margin-right: 8px; }
        .ccaof-pace-main { font-size: 16px; font-weight: 700; margin-bottom: 6px; }
        .ccaof-pace-main.pass { color: #1F6B45; }
        .ccaof-pace-main.fail { color: #C8323D; }

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
        .ccaof-unofficial { display: inline-block; font-size: 9.5px; font-weight: 800; color: #8A3324; background: #F7E9E7; border-radius: 4px; padding: 0 4px; margin-left: 2px; vertical-align: 1px; }
        .ccaof-scenario { background: #F2F6FA; border: 1px solid #C9D6E3; border-left: 4px solid #2F5D8A; border-radius: 8px; padding: 8px 12px; margin-bottom: 12px; }
        .ccaof-scenario summary { cursor: pointer; font-size: 13px; font-weight: 800; color: #2F5D8A; }
        .ccaof-scenario-tag { background: #2F5D8A; color: #fff; border-radius: 4px; padding: 1px 6px; font-size: 11px; margin-right: 4px; }
        .ccaof-scenario-zh-title { font-weight: 600; color: #4B5563; }
        .ccaof-scenario-body { font-size: 13px; line-height: 1.8; color: #333; margin-top: 6px; }
        .ccaof-scenario-body.zh { color: #5A5F55; border-top: 1px dashed #C9D6E3; padding-top: 6px; }
        .ccaof-scenario-new { font-size: 11.5px; font-weight: 800; color: #2F5D8A; margin-bottom: 6px; }
        .ccaof-domain-card:disabled { opacity: 0.55; cursor: default; }
        .ccaof-official-link { font-size: 13px; color: #2F5D8A; text-decoration: underline; display: block; margin-bottom: 6px; }
      `}</style>

      <div className="ccaof-top-nav">
        <div style={{ display: "flex", gap: 12 }}>
          {onBackToCerts && <button className="ccaof-back-link" onClick={onBackToCerts}>← 資格の選択</button>}
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
            <div className="ccaof-eyebrow">{cert.eyebrow}</div>
            <h1 className="ccaof-serif">{cert.title}</h1>
            <div className="ccaof-under" />
            <div className="ccaof-lead">{cert.lead}</div>
          </div>

          <div className="ccaof-exam-facts">
            <div className="ccaof-fact"><div className="ccaof-fact-num">{EXAM_FORMAT.items}</div><div className="ccaof-fact-label">問 <UnofficialMark field="items" /></div></div>
            <div className="ccaof-fact"><div className="ccaof-fact-num">{EXAM_FORMAT.minutes}</div><div className="ccaof-fact-label">分 <UnofficialMark field="minutes" /></div></div>
            <div className="ccaof-fact"><div className="ccaof-fact-num">{EXAM_FORMAT.passScaled}</div><div className="ccaof-fact-label">合格点（{EXAM_FORMAT.scaleMax}点満点） <UnofficialMark field="passScaled" /></div></div>
            <div className="ccaof-fact"><div className="ccaof-fact-num">{EXAM_FORMAT.validityMonths}</div><div className="ccaof-fact-label">か月有効 <UnofficialMark field="validityMonths" /></div></div>
          </div>
          {EXAM_FORMAT.scenariosPerExam && (
            <div className="ccaof-lead" style={{ textAlign: "center" }} data-testid="scenario-format">
              本番はシナリオ形式：{EXAM_FORMAT.scenarioBank} シナリオから {EXAM_FORMAT.scenariosPerExam} つを抽選 <UnofficialMark field="scenariosPerExam" />
              ／ 1 シナリオあたり約 {EXAM_FORMAT.questionsPerScenario} 問 <UnofficialMark field="questionsPerScenario" />
            </div>
          )}

          {studyLoadError && (
            <div className="ccaof-empty">
              考点別の成績・讲义を読み込めませんでした。通信を確認して、もう一度ためしてください。
              <div style={{ marginTop: 10 }}>
                <button className="ccaof-btn-ghost" onClick={() => { setStudyLoadError(false); setLoadNonce((n) => n + 1); }}>もう一度</button>
              </div>
            </div>
          )}

          <div className="ccaof-sub-head">合格予測</div>
          <PredictionCard prediction={prediction} actions={actions} loading={!allItems && !studyLoadError} />

          <div className="ccaof-sub-head">音声モード</div>
          <div className="ccaof-audio-card" style={{ maxWidth: 720, margin: "0 auto" }} data-testid="audio-card">
            <div className="ccaof-audio-card-title">🎧 疲れたときは耳で学習（ハンズフリー）</div>
            <div className="ccaof-audio-card-desc">
              問題・讲义・頻出単語を自動で読み上げて、画面を見なくても次へ進みます。
              一時停止／再開・前へ／次へ・速度（0.75〜1.25倍）・読む言語（英語／日本語／中文）を切り替えられます。
              問題は「問題文 → 選択肢 → 考える間 → 正解と解説」の順。各画面のテキストの横の🔊でも1つずつ読めます。
            </div>
            {isSpeechSupported() ? (
              <div className="ccaof-audio-row">
                <button
                  className="ccaof-btn"
                  style={{ "--c": "#5B4B8A" }}
                  disabled={!allItems || !mistakeSummary || mistakeSummary.due === 0}
                  onClick={() => {
                    const due = new Set(getDueMistakeIds());
                    listenQuestions(allItems.filter((i) => due.has(i.id)), "今日の復習を聞く", "#C8323D", "domainSelect", "トップにもどる");
                  }}
                >
                  今日の復習を聞く{mistakeSummary && mistakeSummary.due > 0 ? `（${mistakeSummary.due}問）` : ""}
                </button>
                <button className="ccaof-btn-ghost" onClick={() => setScreen("lessonList")}>讲义を聞く</button>
                <button className="ccaof-btn-ghost" onClick={() => setScreen("vocab")}>頻出単語を聞く</button>
              </div>
            ) : (
              <AudioUnsupported />
            )}
            <div style={{ fontSize: 11.5, color: "#9AA093", marginTop: 6 }}>
              ドメインの問題は、各ドメインの画面の「🎧 音声で聞く」から。
            </div>
          </div>

          <div className="ccaof-sub-head">錯題本</div>
          <div className="ccaof-focus-card" style={{ borderColor: "#C8323D" }} data-testid="review-card">
            <div className="ccaof-focus-title" style={{ color: "#C8323D" }}>
              📕 今日の復習
              {mistakeSummary && mistakeSummary.due > 0 && <span className="ccaof-badge" data-testid="due-badge">{mistakeSummary.due}</span>}
            </div>
            <div className="ccaof-focus-desc">
              まちがえた問題は、模擬試験・ドメイン練習・考点練習のどこでも錯題本に入ります。
              1日後 → 3日後 → 7日後と間をあけて出し直し、2回続けて正解すると外れます。
              {mistakeSummary && `（錯題本 ${mistakeSummary.total}問・きょう期限 ${mistakeSummary.due}問）`}
            </div>
            <button
              className="ccaof-btn"
              style={{ "--c": "#C8323D" }}
              onClick={startTodayReview}
              disabled={!allItems || !mistakeSummary || mistakeSummary.due === 0}
            >
              {mistakeSummary && mistakeSummary.due > 0 ? `今日の復習を始める（${mistakeSummary.due}問）` : "きょうの復習はありません"}
            </button>
          </div>

          <div className="ccaof-sub-head">考点讲义</div>
          <div className="ccaof-focus-card" style={{ borderColor: "#2F6E8A" }}>
            <div className="ccaof-focus-title" style={{ color: "#2F6E8A" }}>📖 {OBJECTIVES.length} 考点の讲义（中文）</div>
            <div className="ccaof-focus-desc">
              公式 Exam Guide の {OBJECTIVES.length} の出題目標（{BLUEPRINT.objectiveLabel || "objective"}）ごとに、核心概念・正例と反例・よくある落とし穴・
              試験での問われ方・実務での使い方・公式ドキュメントをまとめました。読んだらその考点の問題だけを解けます。
            </div>
            <button className="ccaof-btn" style={{ "--c": "#2F6E8A" }} onClick={() => setScreen("lessonList")}>讲义を開く</button>
          </div>

          <div className="ccaof-sub-head">弱点を重点的に</div>
          {weakObjectives && (
            <div className="ccaof-focus-card" style={{ marginBottom: 10 }}>
              <div className="ccaof-focus-title">弱い 3 考点だけ練習</div>
              <div className="ccaof-focus-desc">
                解答数が {MIN_OBJECTIVE_ATTEMPTS}問以上の考点を、正答率の低い順に選びます。
                {weakObjectives.judgeableCount < 3 && `判断できる考点がまだ ${weakObjectives.judgeableCount} 個なので、解答の少ない考点で補っています。`}
              </div>
              <div className="ccaof-focus-rows">
                {weakObjectives.picks.map((r) => (
                  <button className="ccaof-focus-row ccaof-row-btn" key={r.id} onClick={() => openLesson(r.id, "domainSelect")}>
                    <span className="ccaof-focus-id">{r.id}</span>
                    <span className="ccaof-focus-name">{lessonTitles[r.id] || r.text}</span>
                    <span className="ccaof-focus-pct">
                      {r.reason === "weak" ? `${r.pct}%（${r.attempted}問）` : r.attempted ? `データ少（${r.attempted}問）` : "未学習"}
                    </span>
                  </button>
                ))}
              </div>
              <button className="ccaof-btn" style={{ "--c": "#3F6F52" }} onClick={() => startWeakObjectives(weakObjectives.picks)}>
                この3考点から {UNIT_SIZE}問 解く
              </button>
            </div>
          )}
          <div className="ccaof-focus-card">
            {weakness && weakness.ready ? (
              <>
                <div className="ccaof-focus-title">
                  いま優先すべきは {weakness.ranked.slice(0, 3).map((r) => r.id).join("・")}
                </div>
                <div className="ccaof-focus-desc">
                  {weakness.hasExam
                    ? "模擬試験と演習の実績から割り出しています。"
                    : "演習の実績から割り出しています。模擬試験を受けると精度が上がります。"}
                  正答率だけでなく配点比率も掛けているので、同じ苦手でも配点の重いドメインが先に来ます。
                </div>
                <div className="ccaof-focus-rows">
                  {weakness.ranked.slice(0, 3).map((r) => (
                    <div className="ccaof-focus-row" key={r.id}>
                      <span className="ccaof-focus-id">{r.id}</span>
                      <span className="ccaof-focus-name">{r.name}</span>
                      <span className="ccaof-focus-pct">{r.pct}%（{r.rawAttempted}問・配点{r.weight}%）</span>
                    </div>
                  ))}
                </div>
                <button className="ccaof-btn" style={{ "--c": "#3F6F52" }} onClick={startFocus} disabled={focusBusy}>
                  {focusBusy ? "問題を準備しています…" : `この3つから ${UNIT_SIZE}問 解く`}
                </button>
              </>
            ) : (
              <div className="ccaof-focus-desc">{weakness ? weakness.reason : ""}</div>
            )}
          </div>

          {SCENARIOS.length > 0 && (
            <>
              <div className="ccaof-sub-head">シナリオ別に練習（本番と同じ形式）</div>
              <div className="ccaof-domain-grid" style={{ marginTop: 0 }} data-testid="scenario-list">
                {SCENARIOS.map((sc) => {
                  const n = allItems ? allItems.filter((i) => i.scenario === sc.id).length : 0;
                  return (
                    <button key={sc.id} className="ccaof-domain-card" style={{ "--c": "#2F5D8A" }} disabled={!allItems || !n} onClick={() => startScenarioPractice(sc, UNIT_SIZE)}>
                      <div className="ccaof-domain-top">
                        <span className="ccaof-domain-label">シナリオ {sc.no}　{sc.title}</span>
                        <span className="ccaof-domain-weight">{allItems ? `${n}問 → ${Math.min(UNIT_SIZE, n)}問出題` : "…"}</span>
                      </div>
                      <div className="ccaof-domain-en">{sc.titleZh}／主なドメイン：{sc.primaryDomains.join("・")}</div>
                    </button>
                  );
                })}
              </div>
            </>
          )}

          <div className="ccaof-sub-head">頻出単語</div>
          <div className="ccaof-focus-card" style={{ borderColor: "#7A5C2E" }}>
            <div className="ccaof-focus-title" style={{ color: "#7A5C2E" }}>📘 問題によく出る単語（勉強・復習・テスト）</div>
            <div className="ccaof-focus-desc">
              全問題の設問・選択肢・解説によく出る単語を、出てくる問題が多い順に20語ずつ。
              単語カードで覚えて、4択テストで確かめ、まちがえた単語を復習します。
              {vocabSummary.touched > 0 && `（習熟 ${vocabSummary.mastered}語・復習待ち ${vocabSummary.reviewCount}語）`}
            </div>
            <button className="ccaof-btn" style={{ "--c": "#7A5C2E" }} onClick={() => setScreen("vocab")}>頻出単語を開く</button>
          </div>

          <div className="ccaof-sub-head">模擬試験</div>
          <div className="ccaof-exam-card">
            <div className="ccaof-exam-card-title">本番と同じ {EXAM_FORMAT.items}問 / {EXAM_FORMAT.minutes}分</div>
            <div className="ccaof-exam-card-desc">
              {EXAM_FORMAT.scenariosPerExam
                ? `本番と同じく ${EXAM_FORMAT.scenarioBank} シナリオから ${EXAM_FORMAT.scenariosPerExam} つを抽選し、シナリオごとに約 ${Math.round(EXAM_FORMAT.items / EXAM_FORMAT.scenariosPerExam)}問ずつ出題します。各シナリオの中では配点比率に近づくようにドメインを選びます。`
                : `配点比率どおりに全ドメインから出題します（${[...DOMAINS].sort((a, b) => b.weight - a.weight).slice(0, 2).map((d) => `${d.id} から ${examCounts[d.id]}問`).join("、")}…）。`}
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
              <>
                <div className="ccaof-focus-desc">
                  本番は英語だけで出題されます。仕上げの模試は「英文のみ」で受け、1問あたりの時間（目安 {formatSeconds((EXAM_FORMAT.minutes * 60 * 1000) / EXAM_FORMAT.items)}）も確かめましょう。
                </div>
                <div className="ccaof-delete-actions" style={{ justifyContent: "flex-start" }}>
                  <button className="ccaof-btn" style={{ "--c": "#C8743D" }} onClick={() => startExam(null, true)} disabled={examBusy}>
                    {examBusy ? "問題を準備しています…" : "英文のみで受ける（本番どおり）"}
                  </button>
                  <button className="ccaof-btn-ghost" onClick={() => startExam(null, false)} disabled={examBusy}>
                    中文訳つきで受ける（練習）
                  </button>
                </div>
              </>
            )}
            {pastResults.length > 0 && (
              <div className="ccaof-exam-history">
                <div className="ccaof-exam-history-title">これまでの結果</div>
                {pastResults.slice(0, 5).map((r) => (
                  <div className="ccaof-exam-history-row" key={r.finishedAt}>
                    <span>{new Date(r.finishedAt).toLocaleDateString()}</span>
                    <span>{r.correct} / {r.total}{r.englishOnly ? "（英文のみ）" : ""}</span>
                    {r.avgMs > 0 && <span>平均 {formatSeconds(r.avgMs)}/問</span>}
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
              {cert.officialDesc.replace("${fee}", `$${EXAM_FORMAT.feeUsd}`)}
            </div>
            {BLUEPRINT.sources && (
              <div className="ccaof-official-desc" data-testid="blueprint-sources">
                大綱の出典（確認日 {BLUEPRINT.checkedAt}）：
                {BLUEPRINT.sources.map((src) => (
                  <div key={src.url}>
                    ・<a href={src.url} target="_blank" rel="noopener noreferrer">{src.title}</a>
                    {src.kind === "official" ? "（公式）" : "（非公式・第三者）"}
                  </div>
                ))}
                {BLUEPRINT.unofficialNote && <div style={{ marginTop: 4 }}>{BLUEPRINT.unofficialNote}</div>}
              </div>
            )}
            {cert.links.map((l) => (
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

          <div className="ccaof-sub-head">このドメインで問われること（公式 Exam Guide{BLUEPRINT.objectiveLabel ? ` の ${BLUEPRINT.objectiveLabel}` : ""}）</div>
          <div className="ccaof-objectives">
            <ul>
              {domain.objectives.map((o, i) => (
                <li key={o}>
                  {o}{" "}
                  <button className="ccaof-inline-link" onClick={() => openLesson(`${domain.id}-${i + 1}`, "unitSelect")}>
                    讲义 ›
                  </button>
                </li>
              ))}
            </ul>
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
              <div className="ccaof-sub-head">🎧 音声で聞く（ハンズフリー）</div>
              <div className="ccaof-audio-card" style={{ maxWidth: 720, margin: "0 auto", borderColor: domain.color }}>
                <div className="ccaof-audio-card-desc" style={{ marginTop: 0 }}>
                  問題文 → 選択肢 → 考える間 → 正解 → 解説（→ 中文注解）の順に、20問ずつ自動で読み進めます。
                  聞いただけでは正答率や錯題本には数えません（学習記録の「音声で聞いた」に残ります）。
                </div>
                {isSpeechSupported() ? (
                  <div className="ccaof-audio-row">
                    {Array.from({ length: unitCount(items.length) }, (_, u) => (
                      <button
                        key={u}
                        className="ccaof-unit-btn"
                        style={{ "--c": domain.color }}
                        onClick={() => listenQuestions(items.slice(u * UNIT_SIZE, u * UNIT_SIZE + UNIT_SIZE), `${domain.label} ${u + 1}組`, domain.color, "unitSelect", "ドメインにもどる")}
                      >
                        🎧 {u + 1}組
                      </button>
                    ))}
                    {getReviewCount(domainId) > 0 && (
                      <button
                        className="ccaof-unit-btn"
                        style={{ "--c": "#C8323D" }}
                        onClick={() => {
                          const ids = getReviewIds(domainId);
                          listenQuestions(items.filter((i) => ids.includes(i.id)), `${domain.label} まちがえた問題`, domain.color, "unitSelect", "ドメインにもどる");
                        }}
                      >
                        🎧 まちがえた問題（{getReviewCount(domainId)}問）
                      </button>
                    )}
                  </div>
                ) : (
                  <AudioUnsupported />
                )}
              </div>

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
          englishOnly={!!exam.englishOnly}
          onTime={recordExamTime}
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
          timeSpent={exam.timeSpent || []}
          onBack={() => setScreen("examResult")}
        />
      )}

      {screen === "quiz" && (quizCtx || domain || focusMode) && (
        <Quiz
          domain={quizCtx ? { id: "ctx", label: quizCtx.label, color: quizCtx.color } : domain || FOCUS_DOMAIN}
          questions={questions}
          onExit={exitQuiz}
          showZh={showZh}
          onToggleZh={toggleZh}
          studyLabel={quizCtx ? quizCtx.studyLabel : undefined}
          exitLabel={quizCtx ? quizCtx.exitLabel : undefined}
        />
      )}

      {screen === "lessonList" && (
        <div className="ccaof-inner">
          <button className="ccaof-back-link" style={{ marginBottom: 12 }} onClick={() => setScreen("domainSelect")}>← トップにもどる</button>
          <div className="ccaof-title-block">
            <div className="ccaof-eyebrow">{OBJECTIVES.length} OBJECTIVES — 考点讲义</div>
            <h1 className="ccaof-serif">考点讲义</h1>
            <div className="ccaof-under" />
            <div className="ccaof-lead">ドメインを選び、考点を開いて讲义を読みます。讲义の最後から、その考点の問題だけを解けます。</div>
          </div>
          <div className="ccaof-chips">
            {DOMAINS.map((d) => (
              <button
                key={d.id}
                className={"ccaof-chip" + (d.id === lessonDomainId ? " on" : "")}
                style={{ "--c": d.color }}
                onClick={() => setLessonDomainId(d.id)}
              >
                {d.id}
              </button>
            ))}
          </div>
          {(() => {
            const d = findDomain(lessonDomainId);
            return (
              <>
                <div className="ccaof-sub-head" style={{ color: d.color }}>{d.id} {d.label}（{d.weight}%）</div>
                {lessons && isSpeechSupported() && (
                  <div style={{ maxWidth: 720, margin: "0 auto 10px" }}>
                    <button className="ccaof-btn-ghost" onClick={() => listenLessons(`${d.id}-1`, "lessonList")}>
                      🎧 {d.id} の讲义を続けて聞く
                    </button>
                  </div>
                )}
                {!lessons ? (
                  studyLoadError ? (
                    <div className="ccaof-empty">讲义を読み込めませんでした。</div>
                  ) : (
                    <DomainLoading label="讲义を読み込んでいます…" />
                  )
                ) : (
                  <div className="ccaof-domain-grid" style={{ marginTop: 0 }}>
                    {OBJECTIVES.filter((o) => o.domain === d.id).map((o) => {
                      const l = lessonById.get(o.id);
                      const st = objectiveStats ? objectiveStats[o.id] : null;
                      const pct = pctOf(st);
                      return (
                        <button key={o.id} className="ccaof-domain-card" style={{ "--c": d.color }} onClick={() => openLesson(o.id, "lessonList")}>
                          <div className="ccaof-domain-top">
                            <span className="ccaof-domain-label">{o.id} {l ? l.titleZh : ""}</span>
                            <span className="ccaof-domain-weight">{(itemsByObjective.get(o.id) || []).length}問</span>
                          </div>
                          <div className="ccaof-domain-en">{o.text}</div>
                          <div className="ccaof-domain-stat">{pct === null ? "まだ未学習" : `正答率 ${pct}%（のべ ${st.attempted}問）`}</div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </>
            );
          })()}
        </div>
      )}

      {screen === "lesson" && lessonId && (
        lessonById.get(lessonId) ? (
          <LessonView
            lesson={lessonById.get(lessonId)}
            stat={objectiveStats ? objectiveStats[lessonId] : null}
            itemCount={(itemsByObjective.get(lessonId) || []).length}
            color={findDomain(lessonId.split("-")[0]).color}
            onBack={() => {
              if (lessonBack === "lessonList") setLessonDomainId(lessonId.split("-")[0]);
              setScreen(lessonBack);
            }}
            onPractice={(limit) => startObjectivePractice(lessonId, limit)}
            onListen={() => listenLessons(lessonId)}
          />
        ) : (
          <DomainLoading label="讲义を読み込んでいます…" />
        )
      )}

      {screen === "audio" && audioCtx && (
        <AudioPlayer
          title={audioCtx.title}
          color={audioCtx.color}
          tracks={audioCtx.tracks}
          needLang={audioCtx.needLang}
          defaultZh={showZh}
          onTrackDone={onAudioTrackDone}
          onExit={exitAudio}
          exitLabel={audioCtx.exitLabel}
          recordNote="最後まで聞いた問題・讲义は学習記録の「音声で聞いた」に残ります（正答率・錯題本・合格予測は、答えた問題だけで計算します）。"
        />
      )}

      {screen === "vocab" && (
        <CertVocab
          showZh={showZh}
          onToggleZh={toggleZh}
          onExit={() => { setStatsNonce((n) => n + 1); setScreen("domainSelect"); }}
        />
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
          <div className="ccaof-sub-head">合格予測</div>
          <PredictionCard prediction={prediction} actions={actions} loading={!allItems && !studyLoadError} />

          <div className="ccaof-sub-head">錯題本</div>
          <div className="ccaof-exam-facts" style={{ marginTop: 0 }}>
            <div className="ccaof-fact"><div className="ccaof-fact-num">{mistakeSummary ? mistakeSummary.total : 0}</div><div className="ccaof-fact-label">錯題本の問題</div></div>
            <div className="ccaof-fact"><div className="ccaof-fact-num">{mistakeSummary ? mistakeSummary.due : 0}</div><div className="ccaof-fact-label">きょう期限</div></div>
          </div>

          <div className="ccaof-sub-head">考点別の正答率（{OBJECTIVES.length} 考点）</div>
          {!objectiveStats ? (
            <DomainLoading label="集計しています…" />
          ) : (
            <div style={{ maxWidth: 720, margin: "0 auto" }} data-testid="objective-stats">
              {DOMAINS.map((d) => (
                <div key={d.id} className="ccaof-obj-group">
                  <div className="ccaof-obj-group-head" style={{ color: d.color }}>{d.id} {d.label}</div>
                  {OBJECTIVES.filter((o) => o.domain === d.id).map((o) => {
                    const st = objectiveStats[o.id];
                    const pct = pctOf(st);
                    return (
                      <button className="ccaof-stat-row ccaof-row-btn" key={o.id} style={{ "--c": d.color }} onClick={() => openLesson(o.id, "progress")}>
                        <div className="ccaof-stat-name">{o.id} {lessonTitles[o.id] || ""}</div>
                        <div className="ccaof-stat-track"><div className="ccaof-stat-fill" style={{ width: `${pct ?? 0}%` }} /></div>
                        <div className="ccaof-stat-num">{pct === null ? "未学習" : `${pct}%（${st.attempted}問）`}</div>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          )}

          <div className="ccaof-sub-head">頻出単語</div>
          <div className="ccaof-exam-facts" style={{ marginTop: 0 }}>
            <div className="ccaof-fact"><div className="ccaof-fact-num">{vocabSummary.touched}</div><div className="ccaof-fact-label">学習した単語</div></div>
            <div className="ccaof-fact"><div className="ccaof-fact-num">{vocabSummary.mastered}</div><div className="ccaof-fact-label">習熟（2回連続正解）</div></div>
            <div className="ccaof-fact"><div className="ccaof-fact-num">{vocabSummary.reviewCount}</div><div className="ccaof-fact-label">復習待ち</div></div>
            <div className="ccaof-fact"><div className="ccaof-fact-num">{vocabSummary.attempted ? `${Math.round((vocabSummary.correct / vocabSummary.attempted) * 100)}%` : "—"}</div><div className="ccaof-fact-label">単語テスト正答率</div></div>
          </div>

          <div className="ccaof-sub-head">音声で聞いた（音声モード）</div>
          <div className="ccaof-exam-facts" style={{ marginTop: 0 }} data-testid="listen-stats">
            <div className="ccaof-fact"><div className="ccaof-fact-num">{listenSummary.today}</div><div className="ccaof-fact-label">きょう聞いた</div></div>
            <div className="ccaof-fact"><div className="ccaof-fact-num">{listenSummary.items}</div><div className="ccaof-fact-label">聞いた問題</div></div>
            <div className="ccaof-fact"><div className="ccaof-fact-num">{listenSummary.lessons}</div><div className="ccaof-fact-label">聞いた讲义</div></div>
            <div className="ccaof-fact"><div className="ccaof-fact-num">{listenSummary.words}</div><div className="ccaof-fact-label">聞いた単語</div></div>
          </div>

          <div className="ccaof-official-box">
            <div className="ccaof-official-desc">
              学習記録はこの端末のブラウザにだけ保存されます。別の端末に替えたときや、
              閲覧データを消したときに失われるので、ときどき書き出しておいてください。
            </div>
            <div className="ccaof-backup-row">
              <button className="ccaof-btn-ghost" onClick={handleBackupExport}>
                ⬇ ファイルに書き出す
              </button>
              <button className="ccaof-btn-ghost" onClick={() => backupInputRef.current?.click()}>
                ⬆ ファイルから戻す
              </button>
              <input
                ref={backupInputRef}
                type="file"
                accept="application/json,.json"
                style={{ display: "none" }}
                onChange={handleBackupImport}
              />
            </div>
            {backupMsg && (
              <div className={`ccaof-backup-msg ${backupMsg.kind}`}>{backupMsg.text}</div>
            )}
          </div>
          <div className="ccaof-official-box">
            <div className="ccaof-official-desc">
              本番の score report もドメイン別の正答率を出します（合否はスケールドスコアの合計で決まり、
              ドメイン別は参考値）。ここで弱いドメインは、配点比率の高いものから先に埋めるのが効率的です。
            </div>
            <button className="ccaof-btn-ghost" onClick={() => { if (window.confirm(`${cert.code} の学習記録（問題演習・頻出単語・音声で聞いた記録）をすべて消します。よろしいですか？`)) { resetProgress(); setStatsNonce((n) => n + 1); } }}>
              学習記録をリセット
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
