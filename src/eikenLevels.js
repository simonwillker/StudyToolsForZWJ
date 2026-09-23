/* ============================================================
   級データの遅延読み込み

   以前は EikenApp.jsx の冒頭で 14個の JSON（7級 × ドリル/模試）を
   すべて static import していた。そのため5級しか使わない子どもでも
   1級の問題まで最初に読み込んでいた（gzip 961 kB）。

   ここでは「級を選ぶ画面に必要な情報」だけを同期の定数として持ち、
   重い本体（vocab / grammar / reading / listening / dialogue）は
   import() で級ごとに読む。Vite が自動で別チャンクに分ける。

   メタ情報は各 JSON の先頭4フィールドと同じ値。JSON 側を変えたら
   ここも合わせること（読み込み後に level.levelLabel などを使うので、
   ずれていても画面は壊れないが、級選択画面だけ古い表示になる）。
   ============================================================ */

export const LEVEL_META = [
  { level: "1", levelLabel: "1級", levelSub: "大学上級・社会人上級程度", color: "#3B3B3B" },
  { level: "pre1", levelLabel: "準1級", levelSub: "大学中級程度", color: "#2F5D8A" },
  { level: "2", levelLabel: "2級", levelSub: "高校卒業程度", color: "#8A3B2F" },
  { level: "pre2", levelLabel: "準2級", levelSub: "高校中級程度", color: "#5A3B8A" },
  { level: "3", levelLabel: "3級", levelSub: "中学卒業程度", color: "#8A6D2F" },
  { level: "4", levelLabel: "4級", levelSub: "中学中級程度", color: "#2F6E8A" },
  { level: "5", levelLabel: "5級", levelSub: "中学初級程度", color: "#2F7A4F" },
];

/* import() の引数は静的な文字列でないと Vite が解析できない。
   テンプレート文字列で組み立てず、級ごとに1行ずつ書く。 */
const LEVEL_LOADERS = {
  "1": () => import("./data/eikenApp/1.json"),
  pre1: () => import("./data/eikenApp/pre1.json"),
  "2": () => import("./data/eikenApp/2.json"),
  pre2: () => import("./data/eikenApp/pre2.json"),
  "3": () => import("./data/eikenApp/3.json"),
  "4": () => import("./data/eikenApp/4.json"),
  "5": () => import("./data/eikenApp/5.json"),
};

const TEST_LOADERS = {
  "1": () => import("./data/eikenTest/1.json"),
  pre1: () => import("./data/eikenTest/pre1.json"),
  "2": () => import("./data/eikenTest/2.json"),
  pre2: () => import("./data/eikenTest/pre2.json"),
  "3": () => import("./data/eikenTest/3.json"),
  "4": () => import("./data/eikenTest/4.json"),
  "5": () => import("./data/eikenTest/5.json"),
};

/** 読み込み済みの実体。2度目以降は import() を待たずに即返す */
const levelCache = new Map();
const testCache = new Map();
/** 同じ級を連打しても import() が1回で済むように、進行中の Promise も持つ */
const levelPending = new Map();
const testPending = new Map();

export function findLevelMeta(id) {
  return LEVEL_META.find((l) => l.level === id) || LEVEL_META[0];
}

/** 読み込み済みなら実体、まだなら null。ローディング表示を出すかの判定に使う */
export function peekLevel(id) {
  return levelCache.get(id) || null;
}
export function peekTest(id) {
  return testCache.get(id) || null;
}

function loadFrom(loaders, cache, pending, id) {
  if (cache.has(id)) return Promise.resolve(cache.get(id));
  if (pending.has(id)) return pending.get(id);
  const loader = loaders[id];
  if (!loader) return Promise.resolve(null);
  const p = loader()
    .then((mod) => {
      const data = mod.default || mod;
      cache.set(id, data);
      pending.delete(id);
      return data;
    })
    .catch((e) => {
      // 失敗を覚え込ませない。オフラインで一度失敗しても、
      // 電波が戻ってからもう一度押せば読めるようにする。
      pending.delete(id);
      throw e;
    });
  pending.set(id, p);
  return p;
}

export function loadLevel(id) {
  return loadFrom(LEVEL_LOADERS, levelCache, levelPending, id);
}
export function loadTest(id) {
  return loadFrom(TEST_LOADERS, testCache, testPending, id);
}
