/**
 * Posting engine.
 *
 * A single cron ("tick") runs every 15 minutes and, for each active account:
 *   - checks whether the account-local time has passed a slot's configured
 *     time and that slot has not fired today → publishes the next eligible
 *     post (approved, scheduledDate <= today).
 * The "already fired today" check is log-based, so missed ticks self-heal
 * (a late server posts late rather than never) and never double-post.
 *
 * Daily maintenance (piggy-backed on the first tick of each UTC day):
 *   - refreshes long-lived tokens older than 7 days (60-day expiry)
 *   - pulls Threads Insights for the last 30 days of posts
 */
import {
  createPostLog,
  getEvergreenCandidate,
  getNextPendingPost,
  getSettings,
  hasSlotLogInRange,
  listActiveAccounts,
  listLogsForAnalytics,
  markPostRecycled,
  updateAccount,
  updatePost,
  upsertAnalytics,
  upsertSettings,
} from "./db";
import { Account } from "../drizzle/schema";
import { fetchPostInsights, publishTextPost, refreshLongLivedToken } from "./threadsApi";
import { ENV } from "./_core/env";
import { invokeLLM } from "./_core/llm";
import { notifyOwner } from "./_core/notification";

// ── Timezone helpers (pure, unit-tested) ─────────────────────────────────────

export type Tz = "LA" | "JP" | "ET" | "CT" | "MT";

export const TZ_NAMES: Record<Tz, string> = {
  LA: "America/Los_Angeles",
  JP: "Asia/Tokyo",
  ET: "America/New_York",
  CT: "America/Chicago",
  MT: "America/Denver",
};

export type LocalParts = { dateStr: string; hour: number; minute: number };

/** アカウントのタイムゾーンでの現在日付・時刻 */
export function getLocalParts(now: Date, tz: Tz): LocalParts {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ_NAMES[tz],
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));
  return {
    dateStr: `${parts.year}-${parts.month}-${parts.day}`,
    // Intl may return "24" for midnight in some engines
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
  };
}

/** ローカル日付 dateStr の 0:00〜24:00 に対応する UTC 範囲 */
export function localDayUtcRange(dateStr: string, tz: Tz): { start: Date; end: Date } {
  // Determine the UTC offset in effect on that local date by probing noon UTC
  // (safe from DST transitions which happen in the early morning).
  const probe = new Date(`${dateStr}T12:00:00Z`);
  const local = getLocalParts(probe, tz);
  // offsetMinutes = local time - UTC time at the probe instant
  const probeMinutes = 12 * 60;
  let localMinutes = local.hour * 60 + local.minute;
  // local date may differ from probe date (JP is ahead)
  if (local.dateStr > dateStr) localMinutes += 24 * 60;
  else if (local.dateStr < dateStr) localMinutes -= 24 * 60;
  const offsetMinutes = localMinutes - probeMinutes;
  const startUtcMs = Date.parse(`${dateStr}T00:00:00Z`) - offsetMinutes * 60 * 1000;
  return { start: new Date(startUtcMs), end: new Date(startUtcMs + 24 * 60 * 60 * 1000) };
}

/** スロットの発火判定: ローカル時刻が設定時刻を過ぎているか */
export function slotIsDue(local: LocalParts, slotHour: number, slotMinute: number): boolean {
  return local.hour * 60 + local.minute >= slotHour * 60 + slotMinute;
}

/** トークンをリフレッシュすべきか: 前回リフレッシュ（または作成）から7日以上 */
export function tokenNeedsRefresh(account: Pick<Account, "tokenRefreshedAt" | "createdAt">, now: Date): boolean {
  const last = account.tokenRefreshedAt ?? account.createdAt;
  if (!last) return true;
  return now.getTime() - last.getTime() > 7 * 24 * 60 * 60 * 1000;
}

// ── Posting ──────────────────────────────────────────────────────────────────

async function maybeNotifyError(title: string, content: string) {
  try {
    const cfg = await getSettings();
    if (cfg && cfg.notifyOnError === false) return;
    await notifyOwner({ title, content });
  } catch (e) {
    console.warn("[scheduler] notification failed:", e);
  }
}

/**
 * 再投稿コンテンツを配信する際に、内容は変えずに言い回しと絵文字だけを変える。
 * AI未設定・失敗・不正な出力のときは原文をそのまま返す（投稿は必ず行われる）。
 */
export async function rewordForRecycle(content: string): Promise<string> {
  const system = [
    "あなたは公式SNSアカウントの編集者です。過去に投稿した文章を、もう一度出しても新鮮に読めるように書き直します。",
    "厳守事項:",
    "- 伝える情報・事実・数字・固有名詞・URLは一切変えない（追加も削除もしない）",
    "- 変えてよいのは言い回し、語順、文の区切り、絵文字だけ",
    "- 元の投稿と同じ言語で書く",
    "- 500文字以内。絵文字は0〜2個",
    "- 出力は書き直した本文のみ（前置き・説明・引用符は不要）",
    "/ You are an editor for an official social account. Rewrite a past post so it reads fresh, changing only wording and emoji — never the facts, numbers, names, or URLs. Keep the original language, stay under 500 characters, and output only the rewritten text.",
  ].join("\n");

  try {
    const result = await invokeLLM({
      messages: [
        { role: "system", content: system },
        { role: "user", content },
      ],
      maxTokens: 1200,
    });
    const text = (result.choices[0]?.message?.content ?? "").trim();
    if (!text || text.length > 500) return content;
    return text;
  } catch (e) {
    console.warn(
      "[scheduler] recycle reword skipped:",
      e instanceof Error ? e.message : String(e)
    );
    return content;
  }
}

/**
 * 添付画像URLをThreadsが取得できる絶対URLにする。
 * 内部アップロード（/api/media/...）は APP_URL が無いと外部から取得できないため、
 * 未設定なら分かりやすいエラーにする（黙って画像なしで投稿しない）。
 */
export function resolveImageUrl(imageUrl: string | null | undefined): string | null {
  if (!imageUrl) return null;
  if (/^https?:\/\//i.test(imageUrl)) return imageUrl;
  const base = ENV.appUrl.replace(/\/$/, "");
  if (!base) {
    throw new Error(
      "APP_URL が未設定のため画像付き投稿ができません。Renderの環境変数にAPP_URLを設定してください。"
    );
  }
  return `${base}${imageUrl.startsWith("/") ? "" : "/"}${imageUrl}`;
}

/** 1アカウント・1スロット分の投稿を試みる。発火しなかった場合は null */
export async function runSlotForAccount(
  account: Account,
  slotIndex: number,
  now: Date
): Promise<{ posted?: string; error?: string; recycled?: boolean } | null> {
  const local = getLocalParts(now, account.timezone);
  const slotHour = slotIndex === 0 ? account.morningHour : account.eveningHour;
  const slotMinute = slotIndex === 0 ? account.morningMinute : account.eveningMinute;

  if (!slotIsDue(local, slotHour, slotMinute)) return null;

  const { start, end } = localDayUtcRange(local.dateStr, account.timezone);
  if (await hasSlotLogInRange(account.id, slotIndex, start, end)) return null;

  let post = await getNextPendingPost(slotIndex, local.dateStr, account.id);
  let recycled = false;
  let content: string;

  if (post) {
    content = post.content;
  } else {
    // 予約原稿が尽きたスロットを、再投稿コンテンツで埋める（設定で有効化した場合のみ）
    const cfg = await getSettings();
    if (!cfg?.autoFillEvergreen) return null;
    const candidate = await getEvergreenCandidate(
      account.id,
      cfg.recycleCooldownDays ?? 30,
      now
    );
    if (!candidate) return null;
    post = candidate;
    recycled = true;
    content = cfg.recycleRewrite ? await rewordForRecycle(candidate.content) : candidate.content;
  }

  try {
    const imageUrl = resolveImageUrl(post.imageUrl);
    const result = await publishTextPost(
      account.threadsAccessToken, account.threadsUserId, content, imageUrl
    );
    // 再投稿でも status を posted にしておく（未投稿のまま残ると通常枠で二重投稿になるため）
    await updatePost(post.id, { status: "posted" });
    if (recycled) await markPostRecycled(post.id, now);
    await createPostLog({
      postId: post.id, accountId: account.id, content,
      status: "posted", threadsPostId: result.postId, slotIndex, categoryId: post.categoryId,
      recycled, imageUrl: post.imageUrl,
    });
    return { posted: result.postId, ...(recycled ? { recycled: true } : {}) };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // 再投稿の失敗では元の原稿を error にしない（原稿自体は健全なので再投稿プールに残す）
    if (!recycled) await updatePost(post.id, { status: "error" });
    await createPostLog({
      postId: post.id, accountId: account.id, content,
      status: "error", errorMessage: msg, slotIndex, categoryId: post.categoryId,
      recycled, imageUrl: post.imageUrl,
    });
    await maybeNotifyError(
      `【${account.name}】Threads自動投稿に失敗しました`,
      `スロット: ${slotIndex === 0 ? "朝" : "夕"}\n原稿ID: ${post.id}\nエラー: ${msg}\n\n投稿履歴ページからご確認ください。`
    );
    return { error: msg };
  }
}

// ── Daily maintenance ────────────────────────────────────────────────────────

export async function refreshTokensIfNeeded(now: Date) {
  const accounts = await listActiveAccounts();
  for (const account of accounts) {
    if (!tokenNeedsRefresh(account, now)) continue;
    try {
      const { accessToken, expiresIn } = await refreshLongLivedToken(account.threadsAccessToken);
      await updateAccount(account.id, {
        threadsAccessToken: accessToken,
        tokenRefreshedAt: now,
        tokenExpiresAt: new Date(now.getTime() + expiresIn * 1000),
      });
      console.log(`[scheduler] token refreshed for account ${account.id}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[scheduler] token refresh failed for account ${account.id}:`, msg);
      // 失効が近い場合のみ通知（毎日鳴らさない）
      const expiresSoon = account.tokenExpiresAt &&
        account.tokenExpiresAt.getTime() - now.getTime() < 7 * 24 * 60 * 60 * 1000;
      if (expiresSoon) {
        await maybeNotifyError(
          `【${account.name}】Threadsトークンの自動更新に失敗しています`,
          `トークンの失効が近づいています。設定ページから新しいトークンを登録してください。\nエラー: ${msg}`
        );
      }
    }
  }
}

export async function fetchAnalyticsForRecentPosts() {
  const accounts = await listActiveAccounts();
  if (accounts.length === 0) return;
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const fallback = accounts[0];
  const logs = await listLogsForAnalytics(30);
  for (const log of logs) {
    const account = (log.accountId ? byId.get(log.accountId) : undefined) ?? fallback;
    if (!log.threadsPostId) continue;
    try {
      const m = await fetchPostInsights(account.threadsAccessToken, log.threadsPostId);
      await upsertAnalytics({
        postLogId: log.id, threadsPostId: log.threadsPostId,
        likes: m.likes, replies: m.replies, reposts: m.reposts, views: m.views,
      });
    } catch (e) {
      console.warn(`[scheduler] insights fetch failed for log ${log.id}:`, e instanceof Error ? e.message : e);
    }
  }
}

async function runDailyMaintenance(now: Date) {
  const today = now.toISOString().slice(0, 10);
  const cfg = await getSettings();
  if (cfg?.lastMaintenanceDate === today) return;
  await upsertSettings({ lastMaintenanceDate: today });
  await refreshTokensIfNeeded(now);
  await fetchAnalyticsForRecentPosts();
}

// ── Entry point ──────────────────────────────────────────────────────────────

export async function runTick(now: Date = new Date()) {
  const results: Record<string, unknown>[] = [];
  const accounts = await listActiveAccounts();
  for (const account of accounts) {
    for (const slotIndex of [0, 1]) {
      const r = await runSlotForAccount(account, slotIndex, now);
      if (r) results.push({ account: account.id, slotIndex, ...r });
    }
  }
  await runDailyMaintenance(now);
  return { fired: results };
}
