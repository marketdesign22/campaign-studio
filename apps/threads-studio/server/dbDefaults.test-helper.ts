/**
 * テスト用: db.ts をモックしたままでも既定値を参照できるようにする。
 * 本体の DEFAULT_TREND_SETTINGS と同じ形（値が変わったら合わせる）。
 */
export const DEFAULT_TREND_SETTINGS = {
  keywords: [] as string[],
  excludeKeywords: [] as string[],
  refAccounts: [] as string[],
  language: "ja",
  region: "JP",
  industry: null as string | null,
  fetchTimes: [{ hour: 9, minute: 0 }, { hour: 18, minute: 0 }],
  autoFetch: true,
  retentionDays: 30,
  aiDailyLimit: 20,
  lastFetchKey: null as string | null,
  lastFetchAt: null as Date | null,
  lastFetchError: null as string | null,
};
