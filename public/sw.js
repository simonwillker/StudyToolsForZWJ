/* ============================================================
   オフライン対応の Service Worker

   このアプリは完全な静的サイトで、学習記録も localStorage にしか
   置いていない。つまりサーバーと通信する必要が一度もないので、
   一度読み込めば以後はネットなしで動かせる。
   （電車や車の中で信号が無くても学習を続けられるようにするため）

   方針:
   - ナビゲーション（ページを開く操作）は network-first。
     オンラインなら常に最新の index.html を取りに行き、
     失敗したときだけキャッシュを返す。
     こうしないと、新しくデプロイしても古い画面が出続ける。
   - /assets/ の中身はファイル名にハッシュが入っていて中身が変わらない。
     そのため cache-first にしてよい（同じ URL なら内容も必ず同じ）。
   - アイコンや manifest は stale-while-revalidate。
     すぐキャッシュを返しつつ、裏で新しいものを取り直す。

   CACHE_NAME を変えると古いキャッシュはすべて捨てられる。
   キャッシュの構造を変えたときはここを上げること。
   ============================================================ */

const CACHE_NAME = "eiken-app-v1";

/** 最低限これだけあればオフラインでも起動できる、という一式 */
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icon.svg",
  "./apple-touch-icon.png",
  "./icon-192.png",
  "./icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      // 1つでも失敗すると addAll 全体が失敗するため、個別に入れて取りこぼしを許容する
      await Promise.all(
        APP_SHELL.map((url) => cache.add(url).catch(() => null))
      );

      // 初回訪問では、本体のJS/CSSはこの Service Worker が動き出す前に
      // 読み込まれてしまう。そのままだと「一度目はオフラインにできず、
      // 二度目の訪問でようやく使える」という分かりにくい挙動になる。
      // そこで index.html を自分で読んで、参照されている資産も今のうちに拾っておく。
      try {
        const html = await (await fetch("./index.html", { cache: "no-cache" })).text();
        const assets = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
          .map((m) => m[1])
          .filter((u) => u.includes("/assets/"));
        await Promise.all(assets.map((u) => cache.add(u).catch(() => null)));
      } catch (e) {
        // 取れなくても致命的ではない。次回オンラインで開いたときに拾われる。
      }
      // 新しい Service Worker を待たせない。
      // 待たせると、古い版のまま何日も使い続けてしまうことがある。
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))
      );
      await self.clients.claim();
    })()
  );
});

/* キャッシュ照合時は必ず ignoreVary を付ける。
   Vite の module script は crossorigin 付きで読み込まれるため Origin ヘッダが付き、
   サーバーの Vary と組み合わさると「同じURLなのに別物」と判定されて
   キャッシュに当たらなくなる（実際にこれでオフライン化が失敗した）。 */
const MATCH = { ignoreVary: true };

/** ネットを試し、だめならキャッシュ。ページを開く操作に使う。 */
async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const fresh = await fetch(request);
    // 取得できたら次のオフラインに備えて保存しておく
    if (fresh && fresh.ok) cache.put(request, fresh.clone());
    return fresh;
  } catch (e) {
    // オフライン。まずそのURL、無ければアプリの入口を返す
    return (
      (await cache.match(request, MATCH)) ||
      (await cache.match("./index.html", MATCH)) ||
      (await cache.match("./", MATCH))
    );
  }
}

/** キャッシュ優先。ハッシュ付きで中身が変わらないファイル向け。 */
async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request, MATCH);
  if (cached) return cached;
  try {
    const fresh = await fetch(request);
    if (fresh && fresh.ok) cache.put(request, fresh.clone());
    return fresh;
  } catch (e) {
    // オフラインで未キャッシュ。ここで例外を投げると読み込み失敗になるため、
    // 明示的にエラー応答を返す。
    return new Response("", { status: 504, statusText: "offline" });
  }
}

/** すぐキャッシュを返しつつ、裏で更新しておく。 */
async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request, MATCH);
  const updating = fetch(request)
    .then((fresh) => {
      if (fresh && fresh.ok) cache.put(request, fresh.clone());
      return fresh;
    })
    .catch(() => null);
  return cached || (await updating) || Response.error();
}

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // GET 以外と、他サイトへの通信には一切関与しない
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request));
    return;
  }

  if (url.pathname.includes("/assets/")) {
    event.respondWith(cacheFirst(request));
    return;
  }

  if (/\.(?:png|svg|ico|webmanifest|css|js)$/.test(url.pathname)) {
    event.respondWith(staleWhileRevalidate(request));
  }
});
