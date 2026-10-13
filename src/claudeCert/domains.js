/* ============================================================
   Claude 認定：資格ごとのデータの読み込み（ドメインごとに遅延読み込み）

   src/eikenLevels.js と同じ作り。ドメイン選択画面と学習記録が使う
   メタ情報（ID・名前・色・配点比率・シナリオ）だけ meta.json から同期で
   持ち、問題本体は import() でドメインごとに読む。

   こうしないと、英検を使う子どもが Claude 認定の問題まで毎回
   ダウンロードすることになる（逆も同じ）。

   データは src/data/claudeCert/<資格 id>/ に置く：
     meta.json（ブループリント）・lessons.json（考点讲义）・
     d1-*.json…（ドメインごとの問題）・vocab.json（頻出単語。生成物）

   画面は 1 度に 1 つの資格しか開かないので、activateCert(id) で
   選んだ資格の DOMAINS などを差し替える（ES モジュールの live binding で
   import した側にも反映される）。
   ============================================================ */

import { buildObjectives, blueprintCounts } from "./studyCore";
import { setActiveCertState } from "./certState";

/* meta.json は軽い（ドメイン定義と出題目標だけ）ので同期で持つ */
const METAS = import.meta.glob("../data/claudeCert/*/meta.json", { eager: true, import: "default" });
/* 問題ファイルは d1-*.json〜。ファイル名の先頭の数字がドメイン番号（d1 → D1） */
const ITEM_FILES = import.meta.glob("../data/claudeCert/*/d[0-9]*-*.json");
const LESSON_FILES = import.meta.glob("../data/claudeCert/*/lessons.json");
const VOCAB_FILES = import.meta.glob("../data/claudeCert/*/vocab.json");

function certDir(id) {
  return `../data/claudeCert/${id}/`;
}

export function getCertMeta(id) {
  return METAS[`${certDir(id)}meta.json`] || null;
}

export let CERT_ID = null;
export let BLUEPRINT = null;
export let EXAM_FORMAT = null;
export let DOMAINS = [];
/* 考点。id は "D1-1" のようにドメイン内の並び順から作る */
export let OBJECTIVES = [];
/* 本番がシナリオ形式の資格だけ。無ければ空 */
export let SCENARIOS = [];

let LOADERS = {};
let lessonsLoader = null;
let vocabLoader = null;

/* 資格ごとのキャッシュ（同じ "D1" でも資格が違えば別物） */
const caches = new Map();
function cacheFor(id) {
  if (!caches.has(id)) caches.set(id, { items: new Map(), pending: new Map(), lessons: null, vocab: null });
  return caches.get(id);
}

/** 資格を切り替える。画面（ClaudeCertApp）が資格を開く前に呼ぶ */
export function activateCert(id) {
  const meta = getCertMeta(id);
  if (!meta) throw new Error(`meta.json が無い資格: ${id}`);
  setActiveCertState(id);
  CERT_ID = id;
  BLUEPRINT = meta;
  EXAM_FORMAT = meta.examFormat;
  DOMAINS = meta.domains;
  OBJECTIVES = buildObjectives(meta);
  SCENARIOS = meta.scenarios || [];
  const dir = certDir(id);
  LOADERS = {};
  Object.keys(ITEM_FILES).forEach((path) => {
    if (!path.startsWith(dir)) return;
    const m = path.slice(dir.length).match(/^d(\d+)-/);
    if (m) LOADERS[`D${m[1]}`] = ITEM_FILES[path];
  });
  lessonsLoader = LESSON_FILES[`${dir}lessons.json`] || null;
  vocabLoader = VOCAB_FILES[`${dir}vocab.json`] || null;
  return meta;
}

/** 考点讲义（lessons.json）。中国語の本文で重いので、問題と同じく必要になってから読む */
export function loadLessons() {
  const c = cacheFor(CERT_ID);
  if (!c.lessons) {
    if (!lessonsLoader) return Promise.resolve([]);
    c.lessons = lessonsLoader()
      .then((mod) => (mod.default || mod).lessons || [])
      .catch((e) => {
        c.lessons = null;
        throw e;
      });
  }
  return c.lessons;
}

/** 頻出単語（vocab.json。scripts/buildClaudeCertVocab.mjs が生成） */
export function loadVocab() {
  const c = cacheFor(CERT_ID);
  if (!c.vocab) {
    if (!vocabLoader) return Promise.resolve({ words: [] });
    c.vocab = vocabLoader()
      .then((mod) => mod.default || mod)
      .catch((e) => {
        c.vocab = null;
        throw e;
      });
  }
  return c.vocab;
}

export function findDomain(id) {
  return DOMAINS.find((d) => d.id === id) || DOMAINS[0];
}

export function findScenario(id) {
  return SCENARIOS.find((s) => s.id === id) || null;
}

export function peekDomainItems(id) {
  return cacheFor(CERT_ID).items.get(id) || null;
}

export function loadDomainItems(id) {
  const c = cacheFor(CERT_ID);
  if (c.items.has(id)) return Promise.resolve(c.items.get(id));
  if (c.pending.has(id)) return c.pending.get(id);
  const loader = LOADERS[id];
  if (!loader) return Promise.resolve([]);
  const p = loader()
    .then((mod) => {
      const data = mod.default || mod;
      const items = data.items || [];
      c.items.set(id, items);
      c.pending.delete(id);
      return items;
    })
    .catch((e) => {
      c.pending.delete(id);
      throw e;
    });
  c.pending.set(id, p);
  return p;
}

/** 模擬試験用。全ドメインぶんをまとめて読む */
export function loadAllDomainItems() {
  return Promise.all(DOMAINS.map((d) => loadDomainItems(d.id))).then((lists) => lists.flat());
}

/* 配点比率から、60問の模擬試験で各ドメインから何問取るかを決める（最大剰余法） */
export function examBlueprintCounts(total = EXAM_FORMAT.items) {
  return blueprintCounts(DOMAINS, total);
}
