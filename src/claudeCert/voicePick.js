/* ============================================================
   読み上げの声をえらぶ（v1.43.0〜）

   中文は「標準の普通话（中国大陸）」の声を使う。
   - 粤语（広東語：zh-HK・yue・Sin-ji など）は普通话ではないので使わない
   - zh-TW（台湾の国語）は普通话の声がない端末の最後の手段
   - 同じ普通话でも声の質が大きく違う。Natural・Online（Edge）、Google 普通话
     （Chrome）、Tingting・Lili・Yu-shu（Apple）などを先に、古い機械的な声
     （Huihui・Kangkang・Yaoyao など）はあとに回す
   英語・日本語は従来どおり（端末内の声を優先）。

   画面や speechSynthesis には触らない（node のテストで確かめられるように）。
   ============================================================ */

const LOCALES = { en: ["en-US", "en-GB", "en"], ja: ["ja-JP", "ja"] };

const norm = (s) => String(s || "").replace(/_/g, "-").toLowerCase();

const CANTONESE = /cantonese|粤|粵|\byue\b|sin-?ji|hong ?kong|香港|hiugaai|hiumaan|wanlung|aasing/i;

/** 普通话の声か。粤语・台湾以外の地域の中文は外す。zh-TW は普通话として扱う（優先度は低い） */
export function isMandarinVoice(v) {
  if (!v) return false;
  const lang = norm(v.lang);
  if (!/^(zh|cmn)(-|$)/.test(lang)) return false;
  if (/^zh-(hk|mo)(-|$)/.test(lang) || /yue/.test(lang) || /hant-hk/.test(lang)) return false;
  if (CANTONESE.test(v.name || "")) return false;
  return true;
}

function isMainland(lang) {
  const l = norm(lang);
  return l === "zh" || l === "cmn" || /^(zh|cmn)-(cn|hans)(-|$)/.test(l) || /^zh-hans-cn/.test(l);
}

const GOOD = /natural|neural|premium|enhanced|高品质|高音质|siri/i;
const GOOD_NAMES = /xiaoxiao|xiaoyi|xiaochen|xiaohan|xiaomo|xiaoqiu|xiaorui|xiaoshuang|xiaoxuan|xiaoyan|xiaozhen|yunxi|yunjian|yunyang|yunye|yunze|tingting|ting-ting|lili|yu-?shu|lilian|panpan|shasha|lanlan|google/i;
const ROBOTIC = /huihui|kangkang|yaoyao|espeak|eloquence|compact|novelty/i;
const TAIWAN = /^zh-(tw|hant)(-|$)/;

/** 普通话の声の点数。高いほど聞きやすい */
export function mandarinScore(v) {
  if (!isMandarinVoice(v)) return -Infinity;
  const name = v.name || "";
  let s = 0;
  if (isMainland(v.lang)) s += 100;
  else if (TAIWAN.test(norm(v.lang))) s += 10;
  else s += 50;
  if (GOOD.test(name)) s += 40;
  if (/online/i.test(name)) s += 20;
  if (GOOD_NAMES.test(name)) s += 25;
  if (ROBOTIC.test(name)) s -= 40;
  if (v.localService) s += 3; // 同じくらいなら端末内の声（オフラインでも読める）
  return s;
}

/** その言語で使える声を、聞きやすい順に並べる */
export function rankVoices(voices, lang) {
  const list = Array.from(voices || []);
  if (lang === "zh") {
    return list
      .filter(isMandarinVoice)
      .map((v, i) => ({ v, i, s: mandarinScore(v) }))
      .sort((a, b) => b.s - a.s || a.i - b.i)
      .map((x) => x.v);
  }
  const out = [];
  for (const loc of LOCALES[lang] || []) {
    const l = loc.toLowerCase();
    const match = list.filter((v) => !out.includes(v) && (norm(v.lang) === l || norm(v.lang).startsWith(l + "-")));
    // 端末内の声（localService）を優先：オフラインでも読める
    out.push(...match.filter((v) => v.localService), ...match.filter((v) => !v.localService));
  }
  return out;
}

/** 声をえらぶ。preferredURI（画面でえらんだ声）があって使えるならそれ、なければ一番聞きやすい声 */
export function pickVoice(voices, lang, preferredURI) {
  const ranked = rankVoices(voices, lang);
  if (preferredURI) {
    const p = ranked.find((v) => v.voiceURI === preferredURI || v.name === preferredURI);
    if (p) return p;
  }
  return ranked[0] || null;
}
