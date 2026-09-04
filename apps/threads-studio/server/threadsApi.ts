/**
 * Threads API service — 2-step publish flow
 * Step 1: POST /{userId}/threads  → create media container
 * Step 2: POST /{userId}/threads_publish → publish container
 */

const THREADS_API_BASE = "https://graph.threads.net/v1.0";


/**
 * 画像コンテナが公開可能になるまで待つ。
 * ERROR が返ったら理由を添えて失敗させ、時間切れなら待たずに公開を試みる
 * （多くの場合そのまま成功し、駄目なら公開APIのエラーがそのまま上がる）。
 */
async function waitForContainer(
  containerId: string,
  accessToken: string,
  { attempts = 10, intervalMs = 3000 } = {}
): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(
        `${THREADS_API_BASE}/${containerId}?fields=status,error_message&access_token=${encodeURIComponent(accessToken)}`
      );
      if (res.ok) {
        const data = (await res.json()) as { status?: string; error_message?: string };
        if (data.status === "FINISHED") return;
        if (data.status === "ERROR" || data.status === "EXPIRED") {
          throw new Error(
            `Threads media processing failed (${data.status}): ${data.error_message ?? "unknown"}`
          );
        }
      }
    } catch (e) {
      // ステータス確認自体の失敗（ネットワーク等）では止めない
      if (e instanceof Error && e.message.startsWith("Threads media processing failed")) throw e;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

export interface ThreadsPostResult {
  containerId: string;
  postId: string;
}

/**
 * コンテナ作成 → 公開の2段階フロー。通常投稿・返信の両方が使う共通処理。
 * `params` は `media_type` と `text` に加え、画像なら `image_url`、返信なら
 * `reply_to_id` を含める。
 */
async function createAndPublish(
  accessToken: string,
  userId: string,
  params: Record<string, string>,
  { isImage = false }: { isImage?: boolean } = {}
): Promise<ThreadsPostResult> {
  // Step 1: Create media container
  const createParams = new URLSearchParams({ ...params, access_token: accessToken });

  const createRes = await fetch(`${THREADS_API_BASE}/${userId}/threads`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: createParams.toString(),
  });

  if (!createRes.ok) {
    const err = await createRes.text();
    throw new Error(`Threads container creation failed (${createRes.status}): ${err}`);
  }

  const createData = (await createRes.json()) as { id: string };
  const containerId = createData.id;

  // Brief pause recommended by Meta docs before publishing.
  // 画像付きはメディアの取得・処理に時間がかかるため、状態がFINISHEDになるまで待つ。
  await new Promise((r) => setTimeout(r, 2000));
  if (isImage) await waitForContainer(containerId, accessToken);

  // Step 2: Publish the container
  const publishParams = new URLSearchParams({
    creation_id: containerId,
    access_token: accessToken,
  });

  const publishRes = await fetch(`${THREADS_API_BASE}/${userId}/threads_publish`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: publishParams.toString(),
  });

  if (!publishRes.ok) {
    const err = await publishRes.text();
    throw new Error(`Threads publish failed (${publishRes.status}): ${err}`);
  }

  const publishData = (await publishRes.json()) as { id: string };

  return { containerId, postId: publishData.id };
}

/**
 * 投稿を作成して公開する。
 * `imageUrl` を渡すと画像付き投稿になる。Threads は画像バイナリを直接受け取らず
 * 「公開URLから取得」する仕様なので、必ず外部から到達できる絶対URLを渡すこと。
 */
export async function publishTextPost(
  accessToken: string,
  userId: string,
  text: string,
  imageUrl?: string | null
): Promise<ThreadsPostResult> {
  return createAndPublish(
    accessToken, userId,
    imageUrl ? { media_type: "IMAGE", image_url: imageUrl, text } : { media_type: "TEXT", text },
    { isImage: !!imageUrl }
  );
}

/**
 * 自社投稿への返信を送信する。通常投稿と同じ2段階フローに `reply_to_id` を足すだけ。
 * 必要権限: threads_manage_replies。呼び出しは利用者が送信ボタンを押した時だけ行い、
 * 自動では送信しない。
 */
export async function publishReply(
  accessToken: string,
  userId: string,
  text: string,
  replyToId: string
): Promise<ThreadsPostResult> {
  return createAndPublish(accessToken, userId, { media_type: "TEXT", text, reply_to_id: replyToId });
}

/** Verify token and return Threads user ID + username */
export async function getThreadsProfile(
  accessToken: string
): Promise<{ id: string; username?: string }> {
  const res = await fetch(
    `${THREADS_API_BASE}/me?fields=id,username&access_token=${encodeURIComponent(accessToken)}`
  );
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Threads token verification failed (${res.status}): ${err}`);
  }
  return (await res.json()) as { id: string; username?: string };
}

/** Verify token and return Threads user ID */
export async function getThreadsUserId(accessToken: string): Promise<string> {
  return (await getThreadsProfile(accessToken)).id;
}

/**
 * Refresh a long-lived Threads access token.
 * Long-lived tokens expire after 60 days and can be refreshed once they are
 * at least 24 hours old. Returns the new token and its lifetime in seconds.
 */
export async function refreshLongLivedToken(
  accessToken: string
): Promise<{ accessToken: string; expiresIn: number }> {
  const res = await fetch(
    `https://graph.threads.net/refresh_access_token?grant_type=th_refresh_token&access_token=${encodeURIComponent(accessToken)}`
  );
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Threads token refresh failed (${res.status}): ${err}`);
  }
  const data = (await res.json()) as { access_token: string; expires_in: number };
  return { accessToken: data.access_token, expiresIn: data.expires_in };
}

export interface PostInsights {
  likes: number;
  replies: number;
  reposts: number;
  views: number;
}

/** Fetch engagement metrics for a published Threads post (Insights API) */
/**
 * Threads Insights のレスポンスから1メトリクスの値を取り出す。
 *
 * メトリクスによって値の入り方が2通りある:
 * - `values[0].value` … 期間指定つきの時系列（views など日次のもの）
 * - `total_value.value` … 生涯合計（followers_count など）
 * どちらで返ってきても拾えるようにする。純粋関数なのでテスト対象。
 */
export function readInsightMetric(
  payload: {
    data?: { name: string; values?: { value?: number }[]; total_value?: { value?: number } }[];
  },
  name: string
): number | null {
  const item = payload.data?.find((d) => d.name === name);
  if (!item) return null;
  const value = item.values?.[0]?.value ?? item.total_value?.value;
  return typeof value === "number" ? value : null;
}

/**
 * アカウントの現在のフォロワー数。
 *
 * `followers_count` は総数のみを返す（増減はこちらで日次スナップショットの
 * 差分から求める）。Threadsアカウントが Instagram と連携していない場合は
 * このメトリクス自体が返らないため、その場合は null を返して呼び出し側で
 * 「利用できない」と扱えるようにする。
 * 必要権限: threads_manage_insights
 */
export async function fetchFollowerCount(
  accessToken: string,
  userId: string
): Promise<number | null> {
  const res = await fetch(
    `${THREADS_API_BASE}/${userId}/threads_insights?metric=followers_count&access_token=${encodeURIComponent(accessToken)}`
  );
  if (!res.ok) {
    throw new Error(`Threads follower count fetch failed (${res.status}): ${await res.text()}`);
  }
  const count = readInsightMetric(await res.json(), "followers_count");
  // 負数は保存しない（APIが想定外の値を返した場合の保険）
  return count === null || count < 0 ? null : count;
}

export async function fetchPostInsights(
  accessToken: string,
  mediaId: string
): Promise<PostInsights> {
  const res = await fetch(
    `${THREADS_API_BASE}/${mediaId}/insights?metric=views,likes,replies,reposts&access_token=${encodeURIComponent(accessToken)}`
  );
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Threads insights fetch failed (${res.status}): ${err}`);
  }
  const data = await res.json();
  const metric = (name: string): number => readInsightMetric(data, name) ?? 0;
  return {
    likes: metric("likes"),
    replies: metric("replies"),
    reposts: metric("reposts"),
    views: metric("views"),
  };
}

// ── キーワード検索 ───────────────────────────────────────────────────────────

export type ThreadsSearchResult = {
  id: string;
  text: string | null;
  mediaType: string | null;
  permalink: string | null;
  timestamp: Date | null;
  username: string | null;
  hasReplies: boolean | null;
  isQuotePost: boolean | null;
  isReply: boolean | null;
};

/** 検索結果の1件を正規化する。純粋関数なのでテスト対象 */
export function normalizeSearchItem(raw: Record<string, unknown>): ThreadsSearchResult | null {
  const id = typeof raw.id === "string" ? raw.id : null;
  if (!id) return null;
  const ts = typeof raw.timestamp === "string" ? new Date(raw.timestamp) : null;
  return {
    id,
    text: typeof raw.text === "string" ? raw.text : null,
    mediaType: typeof raw.media_type === "string" ? raw.media_type : null,
    permalink: typeof raw.permalink === "string" ? raw.permalink : null,
    timestamp: ts && !Number.isNaN(ts.getTime()) ? ts : null,
    username: typeof raw.username === "string" ? raw.username : null,
    hasReplies: typeof raw.has_replies === "boolean" ? raw.has_replies : null,
    isQuotePost: typeof raw.is_quote_post === "boolean" ? raw.is_quote_post : null,
    isReply: typeof raw.is_reply === "boolean" ? raw.is_reply : null,
  };
}

/**
 * 公開投稿のキーワード検索。
 *
 * 返るのは本文・投稿日時・返信の有無まで。**いいね数などの反応数は返らない**
 * （Threads Insights は自分の投稿にしか使えない）。
 * 必要権限: threads_keyword_search
 * レート制限: ユーザーあたり 2,200 クエリ / 24時間（空結果は非カウント）
 */
export async function searchThreadsKeyword(
  accessToken: string,
  query: string,
  searchType: "TOP" | "RECENT",
  limit = 25
): Promise<ThreadsSearchResult[]> {
  const url = new URL(`${THREADS_API_BASE}/keyword_search`);
  url.searchParams.set("q", query);
  url.searchParams.set("search_type", searchType);
  url.searchParams.set(
    "fields",
    "id,text,media_type,permalink,timestamp,username,has_replies,is_quote_post,is_reply"
  );
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("access_token", accessToken);
  const res = await fetch(url.toString());
  if (!res.ok) {
    // 本文は分類に使うだけなので先頭だけ持つ（ログや画面にはこのメッセージを出さない）
    const body = (await res.text()).slice(0, 300);
    throw new Error(`Threads keyword search failed (${res.status}): ${body}`);
  }
  const data = (await res.json()) as { data?: Record<string, unknown>[] };
  return (data.data ?? [])
    .map(normalizeSearchItem)
    .filter((x): x is ThreadsSearchResult => x !== null);
}

/**
 * 保存済みトレンド投稿がまだ存在するかの確認（ベストエフォート）。
 * 存在しない・権限が無い場合は false。ネットワーク障害などは判断保留で null。
 */
export async function checkThreadsPostExists(
  accessToken: string,
  mediaId: string
): Promise<boolean | null> {
  try {
    const res = await fetch(
      `${THREADS_API_BASE}/${mediaId}?fields=id&access_token=${encodeURIComponent(accessToken)}`
    );
    if (res.ok) return true;
    const body = await res.text();
    // 「存在しない／権限が無い」はどちらも削除扱いに寄せる（画面で判別できればよい）
    if (res.status === 400 || res.status === 404) {
      return /does not exist|not exist|invalid|unsupported/i.test(body) ? false : null;
    }
    return null;
  } catch {
    return null;
  }
}

// ── 受信箱（返信管理） ───────────────────────────────────────────────────────

export type ThreadsReply = {
  id: string;
  text: string | null;
  username: string | null;
  permalink: string | null;
  timestamp: Date | null;
  /** 返信対象（自社投稿）のThreadsメディアID。取れない場合は null */
  rootMediaId: string | null;
  hideStatus: string | null;
};

/** 返信1件の正規化。純粋関数なのでテスト対象 */
export function normalizeReply(raw: Record<string, unknown>): ThreadsReply | null {
  const id = typeof raw.id === "string" ? raw.id : null;
  if (!id) return null;
  const ts = typeof raw.timestamp === "string" ? new Date(raw.timestamp) : null;
  const root = raw.root_post as Record<string, unknown> | undefined;
  return {
    id,
    text: typeof raw.text === "string" ? raw.text : null,
    username: typeof raw.username === "string" ? raw.username : null,
    permalink: typeof raw.permalink === "string" ? raw.permalink : null,
    timestamp: ts && !Number.isNaN(ts.getTime()) ? ts : null,
    rootMediaId: root && typeof root.id === "string" ? root.id : null,
    hideStatus: typeof raw.hide_status === "string" ? raw.hide_status : null,
  };
}

/**
 * 自社投稿についた公開返信の一覧（DMは含まれない・公式APIが無いため取得しない）。
 * 必要権限: threads_read_replies
 */
export async function fetchAccountReplies(
  accessToken: string,
  userId: string,
  limit = 50
): Promise<ThreadsReply[]> {
  const url = new URL(`${THREADS_API_BASE}/${userId}/replies`);
  url.searchParams.set("fields", "id,text,username,permalink,timestamp,root_post,hide_status,is_reply");
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("access_token", accessToken);
  const res = await fetch(url.toString());
  if (!res.ok) {
    // 本文は分類に使うだけなので先頭だけ持つ（ログや画面にはこのメッセージを出さない）
    const body = (await res.text()).slice(0, 300);
    throw new Error(`Threads replies fetch failed (${res.status}): ${body}`);
  }
  const data = (await res.json()) as { data?: Record<string, unknown>[] };
  return (data.data ?? []).map(normalizeReply).filter((x): x is ThreadsReply => x !== null);
}
