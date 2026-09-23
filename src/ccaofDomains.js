/* ============================================================
   CCAO-F：ドメインごとの遅延読み込み

   src/eikenLevels.js と同じ作り。ドメイン選択画面と学習記録が使う
   メタ情報（ID・名前・色・配点比率）だけ meta.json から同期で持ち、
   問題本体は import() でドメインごとに読む。

   こうしないと、英検を使う子どもが CCAO-F の問題まで毎回
   ダウンロードすることになる（逆も同じ）。
   ============================================================ */

import META from "./data/ccaof/meta.json";

export const BLUEPRINT = META;
export const EXAM_FORMAT = META.examFormat;
/* meta.json は軽い（ドメイン定義と出題目標だけ）ので同期で持ってよい。
   重いのは問題本体の7ファイル。 */
export const DOMAINS = META.domains;

const LOADERS = {
  D1: () => import("./data/ccaof/d1-prompting.json"),
  D2: () => import("./data/ccaof/d2-evaluation.json"),
  D3: () => import("./data/ccaof/d3-selection.json"),
  D4: () => import("./data/ccaof/d4-workflow.json"),
  D5: () => import("./data/ccaof/d5-configuration.json"),
  D6: () => import("./data/ccaof/d6-governance.json"),
  D7: () => import("./data/ccaof/d7-troubleshooting.json"),
};

const cache = new Map();
const pending = new Map();

export function findDomain(id) {
  return DOMAINS.find((d) => d.id === id) || DOMAINS[0];
}

export function peekDomainItems(id) {
  return cache.get(id) || null;
}

export function loadDomainItems(id) {
  if (cache.has(id)) return Promise.resolve(cache.get(id));
  if (pending.has(id)) return pending.get(id);
  const loader = LOADERS[id];
  if (!loader) return Promise.resolve([]);
  const p = loader()
    .then((mod) => {
      const data = mod.default || mod;
      const items = data.items || [];
      cache.set(id, items);
      pending.delete(id);
      return items;
    })
    .catch((e) => {
      pending.delete(id);
      throw e;
    });
  pending.set(id, p);
  return p;
}

/** 模擬試験用。7ドメインぶんをまとめて読む */
export function loadAllDomainItems() {
  return Promise.all(DOMAINS.map((d) => loadDomainItems(d.id))).then((lists) =>
    lists.flat()
  );
}

/* 配点比率から、60問の模擬試験で各ドメインから何問取るかを決める。
   単純に四捨五入すると合計が60にならないので、端数の大きい順に
   1問ずつ配って合計を合わせる（最大剰余法）。 */
export function examBlueprintCounts(total = EXAM_FORMAT.items) {
  const raw = DOMAINS.map((d) => ({ id: d.id, exact: (total * d.weight) / 100 }));
  const counts = {};
  let assigned = 0;
  raw.forEach((r) => {
    counts[r.id] = Math.floor(r.exact);
    assigned += counts[r.id];
  });
  const byRemainder = [...raw].sort(
    (a, b) => (b.exact - Math.floor(b.exact)) - (a.exact - Math.floor(a.exact))
  );
  let i = 0;
  while (assigned < total && byRemainder.length) {
    counts[byRemainder[i % byRemainder.length].id] += 1;
    assigned += 1;
    i += 1;
  }
  return counts;
}
