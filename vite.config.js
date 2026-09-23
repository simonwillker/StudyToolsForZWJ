import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";

/* バージョンは package.json だけを見る。
   以前は package.json と EikenApp.jsx の2か所に手書きしていたため、
   27コミットぶん更新しても画面の表示が v1.1.0 のまま動かなかった。

   ビルド日も一緒に埋める。Service Worker が古い版をキャッシュしている
   ことがあるので、スマホの画面で「いつの版か」が見えないと
   更新が届いたのか確かめようがない。 */
const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
const buildDate = new Date().toISOString().slice(0, 10);

export default defineConfig({
  base: "/StudyToolsForZWJ/",
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_DATE__: JSON.stringify(buildDate),
  },
});
