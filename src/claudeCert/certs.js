/* ============================================================
   Claude 認定：資格の一覧

   資格ごとの「名前・保存キーの頭・画面の文言」だけを置く。
   問題データ（src/data/claudeCert/<id>/）は domains.js が読む。

   - prefix：localStorage のキーの頭。CCAO-F は以前からの "ccaof" の
     ままなので、v1.31.0 までの学習記録・錯題本・模試の結果は
     移しかえなしでそのまま使われる（キー名は 1 文字も変えない）。
   - status："ready" は選べる。"planned" は一覧に「準備中」と出すだけ。

   資格を足すときは、ここに 1 件足して src/data/claudeCert/<id>/ に
   meta.json・lessons.json・d1-*.json…・glossary.json を置く。
   ============================================================ */

export const CERTS = [
  {
    id: "ccaof",
    code: "CCAO-F",
    name: "Claude Certified Associate – Foundations",
    prefix: "ccaof",
    studyApp: "CCAO-F 対策",
    backupFormat: "ccaof-study-backup",
    backupFilePrefix: "ccaof-backup",
    color: "#C8743D",
    status: "ready",
    audience: "Claude を業務で使う人向け（プロンプト・出力の評価・製品の選び方・ガバナンス）",
    title: "CCAO-F 対策",
    eyebrow: "CCAO-F — CLAUDE CERTIFIED ASSOCIATE (FOUNDATIONS)",
    lead: "公式 Exam Guide v1.0（2026年7月発効）の7ドメインに沿った練習問題です。問題文はすべてオリジナルで、公式の試験問題は使っていません。",
    officialDesc:
      "受験料 ${fee}、Pearson VUE のオンライン監督またはテストセンターで受験します。申し込みは Anthropic Partner Academy から。問題はすべてオリジナルで、公式の試験問題（機密扱い）は一切含みません。",
    links: [
      { label: "Claude 認定プログラム（Pearson VUE） ↗", url: "https://www.pearsonvue.com/us/en/anthropic.html" },
      { label: "Claude ドキュメント ↗", url: "https://docs.claude.com/" },
      { label: "Anthropic 利用ポリシー ↗", url: "https://www.anthropic.com/legal/aup" },
    ],
  },
  {
    id: "ccarf",
    code: "CCAR-F",
    name: "Claude Certified Architect – Foundations",
    prefix: "ccarf",
    studyApp: "CCAR-F 対策",
    backupFormat: "ccarf-study-backup",
    backupFilePrefix: "ccarf-backup",
    color: "#2F5D8A",
    status: "ready",
    audience: "Claude で本番アプリを設計する人向け（Agent SDK・Claude Code・MCP・構造化出力・コンテキスト管理）",
    title: "CCAR-F 対策",
    eyebrow: "CCAR-F — CLAUDE CERTIFIED ARCHITECT (FOUNDATIONS)",
    lead: "公式 Exam Guide v1.0（2026年7月発効）の5ドメイン・30 task statement・6シナリオに沿った練習問題です。問題文はすべてオリジナルで、公式の試験問題・サンプル問題は使っていません。",
    officialDesc:
      "受験料 ${fee}、Pearson VUE のオンライン監督またはテストセンターで受験します。申し込みは Anthropic Partner Academy から。本番はシナリオ形式（6 シナリオから 4 つ）。問題はすべてオリジナルです。",
    links: [
      { label: "Claude Partner Network（CCAR-F 発表） ↗", url: "https://www.anthropic.com/news/claude-partner-network" },
      { label: "Claude Code ドキュメント ↗", url: "https://code.claude.com/docs/en/overview" },
      { label: "Claude API ドキュメント ↗", url: "https://platform.claude.com/docs/en/home" },
    ],
  },
  {
    id: "ccdvf",
    code: "CCDV-F",
    name: "Claude Certified Developer – Foundations",
    prefix: "ccdvf",
    color: "#3F6F52",
    status: "planned",
    audience: "準備中",
  },
  {
    id: "ccarp",
    code: "CCAR-P",
    name: "Claude Certified Architect – Professional",
    prefix: "ccarp",
    color: "#5A3B8A",
    status: "planned",
    audience: "準備中",
  },
];

export function findCert(id) {
  return CERTS.find((c) => c.id === id) || null;
}

/** トップで最後に開いていたアプリ。v1.31.0 までの "ccaof"（CCAO-F 対策）は
    "claudeCert" に直し、CCAO-F をそのまま開く（最初の 1 回だけ） */
export const LEGACY_CCAOF_APP = "ccaof";
export const CLAUDE_CERT_APP = "claudeCert";
export function migrateClaudeCertApp(stored) {
  if (stored === LEGACY_CCAOF_APP) return { app: CLAUDE_CERT_APP, cert: "ccaof" };
  return { app: stored, cert: null };
}
