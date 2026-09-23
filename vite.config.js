import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync, writeFileSync } from "node:fs";

/* バージョン番号は package.json だけを正とする。
   以前は EikenApp.jsx にも手書きしてあり、27コミットぶん更新しても
   画面は v1.1.0 のままだった（PR #29）。ここで流し込む。 */
const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
const buildDate = new Date().toISOString().slice(0, 10);

/* コード分割すると、級ごとの JSON チャンクは index.html から参照されない
   （必要になって初めて読まれる）。Service Worker は install 時に
   index.html を読んで資産を拾っているので、そのままでは
   「一度も開いていない級はオフラインで使えない」ことになる。
   そこで全ファイルの一覧をビルド時に書き出し、sw.js に読ませる。 */
function assetManifest() {
  let outDir = "dist";
  let base = "/";
  return {
    name: "asset-manifest",
    configResolved(config) {
      outDir = config.build.outDir;
      base = config.base;
    },
    generateBundle(_options, bundle) {
      const files = Object.keys(bundle)
        .filter((name) => name !== "asset-manifest.json")
        .map((name) => base + name);
      this.emitFile({
        type: "asset",
        fileName: "asset-manifest.json",
        source: JSON.stringify({ version: pkg.version, buildDate, files }, null, 2),
      });
    },
  };
}

export default defineConfig({
  base: "/StudyToolsForZWJ/",
  plugins: [react(), assetManifest()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_DATE__: JSON.stringify(buildDate),
  },
});
