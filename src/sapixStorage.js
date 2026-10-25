/* ============================================================
   Sapix：学年・科目の一覧と、学習記録の保存キー

   ブラウザにも Vite にも頼らない純粋なモジュール。node から
   そのまま読めるので、scripts/testSapixStorage.mjs でキーと移行を確かめる。

   ■ 保存キーについて（大事）
   4年の 5 科目は、学年別にする前（v1.28.0 まで）から使っているキー
   （sapixMathProgressV1 など）をそのまま使う。ここを変えると、
   これまでの記録（ZWJ / ZY / Guest ごと）とバックアップが読めなくなる。
   4年以外は sapixG<学年><科目>ProgressV1 の形で新しく作る。
   ============================================================ */

/** 扱える学年。データ（src/data/sapix/g<学年>/）がある学年だけ画面に出る */
export const GRADES = [1, 2, 3, 4, 5, 6];

/** 科目。並び順がそのまま画面の並び順になる。データがある科目だけ画面に出る */
export const SUBJECT_DEFS = [
  { id: "math", label: "算数", key: "Math", accent: "#2F5D8A", card: "#2F7A8A", shuffleChoices: false, fractions: true },
  { id: "kokugo", label: "国語", key: "Kokugo", accent: "#8A3B2F", card: "#9A4A2F", shuffleChoices: true, fractions: false },
  { id: "rika", label: "理科", key: "Rika", accent: "#5A3B8A", card: "#6A4A9A", shuffleChoices: true, fractions: false },
  { id: "shakai", label: "社会", key: "Shakai", accent: "#2F7A4F", card: "#3F6F52", shuffleChoices: true, fractions: false },
  { id: "eigo", label: "英語", key: "Eigo", accent: "#2F7A8A", card: "#2F7A8A", shuffleChoices: true, fractions: false },
];

/** 学年別にする前から記録がある学年。この学年だけ昔のキーと勉強履歴の名前を使う */
export const LEGACY_GRADE = 4;

export function subjectDef(subjectId) {
  return SUBJECT_DEFS.find((s) => s.id === subjectId) || null;
}

/** 学年×科目の ID（"g4-math" など） */
export function courseId(grade, subjectId) {
  return `g${grade}-${subjectId}`;
}

/** 学習記録・復習リスト・錯題本・まとめテストの localStorage キー（勉強者の区別は learnerKey が後ろにつける）。
 *  reviewKey（v1.40.0 までの復習リスト）は錯題本に移したあとは読むだけ（移行とバックアップの互換のため残す）。 */
export function storageKeys(grade, subjectId) {
  const def = subjectDef(subjectId);
  if (!def) throw new Error(`unknown Sapix subject: ${subjectId}`);
  const base = grade === LEGACY_GRADE ? `sapix${def.key}` : `sapixG${grade}${def.key}`;
  return {
    progressKey: `${base}ProgressV1`,
    reviewKey: `${base}ReviewV1`,
    mistakesKey: `${base}MistakesV1`,
    testKey: `${base}TestResultsV1`,
  };
}

/** 勉強履歴（📅）に出す名前。4年は以前と同じ「Sapix 算数」にして、履歴の名前がそろうようにする */
export function logTitle(grade, subjectId) {
  const def = subjectDef(subjectId);
  return grade === LEGACY_GRADE ? `Sapix ${def.label}` : `Sapix ${grade}年 ${def.label}`;
}

/* ---------- アプリ選択画面の「最後に開いたアプリ」の移行 ----------
   v1.28.0 までは、トップ画面に科目ごとのカードがあり、最後に開いた
   アプリとして "sapixMath" などを studyToolsActiveApp に保存していた。
   いまは "sapix" 1 つにまとめたので、古い値を読んだら "sapix" にし、
   開いていた科目（4年）をそのまま開けるようにする。 */

/** v1.28.0 までのアプリ ID → 科目 */
export const LEGACY_APP_IDS = {
  sapixMath: "math",
  sapixKokugo: "kokugo",
  sapixShakai: "shakai",
  sapixRika: "rika",
  sapixEigo: "eigo",
};

/**
 * 保存されていたアプリ ID を今の形にする。
 * 返り値 { app, course }。course は古い値から移したときだけ { grade, subject }。
 */
export function migrateActiveApp(stored) {
  const subject = LEGACY_APP_IDS[stored];
  if (subject) return { app: "sapix", course: { grade: LEGACY_GRADE, subject } };
  return { app: stored || "menu", course: null };
}
