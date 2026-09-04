/* eslint-disable react-refresh/only-export-components */
import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from "react";

/**
 * Lightweight i18n.
 * Japanese strings are used verbatim as keys; the `en` dictionary maps them
 * to English. Unknown keys fall back to the Japanese source text, so adding
 * a new string never breaks the UI.
 */
export type Lang = "ja" | "en";
const LANG_KEY = "app-lang";

const en: Record<string, string> = {
  // ── Navigation / layout ─────────────────────────────────────────────────
  "ダッシュボード": "Dashboard",
  "投稿原稿管理": "Posts",
  "カレンダー": "Calendar",
  "投稿履歴": "History",
  "分析": "Analytics",
  "月次レポート": "Monthly Report",
  "設定": "Settings",
  "サインアウト": "Sign out",
  "サインイン": "Sign in",
  "運用チームメンバーとしてサインインしてください。": "Sign in as an operations team member.",
  "毎日の発信を、確かなリズムで。": "Every day. On rhythm.",
  "投稿の計画・自動配信・効果測定までを一つに。公式Threadsアカウントの運用ダッシュボードです。":
    "Plan, auto-publish, and measure — all in one operations dashboard for your official Threads account.",

  "アカウント": "Account",
  "アカウントを切り替え": "Switch account",

  // ── Dashboard ───────────────────────────────────────────────────────────
  "未投稿": "Queued",
  "アカウント未設定": "No account configured",
  "投稿済み": "Posted",
  "エラー": "Error",
  "公式Threads運用状況": "Official Threads operations",
  "次回投稿プレビュー": "Next Post Preview",
  "朝の投稿枠": "Morning slot",
  "夕方の投稿枠": "Evening slot",
  "追加投稿枠": "Extra slot",
  "今すぐ投稿": "Post now",
  "投稿中...": "Posting...",
  "投稿を確認": "Confirm post",
  "この原稿をThreadsに今すぐ投稿します。よろしいですか？": "This draft will be posted to Threads immediately. Continue?",
  "キャンセル": "Cancel",
  "投稿する": "Post",
  "最近の投稿履歴": "Recent Activity",
  "投稿履歴がありません": "No post history yet",
  "未投稿の原稿がありません": "No queued drafts",
  "投稿が完了しました": "Posted successfully",

  // ── Posts ───────────────────────────────────────────────────────────────
  "原稿の追加・編集・削除・一括インポート": "Create, edit, delete, and bulk-import drafts",
  "承認フロー有効：承認済みの原稿のみ自動投稿されます": "Approval flow on: only approved drafts are auto-posted",
  "AIアシスト": "AI Assist",
  "一括インポート": "Bulk Import",
  "インポート": "Import",
  "新規追加": "New Draft",
  "原稿がありません。「新規追加」「AIアシスト」「一括インポート」から作成してください。":
    "No drafts yet. Create one with New Draft, AI Assist, or Bulk Import.",
  "読み込み中...": "Loading...",
  "朝": "AM",
  "夕": "PM",
  "未承認": "Pending approval",
  "承認": "Approve",
  "下書きに戻す": "Move back to draft",
  "未投稿に戻す": "Move back to queue",
  "原稿を編集": "Edit Draft",
  "未保存": "Unsaved",
  "保存されていない変更があります。破棄してよろしいですか？":
    "You have unsaved changes. Discard them?",
  "本文を入力してください。": "Enter some text.",
  "500文字を超えています。": "Over the 500-character limit.",
  "日本語・英語・絵文字を含めて500文字までです。": "Up to 500 characters, emoji included.",
  "投稿日の形式が正しくありません。": "That date is not valid.",
  "過去の日付です。次回のスケジューラ実行時に投稿されます。":
    "That date is in the past; it will be posted on the next scheduler run.",
  "同じ日・同じ枠に別の未投稿原稿があります。": "Another queued draft already uses this date and slot.",
  "添付画像のプレビュー": "Attached image preview",
  "画像を差し替える": "Replace image",
  "画像を削除": "Remove image",
  "JPEG / PNG / WebP・推奨 1080×1080 以上・4MBまで": "JPEG / PNG / WebP · 1080×1080 or larger recommended · up to 4MB",
  "枠が未設定です": "No slot configured",
  "リライト案を作る": "Draft a rewrite",
  "リライト案": "Rewritten draft",
  "この案を適用": "Use this draft",
  "再生成": "Regenerate",
  "破棄": "Discard",
  "変更点": "What changed",
  "警告": "Warnings",
  "リライト前に戻す": "Undo rewrite",
  "リライト案を適用しました": "Rewrite applied",
  "リライト前に戻しました": "Reverted to the original",
  "AIへの指示（任意）": "Instruction for AI (optional)",
  "（ANTHROPIC_API_KEY を設定してください）": "(set ANTHROPIC_API_KEY)",
  "短くする": "Make it shorter",
  "読みやすくする": "Make it easier to read",
  "より自然にする": "Make it sound natural",
  "冒頭を強くする": "Strengthen the opening",
  "CTAを改善する": "Improve the call to action",
  "関連する絵文字を追加": "Add relevant emoji",
  "絵文字を減らす": "Use fewer emoji",
  "新規原稿を追加": "New Draft",
  "投稿内容": "Content",
  "AIへの指示（例: もっと短く / 絵文字を入れて）": "Instruction for AI (e.g. make it shorter / add emoji)",
  "AIリライト": "AI Rewrite",
  "生成中...": "Generating...",
  "投稿スロット": "Slot",
  "カテゴリー": "Category",
  "なし": "None",
  "投稿先アカウント": "Account",
  "デフォルト": "Default",
  "更新": "Save",
  "追加": "Add",
  "追加しました": "Added",
  "更新しました": "Updated",
  "削除しました": "Deleted",
  "リライトしました": "Rewritten",
  "削除しますか？": "Delete this?",
  "AIアシスト — 下書き生成": "AI Assist — Draft Generation",
  "投稿テーマ": "Topic",
  "例: 8月23日開催のオープンキャンパスの告知。個別相談あり。": "e.g. Announce the Aug 23 open campus event. One-on-one sessions available.",
  "過去投稿の文体を学習し、ブランドボイスに合わせた案を3つ生成します。":
    "Generates 3 drafts matched to your brand voice, learned from past posts.",
  "トーン": "Tone",
  "言語": "Language",
  "日本語": "Japanese",
  "英語": "English",
  "いつものトーン": "Usual tone",
  "カジュアル": "Casual",
  "フォーマル": "Formal",
  "元気": "Energetic",
  "生成する": "Generate",
  "編集して使う": "Edit & use",
  "そのまま追加": "Add as-is",
  "1行1投稿でテキストを貼り付けてください。空行は無視されます。500文字超の行はスキップされます。":
    "Paste text, one post per line. Empty lines are ignored; lines over 500 characters are skipped.",
  "1行目の投稿内容\n2行目の投稿内容\n...": "First post\nSecond post\n...",
  "ファイルから読み込み": "Load from file",
  "複数行の投稿は「---」だけの行で区切ってください。": "Separate multi-line posts with a line containing only \"---\".",
  "件は500文字を超えているためスキップされます": " posts exceed 500 characters and will be skipped",
  "追加して今すぐ投稿": "Add & post now",
  "再投稿": "Repost",
  "方法A: 連携リンクを送る（推奨）": "Option A: Send a connection link (recommended)",
  "リンクを開いた本人がThreadsで許可すると、このアプリにアカウントが追加されます。パスワードを預かる必要がありません。":
    "The person who opens the link approves it in Threads and the account is added here — no password sharing needed.",
  "連携リンクを発行": "Create connection link",
  "発行中...": "Creating...",
  "リンクをコピー": "Copy link",
  "リンクをコピーしました": "Link copied",
  "方法B: 長期アクセストークンを直接入力": "Option B: Paste a long-lived access token",
  "画像（任意）": "Image (optional)",
  "画像を追加": "Add image",
  "画像を変更": "Replace image",
  "画像を外す": "Remove image",
  "アップロード中...": "Uploading...",
  "画像を添付しました": "Image attached",
  "画像の処理に失敗しました": "Failed to process the image",
  "この日の指定スロットに投稿されます。": "Posts in the selected slot on this date.",
  "空欄なら「空き枠に自動割り当て」で最短の空きに入ります。": "Leave empty to fill the earliest open slot via auto-assign.",
  "予約済みの配信": "Scheduled runway",
  "日分": " days",
  "〜": "through ",
  "投稿が途切れる日": "Days with no post",
  "日": " days",
  "日付未定の原稿": "Undated drafts",
  "空き枠に自動割り当て": "Auto-assign to open slots",
  "割り当て中...": "Assigning...",
  "空き枠に割り当てました": "Assigned to open slots",
  "再投稿コンテンツにする": "Save as repost content",
  "再投稿コンテンツから外す": "Remove from repost content",
  "再投稿コンテンツに登録しました": "Saved as repost content",
  "再投稿コンテンツの設定を更新しました": "Repost setting updated",
  "空き枠を再投稿コンテンツで埋める": "Fill empty slots with repost content",
  "予約原稿が尽きた投稿枠を、「再投稿コンテンツ」に登録した過去の投稿で自動的に埋めます。":
    "When no scheduled draft is left for a slot, automatically post one of your saved repost items.",
  "AIで言い回しを変える": "Reword with AI",
  "内容・数字・固有名詞はそのままに、言い回しと絵文字だけを変えて再投稿します（APIキー未設定時は原文のまま）。":
    "Keeps the facts, numbers and names intact and varies only the wording and emoji (posts the original text if no API key is set).",
  "同じ投稿を再利用するまでの間隔（日）": "Days before reusing the same post",
  "すべて選択": "Select all",
  "件選択中": " selected",
  "選択": "Select",
  "選択を削除": "Delete selected",
  "削除中...": "Deleting...",
  "件削除しました": " posts deleted",
  "別のアカウントへ移動": "Move to another account",
  "投稿先": "Posts to",
  "（左上の切り替えで変更できます）": "(change it with the switcher at the top left)",
  "件を移動しました": " posts moved",
  "件の原稿を削除しますか？この操作は取り消せません。": " posts will be deleted. This cannot be undone. Continue?",
  "今すぐThreadsに投稿しますか？": "Post to Threads right now?",
  "Threadsに投稿しました": "Posted to Threads",
  "対応形式: Excel (.xlsx) / CSV / TSV / テキスト / Markdown (.md)。Markdownは```で囲まれたブロックを1投稿として読み込みます。Googleスプレッドシート・ドキュメントは「ファイル → ダウンロード」で保存してから読み込んでください（コピー&ペーストでもOK）。":
    "Supported: Excel (.xlsx) / CSV / TSV / plain text / Markdown (.md). In Markdown, each ``` fenced block becomes one post. For Google Sheets/Docs, use File → Download first (copy & paste also works).",
  "件読み込みました": "lines loaded",
  "ファイルから投稿を検出できませんでした": "No posts detected in the file",
  "ファイルの読み込みに失敗しました": "Failed to read the file",
  "カテゴリー（任意）": "Category (optional)",
  "件検出": "detected",
  "インポート中...": "Importing...",
  "インポート実行": "Run Import",
  "件インポートしました": "posts imported",
  "有効な投稿内容がありません": "No valid post content",

  // ── History ─────────────────────────────────────────────────────────────
  "過去の投稿ログ（最新100件）": "Post log (latest 100)",
  "すべて": "All",
  "手動": "Manual",
  "スロット": "Slot",
  "「投稿済み」の履歴がありません": "No posted entries",
  "「エラー」の履歴がありません": "No error entries",

  // ── Analytics ───────────────────────────────────────────────────────────
  "インプレッション（表示回数）": "Views",
  "現在のフォロワー": "Followers",
  "今日の増減": "Today",
  "直近7日の増減": "Last 7 days",
  "直近30日の増減": "Last 30 days",
  "フォロワー推移": "Follower Trend",
  "総フォロワー数": "Total followers",
  "フォロワー数": "Followers",
  "前日比": "vs. previous day",
  "期間開始比": "vs. period start",
  "最新データを取得": "Refresh data",
  "最終更新": "Last updated",
  "Threadsから分析データを取得中…": "Fetching analytics from Threads…",
  "最新データを取得しました": "Analytics refreshed",
  "投稿データは更新しました": "Post analytics refreshed",
  "ランキング基準": "Rank by",
  "総エンゲージメント": "Total engagement",
  "インプレッション": "Views",
  "数値で見る": "View as a table",
  "日付": "Date",
  "件数": "Count",
  "まだ分析データがありません": "No analytics yet",
  "Threadsへ投稿した後、「最新データを取得」を押してください": "Post to Threads, then press Refresh data.",
  "フォロワー推移は、データ取得を開始した日から表示されます": "The follower trend starts from the day data collection began.",
  "「最新データを取得」を押すと記録が始まります": "Press Refresh data to start recording.",
  "Threads側でインサイトが利用可能になるまで時間がかかる場合があります": "Threads can take a while to make insights available.",
  "履歴が1件のため増減は計算できません。現在値のみ表示しています。":
    "Only one snapshot so far, so no change can be calculated — showing the current value only.",
  "期間開始前のデータが無いため、増減は参考値です。":
    "No snapshot from before this period, so the change is approximate.",
  "フォロワー指標が利用できません": "Follower metrics are unavailable",
  "トークンの期限が切れています": "The access token has expired",
  "Insights権限が不足しています": "Missing Insights permission",
  "API利用制限に達しました": "API rate limit reached",
  "一時的な通信障害が発生しました": "A temporary network problem occurred",
  "フォロワー数を取得できませんでした": "Could not fetch the follower count",
  "Threadsアカウントが接続されていません": "No Threads account is connected",

  "投稿パフォーマンスの確認": "Post performance overview",
  "日間": "Day",
  "週間": "Week",
  "月間": "Month",
  "投稿数": "Posts",
  "いいね": "Likes",
  "返信": "Replies",
  "リポスト": "Reposts",
  "エンゲージメント概要": "Engagement Overview",
  "トップ5ランキング": "Top 5 Ranking",
  "日間トップ5ランキング": "Daily Top 5",
  "週間トップ5ランキング": "Weekly Top 5",
  "月間トップ5ランキング": "Monthly Top 5",
  "この期間のデータがありません": "No data for this period",
  "エンゲージメント比較（横棒グラフ）": "Engagement comparison",
  "ランキング詳細": "Ranking details",

  // ── Calendar ────────────────────────────────────────────────────────────
  "投稿カレンダー": "Content Calendar",
  "ドラッグで日付変更・クリックで詳細編集": "Drag to reschedule, click to edit",
  "この月": "This month",
  "スケジュールを更新しました": "Schedule updated",
  "更新に失敗しました": "Update failed",
  "スケジュール詳細編集": "Edit Schedule",
  "投稿日": "Date",
  "投稿スロット（時間帯）": "Slot (time of day)",
  "保存中…": "Saving...",
  "保存": "Save",
  "ドラッグで日付変更　クリックでスロット変更": "Drag to change date, click to change slot",
  "件": "",
  "日曜": "Sun",

  // ── Report ──────────────────────────────────────────────────────────────
  "クライアント報告用のサマリー。印刷からPDF保存できます。": "Client-ready summary. Use print to save as PDF.",
  "最新化": "Refresh Data",
  "PDFとして保存": "Save as PDF",
  "最新の分析データを取得しました": "Analytics refreshed",
  "Threads運用レポート": "Threads Performance Report",
  "対象期間": "Period",
  "発行日": "Issued",
  "総ビュー": "Views",
  "エンゲージメント率": "Engagement Rate",
  "日別投稿数": "Posts per Day",
  "この月の投稿はありません": "No posts this month",
  "エンゲージメント上位投稿": "Top Posts by Engagement",
  "データがありません": "No data",
  "ビュー": "Views",
  "件の投稿エラーが発生しました。詳細は投稿履歴をご確認ください。": "post error(s) occurred this month. See History for details.",
  "※ この月に": "Note: ",

  // ── Settings ────────────────────────────────────────────────────────────
  "アカウント・運用ルール・ブランドの管理": "Accounts, operations rules, and branding",
  "AI利用可能": "AI is ready",
  "AI設定が必要です": "AI needs to be configured",
  "AIに接続中…": "Connecting to AI…",
  "AIサービスに接続できませんでした": "Could not reach the AI service",
  "AI利用上限に達しました": "AI usage limit reached",
  "AI設定を確認してください": "Check the AI configuration",
  "AI接続テスト": "Test AI connection",
  "原稿の生成とリライトに使います。APIキーはサーバー側にのみ保存され、画面には表示されません。":
    "Used for drafting and rewriting. The API key is stored server-side only and never shown here.",
  "Renderの環境変数に ANTHROPIC_API_KEY を設定してください。ANTHROPIC_MODEL でモデルを変更できます。":
    "Set ANTHROPIC_API_KEY in the Render environment. ANTHROPIC_MODEL selects the model.",
  "運用ルールとブランドはこのアカウントにのみ適用されます": "Operations rules and branding apply to this account only",
  "Threadsアカウント": "Threads Accounts",
  "複数アカウントを登録し、それぞれに投稿時刻を設定できます。": "Register multiple accounts, each with its own posting schedule.",
  "アカウントが未登録です。Meta開発者ポータルで取得した長期アクセストークンで追加してください。":
    "No accounts yet. Add one with a long-lived access token from the Meta developer portal.",
  "有効": "Active",
  "停止中": "Paused",
  "トークン登録済み": "Token saved",
  "失効予定": "expires",
  "— 7日ごとに自動更新されます": "— auto-refreshed every 7 days",
  "今すぐ更新": "Refresh now",
  "トークンを手動で差し替える": "Replace token manually",
  "新しいアクセストークン": "New access token",
  "検証中...": "Verifying...",
  "取消": "Cancel",
  "自動投稿スケジュール": "Posting Schedule",
  "枠ごとにタイムゾーンを指定できます。日本時間と現地時間を混ぜても構いません。":
    "Each slot has its own time zone, so you can mix local time and Japan time.",
  "投稿枠を追加": "Add a slot",
  "この枠を削除": "Remove this slot",
  "枠": "Slot ",
  "時": "Hour",
  "分": "Minute",
  "タイムゾーン": "Time zone",
  "削除": "Delete",
  "スケジュールを保存": "Save Schedule",
  "保存しました": "Saved",
  "を削除しますか？原稿と履歴は残ります。": "will be deleted. Drafts and history are kept. Continue?",
  "アカウントを削除しました": "Account deleted",
  "トークンをリフレッシュしました": "Token refreshed",
  "トークンを更新しました": "Token updated",
  "運用ルール": "Operations Rules",
  "チーム運用・クライアント納品時の安全設定。": "Safety settings for team and client operations.",
  "承認フロー": "Approval flow",
  "新規原稿を「下書き」として作成し、承認済みの原稿だけを自動投稿します。":
    "New drafts start unapproved; only approved drafts are auto-posted.",
  "失敗時の通知": "Failure notifications",
  "自動投稿の失敗やトークン失効の危険をオーナーへ通知します。":
    "Notify the owner about failed posts and token expiry risks.",
  "運用ルールを保存": "Save Rules",
  "設定を保存しました": "Settings saved",
  "ブランド設定": "Branding",
  "表示名とアクセントカラーを組織に合わせて変更できます。": "Customize the display name and accent color for your organization.",
  "ブランド名": "Brand name",
  "アクセントカラー": "Accent color",
  "サイドバー等の差し色に反映されます": "Applied to sidebar accents and highlights",
  "ブランド設定を保存": "Save Branding",
  "アカウントを追加": "Add Account",
  "表示名": "Display name",
  "例: 〇〇大学 公式": "e.g. Acme Official",
  "長期アクセストークン": "Long-lived access token",
  "保存時にトークンを検証し、Threads User IDを自動取得します。": "The token is verified on save and the Threads User ID is fetched automatically.",
  "検証・追加中...": "Verifying...",
  "アカウントを追加しました": "Account added",

  // ── Timezones ───────────────────────────────────────────────────────────
  "太平洋時間 (PT)": "Pacific (PT)",
  "東部時間 (ET)": "Eastern (ET)",
  "中部時間 (CT)": "Central (CT)",
  "山岳部時間 (MT)": "Mountain (MT)",
  "日本時間 (JST)": "Japan (JST)",
};

type I18nValue = {
  lang: Lang;
  locale: string;
  setLang: (l: Lang) => void;
  t: (ja: string) => string;
};

const I18nContext = createContext<I18nValue>({
  lang: "ja",
  locale: "ja-JP",
  setLang: () => {},
  t: (s) => s,
});

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    const saved = localStorage.getItem(LANG_KEY);
    return saved === "en" ? "en" : "ja";
  });

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = useCallback((l: Lang) => {
    localStorage.setItem(LANG_KEY, l);
    setLangState(l);
  }, []);

  const t = useCallback(
    (ja: string) => (lang === "en" ? (en[ja] ?? ja) : ja),
    [lang]
  );

  return (
    <I18nContext.Provider value={{ lang, locale: lang === "en" ? "en-US" : "ja-JP", setLang, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  return useContext(I18nContext);
}

/** タイムゾーンの表示ラベル（言語対応は呼び出し側で t() を通す） */
export const TZ_OPTIONS: { value: "LA" | "JP" | "ET" | "CT" | "MT"; labelJa: string }[] = [
  { value: "LA", labelJa: "太平洋時間 (PT)" },
  { value: "MT", labelJa: "山岳部時間 (MT)" },
  { value: "CT", labelJa: "中部時間 (CT)" },
  { value: "ET", labelJa: "東部時間 (ET)" },
  { value: "JP", labelJa: "日本時間 (JST)" },
];
