/* ============================================================
   CCAO-F 音声モードのテスト（v1.32.0〜）

   - 全 560 問・30 讲义・頻出単語の全語から台本（トラック）が作れ、
     どのトラックにも読むものがある。英語の step に日本語・中文が混ざらない
   - 1発話は Chrome が途中で切らない長さ（160字以内）に分かれる
   - 言語を OFF にした step は消え、その「間」は直前に引き継がれる
     （中文 OFF でも、選択肢のあとの考える時間が残る）
   - 正解の読み上げは、ON の言語（日本語 → 中文 → 英語の順）で1回だけ
   - 聞いた記録は ccaofListenV1 に入り、正答率・錯題本には入らない。
     頻出単語は「学習した単語」に入るが習熟は変わらない
   - バックアップに ccaofListenV1 が入り、リセットで消える
   ============================================================ */

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { register } from "node:module";

register(
  "data:text/javascript," +
    encodeURIComponent(`
      export async function resolve(spec, ctx, next) {
        if ((spec.startsWith("./") || spec.startsWith("../")) && !/\\.[a-z]+$/.test(spec)) {
          try { return await next(spec + ".js", ctx); } catch (e) { /* fallthrough */ }
        }
        return next(spec, ctx);
      }
      // progress → domains.js は vite の import.meta.glob を使う。node では globalThis.__viteGlob で代用する
      export async function load(url, ctx, next) {
        if (url.endsWith(".json")) return next(url, { ...ctx, importAttributes: { type: "json" } });
        const r = await next(url, ctx);
        if (url.endsWith("/claudeCert/domains.js")) {
          const src = String(r.source).replace(/import\\.meta\\.glob\\(/g, "globalThis.__viteGlob(");
          return { ...r, source: src };
        }
        return r;
      }
    `)
);

function makeStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    clear: () => m.clear(),
  };
}
globalThis.window = { localStorage: makeStorage(), sessionStorage: makeStorage() };
/* import.meta.glob の代わり：eager のときだけ meta.json を読み、遅延のものは空にする */
globalThis.__viteGlob = (pattern, opts = {}) => {
  if (!opts.eager) return {};
  const root = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "data", "claudeCert");
  const out = {};
  readdirSync(root).forEach((id) => {
    try {
      out[`../data/claudeCert/${id}/meta.json`] = JSON.parse(readFileSync(join(root, id, "meta.json"), "utf8"));
    } catch (e) {
      /* meta.json が無いフォルダは飛ばす */
    }
  });
  return out;
};

const here = dirname(fileURLToPath(import.meta.url));
const certRoot = join(here, "..", "src", "data", "claudeCert");
const dataDir = join(certRoot, "ccaof");
const lessons = JSON.parse(readFileSync(join(dataDir, "lessons.json"), "utf8")).lessons;
const allItems = readdirSync(dataDir)
  .filter((f) => /^d\d+-.*\.json$/.test(f))
  .flatMap((f) => JSON.parse(readFileSync(join(dataDir, f), "utf8")).items);
const words = JSON.parse(readFileSync(join(dataDir, "vocab.json"), "utf8")).words;
/* CCAR-F（v1.33.0〜）も同じ台本づくりで読めるか */
const arDir = join(certRoot, "ccarf");
const arLessons = JSON.parse(readFileSync(join(arDir, "lessons.json"), "utf8")).lessons;
const arItems = readdirSync(arDir)
  .filter((f) => /^d\d+-.*\.json$/.test(f))
  .flatMap((f) => JSON.parse(readFileSync(join(arDir, f), "utf8")).items);
const arWords = JSON.parse(readFileSync(join(arDir, "vocab.json"), "utf8")).words;
const arMeta = JSON.parse(readFileSync(join(arDir, "meta.json"), "utf8"));

const audio = await import("../src/claudeCert/audioCore.js");
const listen = await import("../src/claudeCert/listen.js");
const vocab = await import("../src/claudeCert/vocabProgress.js");
const progress = await import("../src/claudeCert/progress.js");
const mistakes = await import("../src/claudeCert/mistakes.js");
const backup = await import("../src/claudeCert/backup.js");
const certState = await import("../src/claudeCert/certState.js");
const voicePick = await import("../src/claudeCert/voicePick.js");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

const ALL = { en: true, ja: true, zh: true };
const CJK = /[぀-ヿ㐀-鿿]/;

console.log("\nClaude 認定 音声モードのテスト（CCAO-F・CCAR-F）\n");

function checkTracks(tracks, expectCount) {
  assert.equal(tracks.length, expectCount);
  tracks.forEach((t) => {
    assert.ok(t.steps.length > 0, `${t.id} に読むものがない`);
    t.steps.forEach((s) => {
      assert.ok(["en", "ja", "zh"].includes(s.lang), `${t.id}: 言語 ${s.lang}`);
      assert.ok(s.text && s.text.trim(), `${t.id}: 空の step`);
      assert.ok(Number.isFinite(s.pause) && s.pause >= 0, `${t.id}: 間 ${s.pause}`);
      // 選択肢の英文に「」などの記号が入ることはあるが、漢字・かなは入らない
      assert.ok(!/\*\*/.test(s.text), `${t.id}: 記号 ** が残っている`);
      if (s.lang === "en") assert.ok(!CJK.test(s.text), `${t.id}: 英語の step に日本語・中文 "${s.text.slice(0, 40)}"`);
      audio.utterancesOf(s).forEach((u) => assert.ok(u.text.length <= 160, `${t.id}: 長すぎる発話 ${u.text.length}字`));
    });
  });
}

test(`全 ${allItems.length} 問から問題のトラックが作れる`, () => {
  const tracks = audio.filterTracks(audio.questionTracks(allItems), ALL);
  checkTracks(tracks, allItems.length);
  tracks.forEach((t, i) => assert.deepEqual(t.record, { kind: "item", id: allItems[i].id }));
});

test(`全 ${lessons.length} 讲义から節ごとのトラックが作れ、最後の節だけ記録される`, () => {
  const tracks = audio.filterTracks(audio.lessonTracks(lessons), ALL);
  checkTracks(tracks, tracks.length);
  assert.ok(tracks.length >= lessons.length * 5, `節が少ない: ${tracks.length}`);
  const recorded = tracks.filter((t) => t.record).map((t) => t.record.id);
  assert.deepEqual(recorded, lessons.map((l) => l.id));
});

test(`頻出単語 ${words.length}語：単語 → 意味 → 例文 → 単語`, () => {
  const tracks = audio.filterTracks(audio.vocabTracks(words), ALL);
  checkTracks(tracks, words.length);
  const t = tracks[0];
  assert.equal(t.steps[0].lang, "en");
  assert.equal(t.steps[0].text, words[0].word);
  assert.equal(t.steps[1].lang, "ja");
  assert.equal(t.steps[1].text, words[0].ja);
  assert.equal(t.steps[t.steps.length - 1].text, words[0].word);
});

test("文の区切り：句点で分け、長い文は読点・空白で 160 字以内に", () => {
  assert.deepEqual(audio.splitSentences("One. Two? 三。四！"), ["One.", "Two?", "三。", "四！"]);
  assert.deepEqual(audio.splitSentences("  "), []);
  // 選択肢の記号・略語・小数では切らない
  assert.deepEqual(audio.splitSentences("A. Use more words. B. Ask, e.g. twice."), ["A. Use more words.", "B. Ask, e.g. twice."]);
  assert.deepEqual(audio.splitSentences("Version 3.5 is out."), ["Version 3.5 is out."]);
  const long = Array.from({ length: 60 }, (_, i) => `word${i}`).join(" ") + ".";
  const parts = audio.splitSentences(long);
  assert.ok(parts.length >= 2);
  parts.forEach((p) => assert.ok(p.length <= 160));
  assert.equal(parts.join(" "), long);
  const longZh = "这".repeat(400);
  audio.splitSentences(longZh).forEach((p) => assert.ok(p.length <= 160));
  assert.equal(audio.splitSentences(longZh).join(""), longZh);
});

test("見出し「Context（背景信息）」は英語と中文に分けて読む", () => {
  assert.deepEqual(audio.splitMixed("Context（背景信息）", "zh"), [
    { lang: "en", text: "Context" },
    { lang: "zh", text: "背景信息" },
  ]);
  assert.deepEqual(audio.splitMixed("Be clear and direct", "zh"), [{ lang: "en", text: "Be clear and direct" }]);
});

test("中文 OFF：中文の step は消え、選択肢のあとの考える間は残る", () => {
  const q = allItems.find((i) => i.choices.every((c) => c.textZh));
  const full = audio.filterTracks(audio.questionTracks([q]), ALL)[0];
  const noZh = audio.filterTracks(audio.questionTracks([q]), { en: true, ja: true, zh: false })[0];
  assert.ok(noZh.steps.every((s) => s.lang !== "zh"));
  const maxPause = (t) => Math.max(...t.steps.map((s) => s.pause));
  assert.equal(maxPause(noZh), maxPause(full));
  // 考える間は最後の選択肢の直後（＝正解の直前）
  const ans = noZh.steps.findIndex((s) => /^正解は/.test(s.text));
  assert.ok(ans > 0);
  assert.equal(noZh.steps[ans - 1].pause, 3500);
});

test("正解の読み上げ：ON の言語のうち 日本語 → 中文 → 英語 の順で1回だけ", () => {
  const q = { ...allItems[0], choices: allItems[0].choices };
  const letter = "ABCD"[q.choices.findIndex((c) => c.correct)];
  const answers = (langs) => audio.filterTracks(audio.questionTracks([q]), langs)[0].steps.filter((s) => /正解は|正确答案是|The answer is/.test(s.text));
  assert.deepEqual(answers(ALL).map((s) => s.text), [`正解は ${letter}。`]);
  assert.deepEqual(answers({ en: true, ja: false, zh: true }).map((s) => s.text), [`正确答案是 ${letter}。`]);
  assert.deepEqual(answers({ en: true, ja: false, zh: false }).map((s) => s.text), [`The answer is ${letter}.`]);
});

test("讲义は中文だけ：英語だけ ON なら見出しの英語だけが残る", () => {
  const tracks = audio.filterTracks(audio.lessonTracks([lessons[0]]), { en: true, ja: false, zh: false });
  tracks.forEach((t) => t.steps.forEach((s) => assert.equal(s.lang, "en")));
  assert.ok(tracks.length >= 1);
});

test("設定：壊れた値でも既定に戻し、言語を全部 OFF にはできない", () => {
  assert.deepEqual(audio.normalizeSettings(null), audio.DEFAULT_SETTINGS);
  assert.deepEqual(audio.normalizeSettings({ rate: 3, gap: "x", langs: { en: false, ja: false, zh: false } }), {
    rate: 1,
    gap: 1,
    langs: { en: true, ja: false, zh: false },
  });
  assert.equal(audio.normalizeSettings({ rate: 0.75 }).rate, 0.75);
  assert.equal(audio.normalizeSettings({ rate: 1.25 }).rate, 1.25);
  // 速いほど間も短く、「長め」は2倍
  assert.equal(audio.pauseMs(1000, { rate: 1.25, gap: 1 }), 800);
  assert.equal(audio.pauseMs(1000, { rate: 1, gap: 2 }), 2000);
});

test("聞いた記録：問題・讲义・単語を数え、正答率と錯題本には入らない", () => {
  window.localStorage.clear();
  const now = new Date("2026-10-13T10:00:00");
  listen.recordListen("item", "d1-001", now);
  listen.recordListen("item", "d1-001", now);
  listen.recordListen("item", "d2-002", now);
  listen.recordListen("lesson", "D1-1", now);
  listen.recordListen("word", "output", now);
  listen.recordListen("bogus", "x", now);
  const s = listen.getListenSummary(now);
  assert.deepEqual(s, { items: 2, lessons: 1, words: 1, today: 5, days: 1 });
  assert.equal(listen.loadListenStore().items["d1-001"].n, 2);
  assert.equal(progress.getTodayStats().attempted, 0);
  assert.equal(mistakes.getMistakeSummary().total, 0);
});

test("頻出単語を聞くと「学習した単語」に入るが、習熟・正答率は変わらない", () => {
  window.localStorage.clear();
  vocab.recordVocabListen("output");
  vocab.recordVocabListen("output");
  const sum = vocab.getVocabSummary();
  assert.equal(sum.touched, 1);
  assert.equal(sum.mastered, 0);
  assert.equal(sum.attempted, 0);
  assert.equal(sum.reviewCount, 0);
  assert.equal(vocab.loadVocabStore().words.output.listens, 2);
  assert.deepEqual(vocab.getUnmasteredIds(), ["output"]);
});

test("バックアップに ccaofListenV1 が入り、戻すと聞いた記録も戻る。リセットで消える", () => {
  window.localStorage.clear();
  listen.recordListen("item", "d1-001");
  listen.recordListen("lesson", "D1-1");
  const b = backup.buildBackup();
  assert.ok(b.data.ccaofListenV1);
  const d = backup.describeBackup(b);
  assert.equal(d.listenedItems, 1);
  assert.equal(d.listenedLessons, 1);
  const parsed = backup.parseBackup(JSON.stringify(b));
  assert.ok(parsed.ok);
  window.localStorage.clear();
  backup.applyBackup(parsed.backup);
  assert.equal(listen.getListenSummary().items, 1);
  progress.resetProgress();
  assert.equal(listen.getListenSummary().items, 0);
  // v1.31.0 までのバックアップ（聞いた記録なし）も読める
  const old = { ...b, data: { ccaofProgressV1: { domains: {}, daily: {} } } };
  assert.ok(backup.parseBackup(JSON.stringify(old)).ok);
  assert.equal(backup.describeBackup(old).listenedItems, 0);
});

test(`CCAR-F：全 ${arItems.length} 問・${arLessons.length} 讲义・${arWords.length} 語から台本が作れる`, () => {
  checkTracks(audio.filterTracks(audio.questionTracks(arItems), ALL), arItems.length);
  const lt = audio.filterTracks(audio.lessonTracks(arLessons), ALL);
  checkTracks(lt, lt.length);
  assert.deepEqual(lt.filter((t) => t.record).map((t) => t.record.id), arLessons.map((l) => l.id));
  checkTracks(audio.filterTracks(audio.vocabTracks(arWords), ALL), arWords.length);
  // シナリオの説明（画面の音声モードで material として先頭に読む）も台本にできる
  const withSc = arItems.slice(0, 5).map((q) => {
    const sc = arMeta.scenarios.find((x) => x.id === q.scenario);
    return sc ? { ...q, material: `Scenario: ${sc.title}. ${sc.description}`, materialZh: `场景：${sc.titleZh}。${sc.descriptionZh}` } : q;
  });
  checkTracks(audio.filterTracks(audio.questionTracks(withSc), ALL), 5);
});

test("聞いた記録は資格ごと：CCAR-F は ccarfListenV1、CCAO-F の ccaofListenV1 は変わらない", () => {
  window.localStorage.clear();
  certState.setActiveCertState("ccaof");
  listen.recordListen("item", "d1-001");
  certState.setActiveCertState("ccarf");
  assert.equal(listen.getListenSummary().items, 0);
  listen.recordListen("item", "ar1-001");
  assert.ok(JSON.parse(window.localStorage.getItem("ccarfListenV1")).items["ar1-001"]);
  assert.ok(backup.buildBackup().data.ccarfListenV1);
  certState.setActiveCertState("ccaof");
  assert.deepEqual(Object.keys(JSON.parse(window.localStorage.getItem("ccaofListenV1")).items), ["d1-001"]);
});

test("中文の声：普通话（中国大陆）の聞きやすい声をえらび、粤语は使わない", () => {
  const V = (name, lang, localService = true) => ({ name, lang, voiceURI: name, localService });
  const windows = [
    V("Microsoft Huihui - Chinese (Simplified, PRC)", "zh-CN"),
    V("Microsoft Xiaoxiao Online (Natural) - Chinese (Mainland)", "zh-CN", false),
    V("Microsoft HiuGaai Online (Natural) - Chinese (Cantonese Traditional)", "zh-HK", false),
  ];
  assert.equal(voicePick.pickVoice(windows, "zh").name, "Microsoft Xiaoxiao Online (Natural) - Chinese (Mainland)");
  const chrome = [V("Google 粤語（香港）", "zh-HK", false), V("Google 國語（臺灣）", "zh-TW", false), V("Google 普通话（中国大陆）", "zh-CN", false)];
  assert.equal(voicePick.pickVoice(chrome, "zh").name, "Google 普通话（中国大陆）");
  const apple = [V("Sinji", "zh-HK"), V("Meijia", "zh-TW"), V("Tingting", "zh-CN")];
  assert.equal(voicePick.pickVoice(apple, "zh").name, "Tingting");
  // 粤语しかない端末では中文の声なし
  assert.equal(voicePick.pickVoice([V("Sinji", "zh-HK"), V("Aasing", "yue-HK")], "zh"), null);
  // 普通话がなければ台湾の国語
  assert.equal(voicePick.pickVoice([V("Sinji", "zh-HK"), V("Meijia", "zh-TW")], "zh").name, "Meijia");
  // えらんだ声があればそれ。粤语をえらんでいても使わない
  assert.equal(voicePick.pickVoice(apple, "zh", "Meijia").name, "Meijia");
  assert.equal(voicePick.pickVoice(apple, "zh", "Sinji").name, "Tingting");
  assert.deepEqual(voicePick.rankVoices(apple, "zh").map((v) => v.name), ["Tingting", "Meijia"]);
  // 英語・日本語は従来どおり端末内の声を優先
  assert.equal(voicePick.pickVoice([V("Google US English", "en-US", false), V("Samantha", "en-US")], "en").name, "Samantha");
  assert.equal(voicePick.pickVoice([V("Kyoko", "ja_JP")], "ja").name, "Kyoko");
});

test("中文の読み上げ：記号を普通话で読める形にする", () => {
  assert.equal(audio.speakableZh("先看「读者」「用途」——再决定"), "先看读者、用途，再决定");
  assert.equal(audio.speakableZh("目的／读者／标准"), "目的、读者、标准");
  assert.equal(audio.speakableZh("负责人＋期限"), "负责人加期限");
  assert.equal(audio.speakableZh("产出太笼统 → 加示例"), "产出太笼统，加示例");
  assert.equal(audio.speakableZh("3～5 次"), "3到5 次");
  assert.equal(audio.speakableZh("AWS/GCP"), "AWS/GCP");
  // 讲义の中文はすべて読める形になり、記号が残らない
  [lessons, arLessons].forEach((ls) =>
    audio.filterTracks(audio.lessonTracks(ls), ALL).forEach((t) =>
      t.steps.filter((s) => s.lang === "zh").forEach((s) =>
        audio.utterancesOf(s).forEach((u) => assert.ok(!/[「」『』→—／＋]/.test(u.text), u.text))
      )
    )
  );
});

console.log(`\n✅ ${passed} 件すべて成功\n`);
