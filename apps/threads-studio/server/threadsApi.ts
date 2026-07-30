/**
 * Threads API service — 2-step publish flow
 * Step 1: POST /{userId}/threads  → create media container
 * Step 2: POST /{userId}/threads_publish → publish container
 */

const THREADS_API_BASE = "https://graph.threads.net/v1.0";

export interface ThreadsPostResult {
  containerId: string;
  postId: string;
}

export async function publishTextPost(
  accessToken: string,
  userId: string,
  text: string
): Promise<ThreadsPostResult> {
  // Step 1: Create media container
  const createParams = new URLSearchParams({
    media_type: "TEXT",
    text,
    access_token: accessToken,
  });

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

  // Brief pause recommended by Meta docs before publishing
  await new Promise((r) => setTimeout(r, 2000));

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
  const data = (await res.json()) as {
    data?: {
      name: string;
      values?: { value?: number }[];
      total_value?: { value?: number };
    }[];
  };
  const metric = (name: string): number => {
    const item = data.data?.find((d) => d.name === name);
    return item?.values?.[0]?.value ?? item?.total_value?.value ?? 0;
  };
  return {
    likes: metric("likes"),
    replies: metric("replies"),
    reposts: metric("reposts"),
    views: metric("views"),
  };
}
