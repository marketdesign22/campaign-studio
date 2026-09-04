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
  // Step 1: Create media container
  const createParams = new URLSearchParams(
    imageUrl
      ? { media_type: "IMAGE", image_url: imageUrl, text, access_token: accessToken }
      : { media_type: "TEXT", text, access_token: accessToken }
  );

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
  if (imageUrl) await waitForContainer(containerId, accessToken);

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
