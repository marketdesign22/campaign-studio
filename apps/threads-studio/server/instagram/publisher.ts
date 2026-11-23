/**
 * Instagram 公開の流れ（大漁マーケットOS → Threads Studio → Meta）。
 *
 *   1. OS が予約時刻に「公開して」と送る（action: publish）
 *      → 依頼を記録し、できればコンテナ作成まで進めて accepted を返す。
 *        ここでは公開しない（Instagram は処理待ちに数分かかるため）。
 *   2. OS が5分ごとに「どうなった？」と聞く（action: status）
 *      → 聞かれた依頼をそれぞれ一歩ずつ進め（処理待ち → 公開）、結果を返す。
 *
 * 背景のタイマーは使わない。進めるのは OS からの呼び出しだけ。
 * Render が眠っていても、起きた次の問い合わせで続きから進む。
 *
 * 守ること
 *   - 同じ予約（scheduled_post_id）で二度公開しない
 *       ・依頼は scheduled_post_id で一意。再送は前回の結果を返す
 *       ・公開の直前に processing → publishing へ条件つきで移す（取り合いに負けたら何もしない）
 *       ・公開中に落ちたら、コンテナの状態が PUBLISHED のときだけ公開済みとして確定する。
 *         確かめられなければ自動でやり直さない（OS 側で「要確認」になり、人が判断する）
 *   - 公開したか分からないものを failed にしない（OS 側で「要確認」に回る）
 *   - 素材の署名URLはコンテナを作り終えたら消す。ログ・応答に出さない
 *   - dry-run では Graph API を一切呼ばず、何も保存しない
 */
import { createHash } from "crypto";

import { GraphError, type InstagramGraph } from "./graph";
import { missingLiveSettings, type InstagramConfig } from "./config";

export type PublicationState =
  | "queued"
  | "processing"
  | "publishing"
  | "published"
  | "failed";

export type PublicationRow = {
  scheduledPostId: string;
  externalClientId: string;
  igUserId: string;
  state: PublicationState;
  caption: string;
  /** 素材の署名URL（スライド順）。コンテナを作り終えたら null にする */
  mediaUrls: string[] | null;
  childContainerIds: string[];
  creationId: string | null;
  mediaId: string | null;
  permalink: string | null;
  error: string | null;
  /** 時間をおいて再試行した回数（コンテナ作成・公開の一時的な失敗） */
  attempts: number;
  /** 公開の呼び出しを一度でもしたか（したなら勝手にやり直さない） */
  publishAttempted: boolean;
  /** 同じ鍵で違う内容が来たことを見分ける（署名URLは毎回変わるので含めない） */
  requestDigest: string;
  updatedAt: Date;
};

export interface PublicationStore {
  get(scheduledPostId: string): Promise<PublicationRow | null>;
  /** 既にあれば false（一意制約に任せる）。 */
  insert(row: PublicationRow): Promise<boolean>;
  /** state が expected のときだけ書き換える。書き換えたら true。 */
  update(
    scheduledPostId: string,
    expected: PublicationState,
    patch: Partial<PublicationRow>
  ): Promise<boolean>;
}

/** コンテナ作成・公開の一時的な失敗を、これだけ繰り返したら諦める（公開前のみ）。 */
export const MAX_ATTEMPTS = 8;

/**
 * 【要確認】Instagram の上限。Meta 公式ドキュメントで確認すること。
 * 確認できるまでは、明らかに超えるものを先に弾くためだけに使う。
 */
export const LIMITS = {
  maxCarouselItems: 10,
  maxCaptionLength: 2200,
  maxHashtags: 30,
};

export type HandlerResult = { status: number; body: Record<string, unknown> };

type Deps = {
  store: PublicationStore;
  graph: InstagramGraph | null;
  config: InstagramConfig;
  now?: () => Date;
};

// ---------------------------------------------------------------------
// 依頼の読み取り
// ---------------------------------------------------------------------

type ParsedRequest = {
  scheduledPostId: string;
  clientId: string;
  caption: string;
  hashtagCount: number;
  media: { slideIndex: number; url: string }[];
  dryRun: boolean;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** 本文・CTA・ハッシュタグを、Instagram のキャプション1つにまとめる。 */
export function buildCaption(input: {
  caption: string;
  cta: string;
  hashtags: string[];
}): string {
  const tags = input.hashtags
    .map(tag => tag.trim().replace(/^#+/, ""))
    .filter(Boolean)
    .map(tag => `#${tag}`);
  return [input.caption, input.cta, tags.join(" ")]
    .map(part => part.trim())
    .filter(Boolean)
    .join("\n\n");
}

function parseRequest(
  body: Record<string, unknown>
): { ok: true; value: ParsedRequest } | { ok: false; error: string } {
  const scheduledPostId = text(body.scheduled_post_id);
  if (!UUID.test(scheduledPostId))
    return { ok: false, error: "scheduled_post_id がありません" };
  const idempotencyKey = text(body.idempotency_key);
  if (idempotencyKey && idempotencyKey !== scheduledPostId)
    return {
      ok: false,
      error: "idempotency_key と scheduled_post_id が違います",
    };
  if (body.platform !== "instagram")
    return { ok: false, error: "platform が instagram ではありません" };
  const clientId = text(body.client_id);
  if (!clientId) return { ok: false, error: "client_id がありません" };

  const creative = (body.creative ?? {}) as Record<string, unknown>;
  const content = (body.content ?? {}) as Record<string, unknown>;
  const hashtags = Array.isArray(creative.hashtags)
    ? creative.hashtags.filter((tag): tag is string => typeof tag === "string")
    : [];
  const caption = buildCaption({
    caption: text(creative.caption) || text(content.body),
    cta: text(creative.cta) || text(content.call_to_action),
    hashtags,
  });

  const rawMedia = Array.isArray(creative.media) ? creative.media : [];
  const media: { slideIndex: number; url: string }[] = [];
  for (const raw of rawMedia) {
    const item = (raw ?? {}) as Record<string, unknown>;
    const slideIndex = Number(item.slide_index);
    const url = text(item.image_url) || text(item.url);
    if (!Number.isFinite(slideIndex))
      return { ok: false, error: "素材のスライド番号が読めません" };
    // 理由にURLを含めない
    if (!url.startsWith("https://"))
      return {
        ok: false,
        error: `スライド${slideIndex}の素材が https のURLではありません`,
      };
    media.push({ slideIndex, url });
  }
  media.sort((a, b) => a.slideIndex - b.slideIndex);

  if (media.length === 0)
    return { ok: false, error: "Instagram には画像が1枚以上必要です" };
  if (media.length > LIMITS.maxCarouselItems)
    return {
      ok: false,
      error: `画像は${LIMITS.maxCarouselItems}枚までです（${media.length}枚）`,
    };
  if (caption.length > LIMITS.maxCaptionLength)
    return {
      ok: false,
      error: `キャプションが長すぎます（${caption.length}文字）`,
    };
  const hashtagCount = (caption.match(/#[^\s#]+/g) ?? []).length;
  if (hashtagCount > LIMITS.maxHashtags)
    return {
      ok: false,
      error: `ハッシュタグが多すぎます（${hashtagCount}個）`,
    };

  return {
    ok: true,
    value: {
      scheduledPostId,
      clientId,
      caption,
      hashtagCount,
      media,
      dryRun: body.dry_run === true,
    },
  };
}

function digestOf(request: ParsedRequest): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        client: request.clientId,
        caption: request.caption,
        slides: request.media.map(m => m.slideIndex),
      })
    )
    .digest("hex");
}

// ---------------------------------------------------------------------
// 応答
// ---------------------------------------------------------------------

/** 状態の問い合わせへの1件ぶんの答え。 */
export function settlementOf(row: PublicationRow) {
  if (row.state === "published")
    return {
      scheduled_post_id: row.scheduledPostId,
      state: "published" as const,
      id: row.mediaId,
      url: row.permalink,
    };
  if (row.state === "failed")
    return {
      scheduled_post_id: row.scheduledPostId,
      state: "failed" as const,
      error: row.error,
    };
  return {
    scheduled_post_id: row.scheduledPostId,
    state: "in_progress" as const,
  };
}

function publishResponse(row: PublicationRow): HandlerResult {
  if (row.state === "published")
    return {
      status: 200,
      body: { status: "published", id: row.mediaId, url: row.permalink },
    };
  if (row.state === "failed")
    return {
      status: 422,
      body: { error: row.error ?? "公開できませんでした" },
    };
  return {
    status: 202,
    body: {
      status: "accepted",
      publication_id: row.scheduledPostId,
      container_id: row.creationId,
    },
  };
}

// ---------------------------------------------------------------------
// 一歩ずつ進める
// ---------------------------------------------------------------------

function safeMessage(error: unknown): string {
  if (error instanceof GraphError) return error.message;
  return "処理中に想定外のエラーが起きました";
}

/**
 * 依頼を1段進める。どこまで進んだかの最新の行を返す。
 * 失敗しても例外は投げない（行の状態で表す）。
 */
export async function advance(
  deps: Deps,
  row: PublicationRow
): Promise<PublicationRow> {
  const { store, graph } = deps;
  const now = deps.now ?? (() => new Date());
  if (!graph) return row;
  const reload = async () => (await store.get(row.scheduledPostId)) ?? row;

  // 一時的な失敗。公開前なら回数で諦める。公開後（publishAttempted）は諦めない。
  const transient = async (
    expected: PublicationState,
    error: unknown
  ): Promise<PublicationRow> => {
    const attempts = row.attempts + 1;
    const giveUp = !row.publishAttempted && attempts >= MAX_ATTEMPTS;
    await store.update(row.scheduledPostId, expected, {
      attempts,
      error: safeMessage(error),
      ...(giveUp ? { state: "failed", mediaUrls: null } : {}),
      updatedAt: now(),
    });
    return reload();
  };
  const fail = async (expected: PublicationState, message: string) => {
    await store.update(row.scheduledPostId, expected, {
      state: "failed",
      error: message,
      mediaUrls: null,
      updatedAt: now(),
    });
    return reload();
  };

  // 1) コンテナを作る
  if (row.state === "queued") {
    const urls = row.mediaUrls ?? [];
    if (urls.length === 0)
      return fail(
        "queued",
        "素材のURLが残っていません。予約からやり直してください"
      );
    try {
      let creationId: string;
      const children: string[] = [];
      if (urls.length === 1) {
        creationId = await graph.createImageContainer({
          igUserId: row.igUserId,
          imageUrl: urls[0],
          caption: row.caption,
        });
      } else {
        for (const url of urls)
          children.push(
            await graph.createImageContainer({
              igUserId: row.igUserId,
              imageUrl: url,
              isCarouselItem: true,
            })
          );
        creationId = await graph.createCarouselContainer({
          igUserId: row.igUserId,
          children,
          caption: row.caption,
        });
      }
      // 取り合いに負けたら、作ったコンテナは使わない（公開されないまま期限切れになる）
      await store.update(row.scheduledPostId, "queued", {
        state: "processing",
        creationId,
        childContainerIds: children,
        mediaUrls: null,
        error: null,
        updatedAt: now(),
      });
      return reload();
    } catch (error) {
      if (error instanceof GraphError && !error.retryable)
        return fail("queued", safeMessage(error));
      return transient("queued", error);
    }
  }

  // 2) 処理を待つ → 終わっていれば公開する
  if (row.state === "processing" && row.creationId) {
    let status;
    try {
      status = await graph.containerStatus(row.creationId);
    } catch {
      // 状態が聞けないだけ。数えずに次の回で聞き直す
      return row;
    }
    if (status === "PUBLISHED")
      return markPublished(deps, row, "processing", null);
    if (status === "ERROR" || status === "EXPIRED")
      return fail(
        "processing",
        status === "EXPIRED"
          ? "コンテナの期限が切れました。予約からやり直してください"
          : "Instagram 側で素材の処理に失敗しました（画像の形式・サイズを確認してください）"
      );
    if (status !== "FINISHED") return row;

    // 公開の直前に、条件つきで「公開中」へ移す。負けたら何もしない
    const claimed = await store.update(row.scheduledPostId, "processing", {
      state: "publishing",
      publishAttempted: true,
      updatedAt: now(),
    });
    if (!claimed) return reload();
    try {
      const mediaId = await graph.publish({
        igUserId: row.igUserId,
        creationId: row.creationId,
      });
      return markPublished(
        deps,
        { ...row, state: "publishing" },
        "publishing",
        mediaId
      );
    } catch (error) {
      // 公開されたか分からない。失敗にはしない。次の回にコンテナの状態で確かめる
      await store.update(row.scheduledPostId, "publishing", {
        error: safeMessage(error),
        updatedAt: now(),
      });
      return reload();
    }
  }

  // 3) 公開中のまま止まっている（呼び出し中に落ちた・応答が返らなかった）
  //    公開されたと確かめられたときだけ確定する。確かめられないものは
  //    自動ではやり直さない（二重投稿になりうるため）。OS 側で
  //    一定時間後に「要確認」へ移り、人が Instagram を見て判断する。
  if (row.state === "publishing" && row.creationId) {
    let status;
    try {
      status = await graph.containerStatus(row.creationId);
    } catch {
      return row;
    }
    if (status === "PUBLISHED")
      return markPublished(deps, row, "publishing", null);
    return row;
  }

  return row;
}

async function markPublished(
  deps: Deps,
  row: PublicationRow,
  expected: PublicationState,
  mediaId: string | null
): Promise<PublicationRow> {
  const now = deps.now ?? (() => new Date());
  const permalink =
    mediaId && deps.graph ? await deps.graph.permalink(mediaId) : null;
  await deps.store.update(row.scheduledPostId, expected, {
    state: "published",
    mediaId,
    permalink,
    error: null,
    mediaUrls: null,
    updatedAt: now(),
  });
  return (await deps.store.get(row.scheduledPostId)) ?? row;
}

// ---------------------------------------------------------------------
// 入口
// ---------------------------------------------------------------------

/** action: publish（既定） */
export async function handlePublish(
  deps: Deps,
  body: Record<string, unknown>
): Promise<HandlerResult> {
  const parsed = parseRequest(body);
  if (!parsed.ok) return { status: 400, body: { error: parsed.error } };
  const request = parsed.value;
  const { config } = deps;
  const now = deps.now ?? (() => new Date());

  // 第1段階は決めた1クライアントだけ。それ以外のアカウントへは届かない
  if (!config.allowedClientId || request.clientId !== config.allowedClientId)
    return {
      status: 403,
      body: { error: "このクライアントの Instagram 公開は許可されていません" },
    };

  // dry-run：検証だけ。Graph API を呼ばず、何も保存しない
  if (request.dryRun || config.dryRun)
    return {
      status: 200,
      body: {
        status: "dry_run",
        checks: {
          media_count: request.media.length,
          caption_length: request.caption.length,
          hashtag_count: request.hashtagCount,
          live_settings_missing: missingLiveSettings(config),
        },
      },
    };

  if (!config.enabled)
    return {
      status: 503,
      body: { error: "Instagram 公開は無効です（INSTAGRAM_PUBLISH_ENABLED）" },
    };
  const missing = missingLiveSettings(config);
  if (missing.length > 0 || !deps.graph)
    return {
      status: 503,
      body: { error: "configuration_required", missing },
    };

  const digest = digestOf(request);
  const existing = await deps.store.get(request.scheduledPostId);
  if (existing) {
    if (existing.requestDigest !== digest)
      return {
        status: 409,
        body: { error: "同じ予約で、前回と違う内容が送られました" },
      };
    // 公開前に失敗したものだけ、新しい素材URLでやり直せる。
    // 公開を呼んだことがあるものは、二重投稿を避けるためやり直さない
    if (existing.state === "failed" && !existing.publishAttempted) {
      await deps.store.update(existing.scheduledPostId, "failed", {
        state: "queued",
        mediaUrls: request.media.map(m => m.url),
        childContainerIds: [],
        creationId: null,
        error: null,
        attempts: 0,
        updatedAt: now(),
      });
      const requeued =
        (await deps.store.get(existing.scheduledPostId)) ?? existing;
      return publishResponse(await advance(deps, requeued));
    }
    // まだ素材URLを使い切っていない（コンテナ未作成）なら、新しいURLに差し替える
    if (existing.state === "queued")
      await deps.store.update(existing.scheduledPostId, "queued", {
        mediaUrls: request.media.map(m => m.url),
        updatedAt: now(),
      });
    const current =
      (await deps.store.get(existing.scheduledPostId)) ?? existing;
    return publishResponse(await advance(deps, current));
  }

  const row: PublicationRow = {
    scheduledPostId: request.scheduledPostId,
    externalClientId: request.clientId,
    igUserId: config.igUserId,
    state: "queued",
    caption: request.caption,
    mediaUrls: request.media.map(m => m.url),
    childContainerIds: [],
    creationId: null,
    mediaId: null,
    permalink: null,
    error: null,
    attempts: 0,
    publishAttempted: false,
    requestDigest: digest,
    updatedAt: now(),
  };
  const inserted = await deps.store.insert(row);
  const current = inserted
    ? row
    : ((await deps.store.get(row.scheduledPostId)) ?? row);
  return publishResponse(await advance(deps, current));
}

/** action: status */
export async function handleStatus(
  deps: Deps,
  body: Record<string, unknown>,
  options: { budgetMs?: number } = {}
): Promise<HandlerResult> {
  const ids = Array.isArray(body.scheduled_post_ids)
    ? body.scheduled_post_ids
        .filter((id): id is string => typeof id === "string" && UUID.test(id))
        .slice(0, 100)
    : [];
  const budgetMs = options.budgetMs ?? 10_000;
  const started = Date.now();
  const canAdvance =
    deps.config.enabled &&
    !deps.config.dryRun &&
    deps.graph !== null &&
    missingLiveSettings(deps.config).length === 0;

  const results = [];
  for (const id of ids) {
    let row = await deps.store.get(id);
    // 知らない予約は答えない（OS 側は「次の回で聞き直す」）
    if (!row) continue;
    if (row.externalClientId !== deps.config.allowedClientId) continue;
    if (canAdvance && Date.now() - started < budgetMs)
      row = await advance(deps, row);
    results.push(settlementOf(row));
  }
  return { status: 200, body: { results } };
}
