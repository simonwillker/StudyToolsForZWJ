import React, { useMemo, useState, useEffect, useRef, useCallback } from "react";
import { recordAnswer } from "./eikenProgress";
import { saveTestResult, getTestResults, formatDateTime } from "./eikenTestResults";
import { isSpeechSynthesisSupported, speak, stopSpeaking } from "./eikenSpeech";

/* ============================================================
   英検 模擬テスト（本番形式）
   過去問（一次試験）の大問構成にもとづいて1回分のテストを実施する。
   問題データは src/data/eikenTest/<級>.json（コード変更なしで追加可能）。
   ============================================================ */

/* ---------- ユーティリティ ---------- */

function normalizeSentence(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9' ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function formatClock(sec) {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

function countWords(text) {
  const t = String(text || "").trim();
  if (!t) return 0;
  return t.split(/\s+/).length;
}

/** 選択肢をシャッフルする。データ上はほぼ常に正解が先頭に置かれているため、
 *  そのまま出すと「1番を選べば必ず正解」になってしまう。
 *  受験中に並びが変わらないよう、呼ぶのは試験開始時の1回だけ（下の useMemo）。 */
function shuffleChoices(choices) {
  const a = [...choices];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** セクション配列 → 1問ずつのフラットな配列 */
export function flattenExam(test) {
  const items = [];
  (test.sections || []).forEach((sec) => {
    if (sec.type === "reading" || sec.type === "cloze") {
      (sec.passages || []).forEach((p) => {
        (p.questions || []).forEach((q) => {
          items.push({ key: q.id, section: sec, passage: p, q, type: sec.type, phase: sec.phase });
        });
      });
    } else if (sec.type === "writing") {
      (sec.prompts || []).forEach((p) => {
        items.push({ key: p.id, section: sec, q: p, type: "writing", phase: sec.phase });
      });
    } else {
      (sec.questions || []).forEach((q) => {
        items.push({ key: q.id, section: sec, q, type: sec.type, phase: sec.phase });
      });
    }
  });
  return items;
}

/** 1問の正誤判定。ライティングは自動採点しないので null を返す。 */
export function judge(item, answer) {
  if (item.type === "writing") return null;
  if (item.type === "ordering") {
    const chunks = item.q.chunks || [];
    if (!Array.isArray(answer) || answer.length !== chunks.length) return false;
    return normalizeSentence(answer.map((i) => chunks[i]).join(" ")) === normalizeSentence(item.q.sentence);
  }
  if (typeof answer !== "number") return false;
  return !!(item.q.choices && item.q.choices[answer] && item.q.choices[answer].correct);
}

function correctIndex(q) {
  return (q.choices || []).findIndex((c) => c.correct);
}

/** 会話スクリプトを話者ごとに順番に読み上げる */
function playScript(lines, { onEnd } = {}) {
  if (!isSpeechSynthesisSupported()) return;
  stopSpeaking();
  const list = Array.isArray(lines) ? lines : [{ speaker: "N", text: lines }];
  let i = 0;
  const next = () => {
    if (i >= list.length) {
      if (onEnd) onEnd();
      return;
    }
    const line = list[i];
    const utter = new SpeechSynthesisUtterance(line.text);
    utter.lang = "en-US";
    utter.rate = 0.92;
    utter.pitch = line.speaker === "A" ? 1.15 : line.speaker === "B" ? 0.85 : 1;
    utter.onend = () => {
      i += 1;
      next();
    };
    utter.onerror = () => {
      i += 1;
      next();
    };
    window.speechSynthesis.speak(utter);
  };
  next();
}

const PHASE_LABEL = { written: "筆記試験", listening: "リスニングテスト" };

/* ============================================================
   選択肢
   ============================================================ */

function ChoiceList({ choices, answer, onAnswer, reveal, hideText }) {
  return (
    <div className="et-choices">
      {choices.map((c, i) => {
        let cls = "et-choice";
        if (reveal) {
          if (c.correct) cls += " correct";
          else if (i === answer) cls += " wrong";
        } else if (i === answer) {
          cls += " selected";
        }
        return (
          <button key={i} className={cls} onClick={() => !reveal && onAnswer(i)} disabled={reveal}>
            <span className="et-choice-num">{i + 1}</span>
            <span className="et-choice-text">{hideText && !reveal ? "（放送される選択肢を聞いて選ぶ）" : c.text}</span>
          </button>
        );
      })}
    </div>
  );
}

function Explanations({ choices, extra }) {
  return (
    <div className="et-explain">
      <div className="et-explain-list">
        {choices.map((c, i) => (
          <div className="et-explain-item" key={i}>
            <span className={`et-explain-mark ${c.correct ? "ok" : "ng"}`}>{c.correct ? "◎" : "×"}</span>
            <span>
              <b>{i + 1}. {c.text}</b>
              {c.explain ? `：${c.explain}` : ""}
            </span>
          </div>
        ))}
      </div>
      {extra}
    </div>
  );
}

/* ============================================================
   大問1：短文の語句空所補充
   ============================================================ */

function GapFillQuestion({ item, answer, onAnswer, reveal }) {
  const { q } = item;
  return (
    <div className="et-q">
      <div className="et-sentence">{q.sentence}</div>
      <ChoiceList choices={q.choices} answer={answer} onAnswer={onAnswer} reveal={reveal} />
      {reveal && (
        <Explanations
          choices={q.choices}
          extra={
            <div className="et-note">
              {q.point && <div className="et-note-point">📌 {q.point}</div>}
              {q.ja && <div className="et-note-ja">訳：{q.ja}</div>}
            </div>
          }
        />
      )}
    </div>
  );
}

/* ============================================================
   会話文の文空所補充
   ============================================================ */

function DialogueQuestion({ item, answer, onAnswer, reveal }) {
  const { q } = item;
  const ci = correctIndex(q);
  return (
    <div className="et-q">
      {q.title && <div className="et-q-title">{q.title}</div>}
      <div className="et-dialogue">
        {q.lines.map((line, i) => (
          <div className="et-dialogue-line" key={i}>
            <span className={`et-speaker sp-${line.speaker}`}>{line.speaker}</span>
            {i === q.blankIndex ? (
              <span className="et-blank">{reveal ? q.choices[ci].text : "（　　　　　　　　）"}</span>
            ) : (
              <span className="et-dialogue-text">{line.text}</span>
            )}
          </div>
        ))}
      </div>
      {isSpeechSynthesisSupported() && (
        <button
          className="et-mini-btn"
          onClick={() =>
            playScript(
              q.lines
                .map((l, i) => (i === q.blankIndex ? (reveal ? { speaker: l.speaker, text: q.choices[ci].text } : null) : l))
                .filter(Boolean)
            )
          }
        >
          🔊 会話を聞く
        </button>
      )}
      <ChoiceList choices={q.choices} answer={answer} onAnswer={onAnswer} reveal={reveal} />
      {reveal && (
        <Explanations
          choices={q.choices}
          extra={
            q.translation ? (
              <div className="et-note">
                <div className="et-note-point">📝 日本語訳</div>
                <div className="et-note-ja">{q.translation}</div>
              </div>
            ) : null
          }
        />
      )}
    </div>
  );
}

/* ============================================================
   語句整序（並べかえ）
   ============================================================ */

function OrderingQuestion({ item, answer, onAnswer, reveal }) {
  const { q } = item;
  const order = Array.isArray(answer) ? answer : [];
  const remaining = q.chunks.map((_, i) => i).filter((i) => !order.includes(i));

  const place = (i) => onAnswer([...order, i]);
  const remove = (pos) => onAnswer(order.filter((_, p) => p !== pos));
  const clear = () => onAnswer([]);

  return (
    <div className="et-q">
      <div className="et-ordering-ja">{q.ja}</div>

      <div className="et-ordering-slot">
        {order.length === 0 && !reveal && <span className="et-ordering-placeholder">下の語句をタップして並べます</span>}
        {order.map((chunkIdx, pos) => (
          <button key={pos} className="et-chunk placed" onClick={() => !reveal && remove(pos)} disabled={reveal}>
            {q.chunks[chunkIdx]}
          </button>
        ))}
      </div>

      {!reveal && (
        <>
          <div className="et-ordering-pool">
            {remaining.map((i) => (
              <button key={i} className="et-chunk" onClick={() => place(i)}>
                {q.chunks[i]}
              </button>
            ))}
          </div>
          {order.length > 0 && <button className="et-mini-btn" onClick={clear}>↺ 並べ直す</button>}
        </>
      )}

      {reveal && (
        <div className="et-explain">
          <div className="et-note">
            <div className="et-note-point">◎ 正解の英文</div>
            <div className="et-sentence" style={{ marginTop: 4 }}>
              {q.sentence}
              {isSpeechSynthesisSupported() && (
                <button className="et-speak" onClick={() => speak(q.sentence)} aria-label="読み上げ">🔊</button>
              )}
            </div>
            {q.explain && <div className="et-note-ja" style={{ marginTop: 6 }}>{q.explain}</div>}
          </div>
        </div>
      )}
    </div>
  );
}

/* ============================================================
   長文（内容一致 / 語句空所補充）
   ============================================================ */

function PassageBox({ passage, highlightBlank }) {
  const text = String(passage.passage || "");
  let body;
  if (highlightBlank) {
    const parts = text.split(/(\(\s*\d+\s*\))/g);
    body = parts.map((p, i) => {
      const m = p.match(/^\(\s*(\d+)\s*\)$/);
      if (m) {
        const n = Number(m[1]);
        return (
          <span key={i} className={n === highlightBlank ? "et-blank inline active" : "et-blank inline"}>
            （{n}）
          </span>
        );
      }
      return <span key={i}>{p}</span>;
    });
  } else {
    body = text;
  }
  return (
    <div className="et-passage">
      <div className="et-passage-head">
        <span className="et-passage-format">{passage.format || "長文"}</span>
        <span className="et-passage-title">{passage.title}</span>
        {isSpeechSynthesisSupported() && (
          <button className="et-speak" onClick={() => speak(text.replace(/\(\s*\d+\s*\)/g, "blank"))} aria-label="読み上げ">🔊</button>
        )}
      </div>
      <div className="et-passage-text">{body}</div>
    </div>
  );
}

function ReadingQuestion({ item, answer, onAnswer, reveal }) {
  const { q, passage, type } = item;
  const isCloze = type === "cloze";
  return (
    <div className="et-q">
      <PassageBox passage={passage} highlightBlank={isCloze ? q.blank : null} />
      {isCloze ? (
        <div className="et-q-instruction">本文の（{q.blank}）に入れるのに最も適切なものを選びましょう。</div>
      ) : (
        <div className="et-sentence">{q.q}</div>
      )}
      <ChoiceList choices={q.choices} answer={answer} onAnswer={onAnswer} reveal={reveal} />
      {reveal && (
        <Explanations
          choices={q.choices}
          extra={
            passage.translation ? (
              <div className="et-note">
                <div className="et-note-point">📝 本文の訳</div>
                <div className="et-note-ja">{passage.translation}</div>
              </div>
            ) : null
          }
        />
      )}
    </div>
  );
}

/* ============================================================
   リスニング
   ============================================================ */

function ListeningQuestion({ item, answer, onAnswer, reveal, examMode }) {
  const { q, section } = item;
  const [plays, setPlays] = useState(0);
  const [playing, setPlaying] = useState(false);
  const playLimit = examMode === "honban" ? section.playLimit || 1 : Infinity;
  const audioOnlyChoices = !!section.choicesAudioOnly && examMode === "honban" && !reveal;

  useEffect(() => {
    setPlays(0);
    setPlaying(false);
  }, [q.id]);

  const doPlay = () => {
    if (plays >= playLimit) return;
    setPlays((n) => n + 1);
    setPlaying(true);
    const lines = Array.isArray(q.script) ? [...q.script] : [{ speaker: "N", text: q.script }];
    const tail = [];
    if (q.question) tail.push({ speaker: "N", text: q.question });
    if (section.choicesAudioOnly) {
      q.choices.forEach((c, i) => tail.push({ speaker: "N", text: `${i + 1}. ${c.text}` }));
    }
    playScript([...lines, ...tail], { onEnd: () => setPlaying(false) });
  };

  return (
    <div className="et-q">
      <div className="et-q-instruction">{section.instruction}</div>
      <div className="et-listen-box">
        <button className="et-play-btn" onClick={doPlay} disabled={plays >= playLimit || playing}>
          {playing ? "🔊 再生中…" : plays === 0 ? "▶ 放送を聞く" : "🔁 もう一度聞く"}
        </button>
        <div className="et-listen-meta">
          {playLimit === Infinity ? `再生 ${plays} 回（練習モードは何度でも聞けます）` : `再生 ${plays} / ${playLimit} 回`}
        </div>
        {!isSpeechSynthesisSupported() && (
          <div className="et-warn">このブラウザは音声読み上げに対応していません。練習モードでスクリプトを読んで解いてください。</div>
        )}
      </div>
      {q.question && !section.choicesAudioOnly && <div className="et-sentence">{q.question}</div>}
      <ChoiceList choices={q.choices} answer={answer} onAnswer={onAnswer} reveal={reveal} hideText={audioOnlyChoices} />
      {reveal && (
        <Explanations
          choices={q.choices}
          extra={
            <div className="et-note">
              <div className="et-note-point">📝 スクリプト</div>
              <div className="et-script">
                {(Array.isArray(q.script) ? q.script : [{ speaker: "N", text: q.script }]).map((l, i) => (
                  <div key={i}>
                    {l.speaker && l.speaker !== "N" && <span className={`et-speaker sp-${l.speaker}`}>{l.speaker}</span>}
                    {l.text}
                  </div>
                ))}
                {q.question && <div className="et-script-q">Question: {q.question}</div>}
              </div>
              {q.translation && <div className="et-note-ja" style={{ marginTop: 6 }}>訳：{q.translation}</div>}
            </div>
          }
        />
      )}
    </div>
  );
}

/* ============================================================
   ライティング（自己採点）
   ============================================================ */

function WritingQuestion({ item, answer, onAnswer, reveal }) {
  const { q } = item;
  const text = typeof answer === "string" ? answer : "";
  const words = countWords(text);
  return (
    <div className="et-q">
      <div className="et-q-title">{q.styleLabel || "英作文"}</div>
      <div className="et-q-instruction">{q.instruction}</div>
      <div className="et-writing-topic">{q.topic}</div>
      {q.conditions && q.conditions.length > 0 && (
        <ul className="et-writing-conditions">
          {q.conditions.map((c, i) => <li key={i}>{c}</li>)}
        </ul>
      )}
      <div className="et-writing-meta">語数の目安：{q.wordCount}</div>
      <textarea
        className="et-writing-input"
        value={text}
        onChange={(e) => onAnswer(e.target.value)}
        placeholder="ここに英文を書きましょう"
        rows={8}
        readOnly={reveal}
      />
      <div className="et-writing-count">{words} words</div>
      {reveal && (
        <div className="et-explain">
          <div className="et-note">
            <div className="et-note-point">✍️ 解答例</div>
            <div className="et-model-answer">
              {q.modelAnswer}
              {isSpeechSynthesisSupported() && (
                <button className="et-speak" onClick={() => speak(q.modelAnswer)} aria-label="読み上げ">🔊</button>
              )}
            </div>
            {q.modelTranslation && <div className="et-note-ja" style={{ marginTop: 6 }}>訳：{q.modelTranslation}</div>}
          </div>
          {q.checklist && (
            <div className="et-note">
              <div className="et-note-point">✅ 自己採点チェックリスト（観点別・{q.points || 16}点満点）</div>
              <ul className="et-checklist">
                {q.checklist.map((c, i) => <li key={i}>{c}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ============================================================
   1問ぶんの描画を振り分ける
   ============================================================ */

function QuestionBody(props) {
  const { item } = props;
  if (item.type === "gapfill") return <GapFillQuestion {...props} />;
  if (item.type === "dialogue") return <DialogueQuestion {...props} />;
  if (item.type === "ordering") return <OrderingQuestion {...props} />;
  if (item.type === "reading" || item.type === "cloze") return <ReadingQuestion {...props} />;
  if (item.type === "listening") return <ListeningQuestion {...props} />;
  if (item.type === "writing") return <WritingQuestion {...props} />;
  return null;
}

/* ============================================================
   受験前の説明画面
   ============================================================ */

function IntroScreen({ test, items, examMode, setExamMode, onStart, onExit }) {
  const history = useMemo(() => getTestResults(test.level), [test.level]);
  const written = test.sections.filter((s) => s.phase === "written");
  const listening = test.sections.filter((s) => s.phase === "listening");
  const countOf = (sec) =>
    sec.type === "reading" || sec.type === "cloze"
      ? (sec.passages || []).reduce((n, p) => n + p.questions.length, 0)
      : sec.type === "writing"
      ? (sec.prompts || []).length
      : (sec.questions || []).length;
  const graded = items.filter((i) => i.type !== "writing").length;

  const renderRows = (secs) =>
    secs.map((sec) => (
      <tr key={sec.id}>
        <td className="et-part">{sec.part}</td>
        <td>{sec.title}</td>
        <td className="et-num">{countOf(sec)}問</td>
        <td className="et-num official">本番 {sec.officialCount}問</td>
      </tr>
    ));

  return (
    <div className="et-card">
      <div className="et-intro-head">
        <div className="et-intro-eyebrow">英検{test.levelLabel} 一次試験 模擬テスト</div>
        <h2 className="et-intro-title">{test.exam.title || `${test.levelLabel} 模擬テスト`}</h2>
        <div className="et-intro-sub">{test.exam.note}</div>
      </div>

      <table className="et-structure">
        <thead>
          <tr><th>大問</th><th>形式</th><th>収録</th><th>本番の問題数</th></tr>
        </thead>
        <tbody>
          <tr className="et-phase-row"><td colSpan={4}>筆記試験（{test.exam.writtenMinutes}分）</td></tr>
          {renderRows(written)}
          <tr className="et-phase-row"><td colSpan={4}>リスニングテスト（約{test.exam.listeningMinutes}分）</td></tr>
          {renderRows(listening)}
        </tbody>
      </table>

      <div className="et-intro-meta">
        自動採点の対象：{graded}問　／　合格の目安：正答率 {Math.round(test.exam.passRate * 100)}％以上
        {items.some((i) => i.type === "writing") && "　／　ライティングは解答例とチェックリストで自己採点します"}
      </div>

      <div className="et-mode-pick">
        <button
          className={`et-mode-card ${examMode === "honban" ? "active" : ""}`}
          onClick={() => setExamMode("honban")}
        >
          <div className="et-mode-label">⏱ 本番モード</div>
          <div className="et-mode-desc">
            制限時間あり。リスニングは放送を規定回数しか聞けず、選択肢も印刷されません（第1部）。答え合わせは提出後。
          </div>
        </button>
        <button
          className={`et-mode-card ${examMode === "renshu" ? "active" : ""}`}
          onClick={() => setExamMode("renshu")}
        >
          <div className="et-mode-label">📖 練習モード</div>
          <div className="et-mode-desc">時間無制限。リスニングは何度でも再生でき、選択肢も表示されます。</div>
        </button>
      </div>

      {history.length > 0 && (
        <div className="et-history">
          <div className="et-history-title">受験履歴</div>
          {history.slice(0, 5).map((h, i) => (
            <div className="et-history-row" key={i}>
              <span>{formatDateTime(h.at)}</span>
              <span className="et-history-mode">{h.examMode === "honban" ? "本番" : "練習"}</span>
              <span className="et-history-score">{h.correct} / {h.total}（{h.percent}%）</span>
            </div>
          ))}
        </div>
      )}

      <div className="et-actions">
        <button className="et-btn" onClick={onStart}>テストを始める</button>
        <button className="et-btn-ghost" onClick={onExit}>もどる</button>
      </div>
    </div>
  );
}

/* ============================================================
   採点結果
   ============================================================ */

function ResultScreen({ test, result, onReview, onRetry, onExit }) {
  const passed = result.percent >= Math.round(test.exam.passRate * 100);
  return (
    <div className="et-card">
      <div className="et-result-head">
        <div className="et-intro-eyebrow">{test.levelLabel} 模擬テスト 結果</div>
        <div className="et-result-big">{result.correct} / {result.total}</div>
        <div className="et-result-pct">正答率 {result.percent}%</div>
        <div className={`et-judge ${passed ? "pass" : "fail"}`}>
          {passed
            ? `合格ライン（${Math.round(test.exam.passRate * 100)}%）に到達しています`
            : `合格の目安は ${Math.round(test.exam.passRate * 100)}%。あと ${Math.max(1, Math.ceil(test.exam.passRate * result.total) - result.correct)}問です`}
        </div>
        <div className="et-result-time">所要時間 {formatClock(result.elapsedSec)}</div>
      </div>

      <table className="et-structure">
        <thead><tr><th>大問</th><th>形式</th><th>正答</th><th>正答率</th></tr></thead>
        <tbody>
          {result.sections.map((s) => (
            <tr key={s.id}>
              <td className="et-part">{s.part}</td>
              <td>{s.title}</td>
              <td className="et-num">{s.writing ? "自己採点" : `${s.correct} / ${s.total}`}</td>
              <td className="et-num">
                {s.writing ? "—" : (
                  <span className="et-bar-cell">
                    <span className="et-bar-track"><span className="et-bar-fill" style={{ width: `${Math.round((s.correct / s.total) * 100)}%` }} /></span>
                    {Math.round((s.correct / s.total) * 100)}%
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {result.weakest && (
        <div className="et-advice">
          📌 いちばん取りこぼしが多かったのは <b>{result.weakest.part}（{result.weakest.title}）</b> です。
          英検マスターの分野別モードで重点的に練習しましょう。
        </div>
      )}

      <div className="et-actions">
        <button className="et-btn" onClick={onReview}>解答と解説を見る</button>
        <button className="et-btn-ghost" onClick={onRetry}>もう一度受験する</button>
        <button className="et-btn-ghost" onClick={onExit}>もどる</button>
      </div>
    </div>
  );
}

/* ============================================================
   復習（全問の解答・解説）
   ============================================================ */

function ReviewScreen({ test, items, answers, onBack }) {
  const [filter, setFilter] = useState("all"); // all | wrong
  const shown = items.filter((it) => {
    if (filter === "all") return true;
    if (it.type === "writing") return true;
    return judge(it, answers[it.key]) !== true;
  });

  return (
    <div className="et-card">
      <div className="et-review-head">
        <h2 className="et-intro-title">解答と解説</h2>
        <div className="et-filter">
          <button className={`et-chip ${filter === "all" ? "active" : ""}`} onClick={() => setFilter("all")}>すべて</button>
          <button className={`et-chip ${filter === "wrong" ? "active" : ""}`} onClick={() => setFilter("wrong")}>まちがえた問題だけ</button>
        </div>
      </div>

      {shown.length === 0 && <div className="et-empty">まちがえた問題はありません。すばらしい！</div>}

      {shown.map((it) => {
        const ok = judge(it, answers[it.key]);
        return (
          <div className="et-review-item" key={it.key}>
            <div className="et-review-bar">
              <span className="et-review-no">{it.section.part}　No.{it.sectionNo}</span>
              <span className={`et-review-mark ${ok === null ? "self" : ok ? "ok" : "ng"}`}>
                {ok === null ? "自己採点" : ok ? "正解" : "不正解"}
              </span>
            </div>
            <QuestionBody item={it} answer={answers[it.key]} onAnswer={() => {}} reveal examMode="renshu" />
            {it.type !== "writing" && (
              <div className="et-your-answer">
                あなたの解答：
                {it.type === "ordering"
                  ? (Array.isArray(answers[it.key]) && answers[it.key].length
                      ? answers[it.key].map((i) => it.q.chunks[i]).join(" ")
                      : "無解答")
                  : typeof answers[it.key] === "number"
                  ? `${answers[it.key] + 1}. ${it.q.choices[answers[it.key]].text}`
                  : "無解答"}
              </div>
            )}
          </div>
        );
      })}

      <div className="et-actions">
        <button className="et-btn" onClick={onBack}>結果にもどる</button>
      </div>
    </div>
  );
}

/* ============================================================
   解答一覧（マークシート）
   ============================================================ */

function AnswerSheet({ items, answers, flags, index, phase, examMode, onJump, onClose }) {
  const selectable = (it) => examMode !== "honban" || it.phase === phase;
  return (
    <div className="et-sheet-overlay" onClick={onClose}>
      <div className="et-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="et-sheet-title">解答一覧</div>
        <div className="et-sheet-legend">
          <span><i className="dot done" />解答済み</span>
          <span><i className="dot flag" />見直し</span>
          <span><i className="dot none" />未解答</span>
        </div>
        <div className="et-sheet-grid">
          {items.map((it, i) => {
            const answered = it.type === "writing"
              ? typeof answers[it.key] === "string" && answers[it.key].trim().length > 0
              : it.type === "ordering"
              ? Array.isArray(answers[it.key]) && answers[it.key].length === it.q.chunks.length
              : typeof answers[it.key] === "number";
            let cls = "et-sheet-cell";
            if (answered) cls += " done";
            if (flags[it.key]) cls += " flag";
            if (i === index) cls += " current";
            if (!selectable(it)) cls += " locked";
            return (
              <button key={it.key} className={cls} disabled={!selectable(it)} onClick={() => { onJump(i); onClose(); }}>
                {it.phaseNo}
              </button>
            );
          })}
        </div>
        <button className="et-btn-ghost" onClick={onClose}>閉じる</button>
      </div>
    </div>
  );
}

/* ============================================================
   メイン
   ============================================================ */

export default function EikenTest({ test, onExit }) {
  const items = useMemo(() => {
    const flat = flattenExam(test);
    const secCounter = {};
    const phaseCounter = {};
    return flat.map((it) => {
      secCounter[it.section.id] = (secCounter[it.section.id] || 0) + 1;
      phaseCounter[it.phase] = (phaseCounter[it.phase] || 0) + 1;
      // 解答は選択肢の添字で保持するため、シャッフルはここで1回だけ行う
      const q =
        it.type !== "ordering" && it.q && Array.isArray(it.q.choices) && it.q.choices.length > 1
          ? { ...it.q, choices: shuffleChoices(it.q.choices) }
          : it.q;
      return { ...it, q, sectionNo: secCounter[it.section.id], phaseNo: phaseCounter[it.phase] };
    });
  }, [test]);

  const phases = useMemo(() => {
    const seen = [];
    items.forEach((it) => {
      if (!seen.includes(it.phase)) seen.push(it.phase);
    });
    return seen;
  }, [items]);

  const [stage, setStage] = useState("intro");
  const [examMode, setExamMode] = useState("honban");
  const [answers, setAnswers] = useState({});
  const [flags, setFlags] = useState({});
  const [index, setIndex] = useState(0);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [remaining, setRemaining] = useState({});
  const [result, setResult] = useState(null);
  const startedAt = useRef(null);

  const current = items[Math.min(index, items.length - 1)];
  const phase = current ? current.phase : phases[0];
  const phaseItems = items.filter((it) => it.phase === phase);
  const firstIndexOfPhase = (p) => items.findIndex((it) => it.phase === p);

  const phaseMinutes = useCallback(
    (p) => (p === "listening" ? test.exam.listeningMinutes : test.exam.writtenMinutes),
    [test]
  );

  const startExam = () => {
    stopSpeaking();
    const init = {};
    phases.forEach((p) => { init[p] = phaseMinutes(p) * 60; });
    setRemaining(init);
    setAnswers({});
    setFlags({});
    setIndex(0);
    setResult(null);
    startedAt.current = Date.now();
    setStage("exam");
  };

  const grade = useCallback(() => {
    const perSection = new Map();
    let correct = 0;
    let total = 0;
    items.forEach((it) => {
      const ok = judge(it, answers[it.key]);
      if (!perSection.has(it.section.id)) {
        perSection.set(it.section.id, {
          id: it.section.id,
          part: it.section.part,
          title: it.section.title,
          writing: it.type === "writing",
          correct: 0,
          total: 0,
        });
      }
      const s = perSection.get(it.section.id);
      if (ok === null) return;
      s.total += 1;
      total += 1;
      if (ok) {
        s.correct += 1;
        correct += 1;
      }
      recordAnswer(test.level, "test", it.key, ok);
    });
    const sections = [...perSection.values()];
    const scored = sections.filter((s) => !s.writing && s.total > 0);
    const weakest = scored.length
      ? scored.reduce((w, s) => (s.correct / s.total < w.correct / w.total ? s : w), scored[0])
      : null;
    const percent = total ? Math.round((correct / total) * 100) : 0;
    return {
      examMode,
      correct,
      total,
      percent,
      sections,
      weakest: weakest && weakest.correct / weakest.total < 1 ? weakest : null,
      elapsedSec: startedAt.current ? Math.round((Date.now() - startedAt.current) / 1000) : 0,
    };
  }, [items, answers, examMode, test.level]);

  const submit = useCallback(() => {
    stopSpeaking();
    const r = grade();
    saveTestResult(test.level, {
      examMode: r.examMode,
      correct: r.correct,
      total: r.total,
      percent: r.percent,
      elapsedSec: r.elapsedSec,
      sections: r.sections.map((s) => ({ id: s.id, part: s.part, title: s.title, correct: s.correct, total: s.total })),
    });
    setResult(r);
    setStage("result");
  }, [grade, test.level]);

  const goNextPhase = useCallback(() => {
    stopSpeaking();
    const pi = phases.indexOf(phase);
    if (pi >= 0 && pi + 1 < phases.length) {
      setIndex(firstIndexOfPhase(phases[pi + 1]));
    } else {
      submit();
    }
  }, [phase, phases, submit]); // eslint-disable-line react-hooks/exhaustive-deps

  // 本番モードのカウントダウン
  useEffect(() => {
    if (stage !== "exam" || examMode !== "honban") return undefined;
    const timer = window.setInterval(() => {
      setRemaining((prev) => {
        const left = (prev[phase] ?? 0) - 1;
        if (left <= 0) {
          window.setTimeout(goNextPhase, 0);
          return { ...prev, [phase]: 0 };
        }
        return { ...prev, [phase]: left };
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [stage, examMode, phase, goNextPhase]);

  useEffect(() => () => stopSpeaking(), []);

  const setAnswer = (key, value) => setAnswers((a) => ({ ...a, [key]: value }));
  const toggleFlag = () => setFlags((f) => ({ ...f, [current.key]: !f[current.key] }));

  const isPhaseLast = current && phaseItems[phaseItems.length - 1].key === current.key;
  const isPhaseFirst = current && phaseItems[0].key === current.key;

  const handleNext = () => {
    stopSpeaking();
    if (isPhaseLast) {
      const label = phases.indexOf(phase) + 1 < phases.length ? PHASE_LABEL[phases[phases.indexOf(phase) + 1]] : null;
      const msg = label
        ? `${PHASE_LABEL[phase]}を終了して${label}に進みます。${examMode === "honban" ? "筆記にはもどれません。" : ""}よろしいですか？`
        : "テストを終了して採点します。よろしいですか？";
      if (window.confirm(msg)) goNextPhase();
      return;
    }
    setIndex(index + 1);
  };

  const handlePrev = () => {
    stopSpeaking();
    if (!isPhaseFirst) setIndex(index - 1);
  };

  return (
    <div className="eiken-test" style={{ "--c": test.color }}>
      <style>{STYLES}</style>

      {stage === "intro" && (
        <IntroScreen
          test={test}
          items={items}
          examMode={examMode}
          setExamMode={setExamMode}
          onStart={startExam}
          onExit={onExit}
        />
      )}

      {stage === "exam" && current && (
        <div className="et-card">
          <div className="et-exam-bar">
            <div className="et-exam-phase">{PHASE_LABEL[phase]}</div>
            <div className="et-exam-count">{current.phaseNo} / {phaseItems.length}</div>
            {examMode === "honban" ? (
              <div className={`et-timer ${(remaining[phase] ?? 0) <= 60 ? "urgent" : ""}`}>⏱ {formatClock(remaining[phase] ?? 0)}</div>
            ) : (
              <div className="et-timer practice">練習モード</div>
            )}
          </div>

          <div className="et-progress-track">
            <div className="et-progress-fill" style={{ width: `${((current.phaseNo - 1) / phaseItems.length) * 100}%` }} />
          </div>

          <div className="et-section-head">
            <span className="et-part-badge">{current.section.part}</span>
            <span className="et-section-title">{current.section.title}</span>
            <span className="et-section-no">No.{current.sectionNo}</span>
          </div>
          {current.section.instruction && current.type !== "listening" && (
            <div className="et-q-instruction top">{current.section.instruction}</div>
          )}

          <QuestionBody
            item={current}
            answer={answers[current.key]}
            onAnswer={(v) => setAnswer(current.key, v)}
            reveal={false}
            examMode={examMode}
          />

          <div className="et-nav">
            <button className="et-btn-ghost" onClick={handlePrev} disabled={isPhaseFirst}>← 前の問題</button>
            <button className={`et-flag ${flags[current.key] ? "on" : ""}`} onClick={toggleFlag}>
              {flags[current.key] ? "🚩 見直しあり" : "⚑ あとで見直す"}
            </button>
            <button className="et-btn-ghost" onClick={() => setSheetOpen(true)}>解答一覧</button>
            <button className="et-btn" onClick={handleNext}>
              {isPhaseLast
                ? phases.indexOf(phase) + 1 < phases.length
                  ? `${PHASE_LABEL[phases[phases.indexOf(phase) + 1]]}へ →`
                  : "提出して採点する"
                : "次の問題 →"}
            </button>
          </div>

          <div className="et-abort">
            <button className="et-link" onClick={() => { if (window.confirm("テストを中断します。解答は保存されません。よろしいですか？")) { stopSpeaking(); setStage("intro"); } }}>
              テストを中断する
            </button>
          </div>

          {sheetOpen && (
            <AnswerSheet
              items={items}
              answers={answers}
              flags={flags}
              index={index}
              phase={phase}
              examMode={examMode}
              onJump={setIndex}
              onClose={() => setSheetOpen(false)}
            />
          )}
        </div>
      )}

      {stage === "result" && result && (
        <ResultScreen
          test={test}
          result={result}
          onReview={() => setStage("review")}
          onRetry={startExam}
          onExit={onExit}
        />
      )}

      {stage === "review" && (
        <ReviewScreen test={test} items={items} answers={answers} onBack={() => setStage("result")} />
      )}
    </div>
  );
}

/* ============================================================
   スタイル
   ============================================================ */

const STYLES = `
.eiken-test { max-width: 760px; margin: 0 auto; font-family: 'Zen Kaku Gothic New', 'Hiragino Sans', sans-serif; color: #2A2E27; }
.et-card { background: #fff; border: 1px solid #E4E2DA; border-radius: 12px; padding: 22px; }

.et-intro-head { text-align: center; margin-bottom: 18px; }
.et-intro-eyebrow { font-size: 11px; letter-spacing: 1.5px; color: #9AA093; font-weight: 700; }
.et-intro-title { font-family: 'Shippori Mincho', serif; font-size: 25px; margin: 6px 0; }
.et-intro-sub { font-size: 12.5px; color: #6B7280; line-height: 1.6; }

.et-structure { width: 100%; border-collapse: collapse; font-size: 13px; margin: 14px 0; }
.et-structure th { text-align: left; font-size: 11.5px; color: #9AA093; border-bottom: 1px solid #E4E2DA; padding: 6px 8px; }
.et-structure td { padding: 7px 8px; border-bottom: 1px solid #F0EFE9; }
.et-structure .et-part { font-weight: 700; color: var(--c); white-space: nowrap; }
.et-structure .et-num { text-align: right; white-space: nowrap; }
.et-structure .et-num.official { color: #9AA093; font-size: 11.5px; }
.et-phase-row td { background: #FAFAF6; font-weight: 700; font-size: 12px; color: #555F52; }
.et-bar-cell { display: inline-flex; align-items: center; gap: 6px; }
.et-bar-track { width: 56px; height: 6px; background: #EDEBE3; border-radius: 3px; overflow: hidden; display: inline-block; }
.et-bar-fill { display: block; height: 100%; background: var(--c); }

.et-intro-meta { font-size: 12.5px; color: #555F52; background: #FAFAF6; border-radius: 8px; padding: 10px 12px; line-height: 1.7; }

.et-mode-pick { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin: 16px 0; }
@media (max-width: 560px) { .et-mode-pick { grid-template-columns: 1fr; } }
.et-mode-card { text-align: left; border: 2px solid #D8DCD3; background: #fff; border-radius: 10px; padding: 14px; cursor: pointer; }
.et-mode-card.active { border-color: var(--c); background: #FBFAF6; }
.et-mode-label { font-weight: 800; color: var(--c); margin-bottom: 4px; }
.et-mode-desc { font-size: 12px; color: #6B7280; line-height: 1.6; }

.et-history { margin-top: 6px; border-top: 1px dashed #D8DCD3; padding-top: 12px; }
.et-history-title { font-size: 12px; font-weight: 700; color: #555F52; margin-bottom: 6px; }
.et-history-row { display: flex; justify-content: space-between; gap: 8px; font-size: 12.5px; color: #6B7280; padding: 3px 0; }
.et-history-mode { color: #9AA093; }
.et-history-score { font-weight: 700; color: #2A2E27; }

.et-actions { display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; margin-top: 18px; }
.et-btn { font-weight: 700; font-size: 14.5px; border: none; border-radius: 20px; padding: 10px 22px; cursor: pointer; color: #fff; background: var(--c); }
.et-btn:hover { opacity: 0.9; }
.et-btn:disabled { background: #C9CDC4; cursor: not-allowed; }
.et-btn-ghost { background: #fff; color: var(--c); border: 1.5px solid var(--c); font-weight: 700; border-radius: 20px; padding: 10px 18px; cursor: pointer; font-size: 13.5px; }
.et-btn-ghost:disabled { color: #C9CDC4; border-color: #DDE0D8; cursor: not-allowed; }
.et-mini-btn { margin-top: 10px; border: 1.5px solid var(--c); color: var(--c); background: #fff; border-radius: 18px; padding: 6px 14px; font-size: 12.5px; font-weight: 700; cursor: pointer; }
.et-link { background: none; border: none; color: #9AA093; font-size: 12px; text-decoration: underline; cursor: pointer; }
.et-speak { border: none; background: #F0EFE9; border-radius: 50%; width: 26px; height: 26px; cursor: pointer; font-size: 12px; margin-left: 8px; }

.et-exam-bar { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 10px; }
.et-exam-phase { font-size: 12px; font-weight: 800; color: var(--c); }
.et-exam-count { font-size: 12px; color: #9AA093; }
.et-timer { font-family: 'Space Mono', monospace; font-size: 15px; font-weight: 700; background: #FAFAF6; border-radius: 16px; padding: 4px 12px; }
.et-timer.urgent { background: #F8EEEA; color: #C8323D; }
.et-timer.practice { font-size: 11.5px; color: #6B7280; font-family: inherit; }
.et-progress-track { height: 5px; background: #EDEBE3; border-radius: 3px; overflow: hidden; margin-bottom: 16px; }
.et-progress-fill { height: 100%; background: var(--c); transition: width 0.2s ease; }

.et-section-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; }
.et-part-badge { background: var(--c); color: #fff; font-size: 11px; font-weight: 700; border-radius: 4px; padding: 2px 8px; }
.et-section-title { font-size: 13px; font-weight: 700; }
.et-section-no { font-size: 12px; color: #9AA093; margin-left: auto; }
.et-q-instruction { font-size: 12.5px; color: #6B7280; line-height: 1.7; margin-bottom: 10px; }
.et-q-instruction.top { background: #FAFAF6; border-radius: 6px; padding: 8px 10px; }
.et-q-title { font-weight: 800; margin-bottom: 6px; }

.et-sentence { font-family: 'Space Mono', monospace; font-size: 16px; line-height: 1.8; font-weight: 600; margin: 12px 0; }
.et-choices { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 14px; }
@media (max-width: 560px) { .et-choices { grid-template-columns: 1fr; } }
.et-choice { display: flex; align-items: flex-start; gap: 10px; text-align: left; padding: 11px 13px; border: 2px solid #D8DCD3; border-radius: 8px; background: #fff; cursor: pointer; font-size: 14px; line-height: 1.5; }
.et-choice:hover:not(:disabled) { border-color: var(--c); }
.et-choice.selected { border-color: var(--c); background: #FBFAF6; font-weight: 700; }
.et-choice.correct { border-color: #2F7A4F; background: #EAF6EE; color: #2F7A4F; font-weight: 700; }
.et-choice.wrong { border-color: #C8323D; background: #F8EEEA; color: #C8323D; font-weight: 700; }
.et-choice:disabled { cursor: default; }
.et-choice-num { flex-shrink: 0; width: 20px; height: 20px; border-radius: 50%; background: #F0EFE9; color: #555F52; font-size: 11.5px; font-weight: 700; display: flex; align-items: center; justify-content: center; margin-top: 1px; }

.et-explain { margin-top: 16px; border-top: 1px dashed #D8DCD3; padding-top: 14px; }
.et-explain-list { display: flex; flex-direction: column; gap: 7px; margin-bottom: 12px; }
.et-explain-item { display: flex; gap: 8px; font-size: 13px; line-height: 1.65; }
.et-explain-mark { flex-shrink: 0; font-weight: 800; width: 16px; }
.et-explain-mark.ok { color: #2F7A4F; }
.et-explain-mark.ng { color: #C8323D; }
.et-note { background: #F5F6F1; border-left: 3px solid var(--c); padding: 10px 13px; border-radius: 4px; margin-bottom: 10px; font-size: 13px; line-height: 1.7; }
.et-note-point { font-weight: 700; margin-bottom: 3px; }
.et-note-ja { color: #555F52; }

.et-dialogue { background: #FAFAF6; border-left: 3px solid var(--c); border-radius: 4px; padding: 12px 14px; display: flex; flex-direction: column; gap: 8px; }
.et-dialogue-line { font-size: 14px; line-height: 1.6; }
.et-dialogue-text { font-family: 'Space Mono', monospace; }
.et-speaker { font-weight: 800; margin-right: 8px; }
.et-speaker.sp-A { color: #2F5D8A; }
.et-speaker.sp-B { color: #8A3B2F; }
.et-blank { font-weight: 800; color: var(--c); background: #FFF3D6; padding: 2px 8px; border-radius: 4px; }
.et-blank.inline { padding: 0 4px; background: #F0EFE9; color: #555F52; }
.et-blank.inline.active { background: #FFF3D6; color: var(--c); }

.et-ordering-ja { font-size: 15px; font-weight: 700; margin: 10px 0; }
.et-ordering-slot { min-height: 50px; border: 2px dashed #D8DCD3; border-radius: 8px; padding: 10px; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.et-ordering-placeholder { font-size: 12.5px; color: #9AA093; }
.et-ordering-pool { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
.et-chunk { border: 1.5px solid #D8DCD3; background: #fff; border-radius: 6px; padding: 7px 12px; font-size: 14px; font-family: 'Space Mono', monospace; cursor: pointer; }
.et-chunk:hover:not(:disabled) { border-color: var(--c); }
.et-chunk.placed { border-color: var(--c); background: #FBFAF6; font-weight: 700; }

.et-passage { background: #FAFAF6; border-left: 3px solid var(--c); border-radius: 4px; padding: 12px 14px; }
.et-passage-head { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.et-passage-format { font-size: 10.5px; font-weight: 700; color: #fff; background: #9AA093; border-radius: 3px; padding: 1px 6px; }
.et-passage-title { font-weight: 800; font-size: 14px; }
.et-passage-text { font-family: 'Space Mono', monospace; font-size: 13.5px; line-height: 1.9; white-space: pre-wrap; }

.et-listen-box { background: #FAFAF6; border-radius: 8px; padding: 14px; text-align: center; margin-bottom: 12px; }
.et-play-btn { border: 1.5px solid var(--c); color: var(--c); background: #fff; border-radius: 20px; padding: 10px 22px; font-weight: 700; font-size: 14px; cursor: pointer; }
.et-play-btn:disabled { border-color: #DDE0D8; color: #C9CDC4; cursor: not-allowed; }
.et-listen-meta { font-size: 11.5px; color: #9AA093; margin-top: 8px; }
.et-warn { font-size: 12px; color: #8A6D2F; margin-top: 8px; }
.et-script { font-family: 'Space Mono', monospace; font-size: 13px; line-height: 1.8; }
.et-script-q { margin-top: 6px; font-weight: 700; }

.et-writing-topic { font-family: 'Space Mono', monospace; font-size: 15px; font-weight: 700; line-height: 1.7; background: #FAFAF6; border-left: 3px solid var(--c); padding: 10px 13px; border-radius: 4px; }
.et-writing-conditions { font-size: 12.5px; color: #555F52; line-height: 1.8; margin: 10px 0 0; padding-left: 20px; }
.et-writing-meta { font-size: 12px; color: #9AA093; margin: 10px 0 4px; }
.et-writing-input { width: 100%; border: 2px solid #D8DCD3; border-radius: 8px; padding: 12px; font-size: 14px; font-family: 'Space Mono', monospace; line-height: 1.8; resize: vertical; box-sizing: border-box; }
.et-writing-input:focus { outline: none; border-color: var(--c); }
.et-writing-count { text-align: right; font-size: 11.5px; color: #9AA093; margin-top: 4px; }
.et-model-answer { font-family: 'Space Mono', monospace; font-size: 13.5px; line-height: 1.9; }
.et-checklist { margin: 4px 0 0; padding-left: 20px; line-height: 1.8; }

.et-nav { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; justify-content: space-between; margin-top: 22px; border-top: 1px solid #F0EFE9; padding-top: 16px; }
.et-flag { background: #fff; border: 1.5px solid #D8DCD3; border-radius: 18px; padding: 7px 14px; font-size: 12.5px; cursor: pointer; color: #6B7280; }
.et-flag.on { border-color: #C8323D; color: #C8323D; font-weight: 700; }
.et-abort { text-align: center; margin-top: 14px; }

.et-sheet-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.45); display: flex; align-items: center; justify-content: center; padding: 20px; z-index: 50; }
.et-sheet { background: #fff; border-radius: 12px; padding: 20px; max-width: 460px; width: 100%; max-height: 80vh; overflow-y: auto; text-align: center; }
.et-sheet-title { font-weight: 800; margin-bottom: 8px; }
.et-sheet-legend { display: flex; gap: 14px; justify-content: center; font-size: 11.5px; color: #6B7280; margin-bottom: 12px; }
.et-sheet-legend .dot { display: inline-block; width: 10px; height: 10px; border-radius: 3px; margin-right: 4px; vertical-align: -1px; }
.et-sheet-legend .dot.done { background: var(--c); }
.et-sheet-legend .dot.flag { background: #C8323D; }
.et-sheet-legend .dot.none { background: #EDEBE3; }
.et-sheet-grid { display: grid; grid-template-columns: repeat(8, 1fr); gap: 6px; margin-bottom: 16px; }
.et-sheet-cell { aspect-ratio: 1; border: 1.5px solid #D8DCD3; background: #fff; border-radius: 5px; font-size: 12px; cursor: pointer; color: #6B7280; }
.et-sheet-cell.done { background: var(--c); color: #fff; border-color: var(--c); font-weight: 700; }
.et-sheet-cell.flag { border-color: #C8323D; border-width: 2px; }
.et-sheet-cell.current { outline: 2px solid #2A2E27; outline-offset: 1px; }
.et-sheet-cell.locked { opacity: 0.3; cursor: not-allowed; }

.et-result-head { text-align: center; margin-bottom: 16px; }
.et-result-big { font-family: 'Shippori Mincho', serif; font-size: 46px; font-weight: 800; color: var(--c); line-height: 1.2; }
.et-result-pct { font-size: 14px; color: #6B7280; }
.et-judge { display: inline-block; margin-top: 10px; font-size: 13px; font-weight: 700; border-radius: 18px; padding: 6px 16px; }
.et-judge.pass { background: #EAF6EE; color: #2F7A4F; }
.et-judge.fail { background: #F8EEEA; color: #C8323D; }
.et-result-time { font-size: 11.5px; color: #9AA093; margin-top: 8px; }
.et-advice { background: #FFF9EC; border-left: 3px solid #8A6D2F; border-radius: 4px; padding: 10px 13px; font-size: 13px; line-height: 1.7; }

.et-review-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; margin-bottom: 12px; }
.et-filter { display: flex; gap: 8px; }
.et-chip { border: 1.5px solid #D8DCD3; background: #fff; border-radius: 16px; padding: 5px 12px; font-size: 12px; cursor: pointer; }
.et-chip.active { border-color: var(--c); background: var(--c); color: #fff; font-weight: 700; }
.et-review-item { border: 1px solid #E4E2DA; border-radius: 10px; padding: 16px; margin-bottom: 14px; }
.et-review-bar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.et-review-no { font-size: 12px; font-weight: 700; color: var(--c); }
.et-review-mark { font-size: 11.5px; font-weight: 700; border-radius: 12px; padding: 3px 10px; }
.et-review-mark.ok { background: #EAF6EE; color: #2F7A4F; }
.et-review-mark.ng { background: #F8EEEA; color: #C8323D; }
.et-review-mark.self { background: #FFF9EC; color: #8A6D2F; }
.et-your-answer { margin-top: 10px; font-size: 12.5px; color: #6B7280; background: #FAFAF6; border-radius: 6px; padding: 8px 10px; }
.et-empty { text-align: center; padding: 30px; color: #9AA093; }
`;
