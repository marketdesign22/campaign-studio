/**
 * Instagram Graph API の呼び出し（ここだけが Meta に触れる）。
 *
 * 【要確認】このファイルのエンドポイント名・パラメータ名・状態の値は、
 * Meta 公式ドキュメント（Instagram Platform › Content Publishing）で
 * 確認してから本番で使うこと。確認できるまでは、
 *   - テストでは必ず FakeGraph（publisher.test.ts）を使う
 *   - 本番でも INSTAGRAM_PUBLISH_ENABLED を "true" にしない
 * 確認が要る点は docs/instagram-publish.md の「要確認」に一覧にしてある。
 *
 * 守ること
 *   - アクセストークンはURLに載せない（POST は本文、GET はヘッダー【要確認】）
 *   - 例外の文に URL・トークン・素材URLを含めない
 */

/** コンテナの処理状態。知らない値は UNKNOWN（勝手に成功・失敗にしない）。 */
export type ContainerStatus =
  | "FINISHED"
  | "IN_PROGRESS"
  | "ERROR"
  | "EXPIRED"
  | "PUBLISHED"
  | "UNKNOWN";

export interface InstagramGraph {
  /** 画像1枚のコンテナ（カルーセルの子なら isCarouselItem）を作る。 */
  createImageContainer(input: {
    igUserId: string;
    imageUrl: string;
    caption?: string;
    isCarouselItem?: boolean;
  }): Promise<string>;
  /** カルーセルの親コンテナを作る。 */
  createCarouselContainer(input: {
    igUserId: string;
    children: string[];
    caption: string;
  }): Promise<string>;
  /** コンテナの処理状態を聞く。 */
  containerStatus(containerId: string): Promise<ContainerStatus>;
  /** コンテナを公開する。公開された投稿のIDを返す。 */
  publish(input: { igUserId: string; creationId: string }): Promise<string>;
  /** 投稿のパーマリンク。取れなくても公開は成功なので null を返す。 */
  permalink(mediaId: string): Promise<string | null>;
}

/**
 * Graph API の失敗。message は利用者に見せてよい短い文だけを持つ
 * （URL・トークン・応答本文の全文は入れない）。
 */
export class GraphError extends Error {
  constructor(
    message: string,
    /** 時間をおけば通るかもしれない（通信失敗・5xx・429・一時的なエラー） */
    readonly retryable: boolean,
    readonly httpStatus: number | null = null
  ) {
    super(message);
    this.name = "GraphError";
  }
}

const KNOWN_STATUS = new Set<ContainerStatus>([
  "FINISHED",
  "IN_PROGRESS",
  "ERROR",
  "EXPIRED",
  "PUBLISHED",
]);

type FetchLike = typeof fetch;

/**
 * 本物の Graph API を呼ぶ実装。
 * 【要確認】パス・パラメータ・認証ヘッダーの形。
 */
export function createHttpGraph(options: {
  baseUrl: string;
  accessToken: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}): InstagramGraph {
  const doFetch = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 10_000;

  async function call(
    method: "GET" | "POST",
    path: string,
    params: Record<string, string>
  ): Promise<Record<string, unknown>> {
    let response: Response;
    try {
      if (method === "POST") {
        const form = new URLSearchParams({
          ...params,
          access_token: options.accessToken,
        });
        response = await doFetch(`${options.baseUrl}${path}`, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: form.toString(),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } else {
        const query = new URLSearchParams(params).toString();
        response = await doFetch(
          `${options.baseUrl}${path}${query ? `?${query}` : ""}`,
          {
            method: "GET",
            headers: { authorization: `Bearer ${options.accessToken}` },
            signal: AbortSignal.timeout(timeoutMs),
          }
        );
      }
    } catch {
      throw new GraphError("Graph API に接続できませんでした", true);
    }
    const body = (await response.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    if (!response.ok) {
      const error = (body.error ?? {}) as Record<string, unknown>;
      const transient =
        error.is_transient === true ||
        response.status >= 500 ||
        response.status === 429;
      const code = typeof error.code === "number" ? ` code=${error.code}` : "";
      const sub =
        typeof error.error_subcode === "number"
          ? ` subcode=${error.error_subcode}`
          : "";
      // Meta のエラー文には入力値が含まれることがあるので、そのままは載せない
      throw new GraphError(
        `Graph API がエラーを返しました（HTTP ${response.status}${code}${sub}）`,
        transient,
        response.status
      );
    }
    return body;
  }

  const idOf = (body: Record<string, unknown>, what: string): string => {
    if (typeof body.id === "string" && body.id) return body.id;
    throw new GraphError(`${what}の応答に id がありません`, false);
  };

  return {
    async createImageContainer({
      igUserId,
      imageUrl,
      caption,
      isCarouselItem,
    }) {
      const params: Record<string, string> = { image_url: imageUrl };
      if (isCarouselItem) params.is_carousel_item = "true";
      else if (caption) params.caption = caption;
      return idOf(
        await call("POST", `/${encodeURIComponent(igUserId)}/media`, params),
        "コンテナ作成"
      );
    },
    async createCarouselContainer({ igUserId, children, caption }) {
      return idOf(
        await call("POST", `/${encodeURIComponent(igUserId)}/media`, {
          media_type: "CAROUSEL",
          children: children.join(","),
          caption,
        }),
        "カルーセル作成"
      );
    },
    async containerStatus(containerId) {
      const body = await call("GET", `/${encodeURIComponent(containerId)}`, {
        fields: "status_code",
      });
      const value =
        typeof body.status_code === "string" ? body.status_code : "";
      return KNOWN_STATUS.has(value as ContainerStatus)
        ? (value as ContainerStatus)
        : "UNKNOWN";
    },
    async publish({ igUserId, creationId }) {
      return idOf(
        await call("POST", `/${encodeURIComponent(igUserId)}/media_publish`, {
          creation_id: creationId,
        }),
        "公開"
      );
    },
    async permalink(mediaId) {
      try {
        const body = await call("GET", `/${encodeURIComponent(mediaId)}`, {
          fields: "permalink",
        });
        return typeof body.permalink === "string" ? body.permalink : null;
      } catch {
        return null;
      }
    },
  };
}
