/** AIリライトのプリセット。サーバー側 REWRITE_PRESETS と対になる */
export const REWRITE_PRESET_LABELS: { value: string; label: string }[] = [
  { value: "shorter", label: "短くする" },
  { value: "clearer", label: "読みやすくする" },
  { value: "natural", label: "より自然にする" },
  { value: "casual", label: "カジュアル" },
  { value: "formal", label: "フォーマル" },
  { value: "stronger_hook", label: "冒頭を強くする" },
  { value: "better_cta", label: "CTAを改善する" },
  { value: "add_emoji", label: "関連する絵文字を追加" },
  { value: "fewer_emoji", label: "絵文字を減らす" },
];
