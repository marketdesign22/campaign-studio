/**
 * Instagram 公開の受け取り口の検証。
 *
 * 本物の Meta（Graph API）・DB には一切接続しない。
 * Graph API は FakeGraph、台帳はメモリ上の FakeStore で置き換える。
 */
import { describe, expect, it, vi } from "vitest";

import { readInstagramConfig, type InstagramConfig } from "./config";
import {
  GraphError,
  createHttpGraph,
  type ContainerStatus,
  type InstagramGraph,
} from "./graph";
import {
  CREATE_LEASE_MS,
  MAX_ATTEMPTS,
  buildCaption,
  handlePublish,
  handleStatus,
  matchesExpected,
  type Expected,
  type PublicationRow,
  type PublicationState,
  type PublicationStore,
} from "./publisher";
import { bearerMatches, createInstagramPublishHandler } from "./route";

const CLIENT = "11111111-1111-4111-8111-111111111111";
const OTHER_CLIENT = "22222222-2222-4222-8222-222222222222";
const POST_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const POST_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SIGNED = "https://storage.invalid/sign/one.png?token=zz-signed-token";
const SIGNED_2 = "https://storage.invalid/sign/two.png?token=zz-signed-token-2";

const liveConfig = (over: Partial<InstagramConfig> = {}): InstagramConfig => ({
  enabled: true,
  dryRun: false,
  webhookSecret: "zz-webhook-secret",
  allowedClientId: CLIENT,
  igUserId: "1784000000000000",
  accessToken: "zz-access-token",
  graphApiBase: "https://graph.invalid/vX",
  ...over,
});

class FakeStore implements PublicationStore {
  rows = new Map<string, PublicationRow>();
  async get(id: string) {
    const row = this.rows.get(id);
    return row ? structuredClone(row) : null;
  }
  async insert(row: PublicationRow) {
    if (this.rows.has(row.scheduledPostId)) return false;
    this.rows.set(row.scheduledPostId, structuredClone(row));
    return true;
  }
  async update(id: string, expected: Expected, patch: Partial<PublicationRow>) {
    const row = this.rows.get(id);
    if (!row || !matchesExpected(row, expected)) return false;
    this.rows.set(id, { ...row, ...structuredClone(patch) });
    return true;
  }
}

class FakeGraph implements InstagramGraph {
  calls: { op: string; args: Record<string, unknown> }[] = [];
  status: ContainerStatus = "IN_PROGRESS";
  failCreate: GraphError | null = null;
  failPublish: GraphError | null = null;
  private seq = 0;
  async createImageContainer(args: {
    igUserId: string;
    imageUrl: string;
    caption?: string;
    isCarouselItem?: boolean;
  }) {
    this.calls.push({ op: "createImage", args });
    if (this.failCreate) throw this.failCreate;
    return `ct-${++this.seq}`;
  }
  async createCarouselContainer(args: {
    igUserId: string;
    children: string[];
    caption: string;
  }) {
    this.calls.push({ op: "createCarousel", args });
    return `carousel-${++this.seq}`;
  }
  async containerStatus(id: string) {
    this.calls.push({ op: "status", args: { id } });
    return this.status;
  }
  async publish(args: { igUserId: string; creationId: string }) {
    this.calls.push({ op: "publish", args });
    if (this.failPublish) throw this.failPublish;
    this.status = "PUBLISHED";
    return "ig-media-1";
  }
  async permalink(mediaId: string) {
    this.calls.push({ op: "permalink", args: { mediaId } });
    return "https://www.instagram.invalid/p/abc/";
  }
  count(op: string) {
    return this.calls.filter(c => c.op === op).length;
  }
}

function publishBody(over: Record<string, unknown> = {}) {
  return {
    idempotency_key: POST_A,
    scheduled_post_id: POST_A,
    client_id: CLIENT,
    platform: "instagram",
    scheduled_at: "2026-12-01T00:00:00Z",
    content: { title: "t", body: "本文（予備）", call_to_action: null },
    dry_run: false,
    creative: {
      caption: "冬の新メニュー",
      hashtags: ["カフェ", "#ランチ"],
      cta: "プロフィールのリンクから",
      media: [{ slide_index: 1, image_url: SIGNED }],
    },
    ...over,
  };
}

/** 公開の依頼を送り、応答のあとの処理（コンテナ作成）まで済ませる。応答は送った時点のもの。 */
async function publish(
  deps: Parameters<typeof handlePublish>[0],
  body: Record<string, unknown>
) {
  const result = await handlePublish(deps, body);
  await result.afterResponse?.();
  return result;
}

function setup(config: InstagramConfig = liveConfig()) {
  const store = new FakeStore();
  const graph = new FakeGraph();
  const deps = { store, graph, config };
  return { store, graph, deps };
}

// ---------------------------------------------------------------------

describe("キャプション", () => {
  it("本文・CTA・ハッシュタグを1つにまとめ、# を補う", () => {
    expect(
      buildCaption({
        caption: "本文",
        cta: "リンクから",
        hashtags: ["a", "#b", "  ", "##c"],
      })
    ).toBe("本文\n\nリンクから\n\n#a #b #c");
  });
});

describe("公開の依頼", () => {
  it("記録したらすぐ受付を返し、コンテナ作成は応答のあとに進める（公開はしない）", async () => {
    const { deps, graph, store } = setup();
    const result = await handlePublish(deps, publishBody());
    // 応答の時点では Graph API をまだ呼んでいない（スリープ明けでも OS を待たせない）
    expect(result.status).toBe(202);
    expect(result.body).toMatchObject({
      status: "accepted",
      publication_id: POST_A,
      container_id: null,
    });
    expect(graph.calls).toHaveLength(0);
    expect(store.rows.get(POST_A)?.state).toBe("queued");

    await result.afterResponse?.();
    expect(graph.count("createImage")).toBe(1);
    expect(graph.count("publish")).toBe(0);
    const row = store.rows.get(POST_A)!;
    expect(row.state).toBe("processing");
    expect(row.caption).toBe(
      "冬の新メニュー\n\nプロフィールのリンクから\n\n#カフェ #ランチ"
    );
    // 素材の署名URLは、コンテナを作り終えたら台帳から消す
    expect(row.mediaUrls).toBeNull();
  });

  it("応答に素材URL・トークンを含めない", async () => {
    const { deps } = setup();
    const result = await publish(deps, publishBody());
    const text = JSON.stringify(result.body);
    expect(text).not.toContain("zz-signed-token");
    expect(text).not.toContain("zz-access-token");
  });

  it("複数枚はカルーセル（子コンテナ → 親コンテナ）にする", async () => {
    const { deps, graph } = setup();
    await publish(
      deps,
      publishBody({
        creative: {
          caption: "c",
          hashtags: [],
          cta: "",
          media: [
            { slide_index: 2, image_url: SIGNED_2 },
            { slide_index: 1, image_url: SIGNED },
          ],
        },
      })
    );
    const images = graph.calls.filter(c => c.op === "createImage");
    expect(images.map(c => c.args.imageUrl)).toEqual([SIGNED, SIGNED_2]);
    expect(images.every(c => c.args.isCarouselItem === true)).toBe(true);
    expect(
      graph.calls.find(c => c.op === "createCarousel")?.args
    ).toMatchObject({ children: ["ct-1", "ct-2"], caption: "c" });
  });

  it("同じ予約の再送では、コンテナを作り直さない（二重にしない）", async () => {
    const { deps, graph } = setup();
    await publish(deps, publishBody());
    const again = await publish(
      deps,
      publishBody({
        creative: {
          ...publishBody().creative,
          media: [{ slide_index: 1, image_url: SIGNED_2 }],
        },
      })
    );
    expect(again.status).toBe(202);
    expect(graph.count("createImage")).toBe(1);
  });

  it("同じ予約で中身が違えば 409", async () => {
    const { deps } = setup();
    await publish(deps, publishBody());
    const changed = await publish(
      deps,
      publishBody({
        creative: { ...publishBody().creative, caption: "別の本文" },
      })
    );
    expect(changed.status).toBe(409);
  });

  it("許可していないクライアントは 403。Graph API を呼ばない", async () => {
    const { deps, graph, store } = setup();
    const result = await publish(
      deps,
      publishBody({ client_id: OTHER_CLIENT })
    );
    expect(result.status).toBe(403);
    expect(graph.calls).toHaveLength(0);
    expect(store.rows.size).toBe(0);
  });

  it.each([
    ["platform 違い", { platform: "threads" }],
    [
      "画像なし",
      { creative: { caption: "c", hashtags: [], cta: "", media: [] } },
    ],
    [
      "https でない",
      {
        creative: {
          caption: "c",
          hashtags: [],
          cta: "",
          media: [{ slide_index: 1, image_url: "http://x.invalid/a.png" }],
        },
      },
    ],
    [
      "11枚",
      {
        creative: {
          caption: "c",
          hashtags: [],
          cta: "",
          media: Array.from({ length: 11 }, (_, i) => ({
            slide_index: i,
            image_url: SIGNED,
          })),
        },
      },
    ],
    [
      "ハッシュタグ31個",
      {
        creative: {
          caption: "c",
          hashtags: Array.from({ length: 31 }, (_, i) => `t${i}`),
          cta: "",
          media: [{ slide_index: 1, image_url: SIGNED }],
        },
      },
    ],
    ["予約IDなし", { scheduled_post_id: "x", idempotency_key: "x" }],
  ])("検証に通らないもの（%s）は 400。何も呼ばない", async (_label, over) => {
    const { deps, graph, store } = setup();
    const result = await publish(deps, publishBody(over));
    expect(result.status).toBe(400);
    expect(JSON.stringify(result.body)).not.toContain("zz-");
    expect(graph.calls).toHaveLength(0);
    expect(store.rows.size).toBe(0);
  });
});

describe("フラグと dry-run", () => {
  it("dry_run: true は検証だけ。Graph API を呼ばず、何も保存しない", async () => {
    const { deps, graph, store } = setup();
    const result = await publish(deps, publishBody({ dry_run: true }));
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      status: "dry_run",
      checks: { media_count: 1, hashtag_count: 2, live_settings_missing: [] },
    });
    expect(graph.calls).toHaveLength(0);
    expect(store.rows.size).toBe(0);
  });

  it("受け取り側の INSTAGRAM_PUBLISH_DRY_RUN でも検証だけになる", async () => {
    const { deps, graph } = setup(liveConfig({ dryRun: true }));
    const result = await publish(deps, publishBody());
    expect(result.body.status).toBe("dry_run");
    expect(graph.calls).toHaveLength(0);
  });

  it("dry-run は無効のままでも使え、足りない設定の名前だけ返す（値は返さない）", async () => {
    const { deps, graph } = setup(
      liveConfig({ enabled: false, accessToken: "", graphApiBase: "" })
    );
    const result = await publish(deps, publishBody({ dry_run: true }));
    expect(result.body).toMatchObject({
      status: "dry_run",
      checks: {
        live_settings_missing: [
          "INSTAGRAM_ACCESS_TOKEN",
          "INSTAGRAM_GRAPH_API_BASE",
        ],
      },
    });
    expect(graph.calls).toHaveLength(0);
  });

  it("無効（既定）なら公開の依頼は 503。何も呼ばず、何も保存しない", async () => {
    const { deps, graph, store } = setup(liveConfig({ enabled: false }));
    const result = await publish(deps, publishBody());
    expect(result.status).toBe(503);
    expect(graph.calls).toHaveLength(0);
    expect(store.rows.size).toBe(0);
  });

  it("有効でも設定が足りなければ 503（推測で既定のホストへ送らない）", async () => {
    const { deps, graph } = setup(liveConfig({ graphApiBase: "" }));
    const result = await publish(deps, publishBody());
    expect(result.status).toBe(503);
    expect(result.body).toMatchObject({
      missing: ["INSTAGRAM_GRAPH_API_BASE"],
    });
    expect(graph.calls).toHaveLength(0);
  });

  it('フラグは "true" のときだけ（1 や yes では開かない）', () => {
    expect(readInstagramConfig({}).enabled).toBe(false);
    expect(
      readInstagramConfig({ INSTAGRAM_PUBLISH_ENABLED: "1" }).enabled
    ).toBe(false);
    expect(
      readInstagramConfig({ INSTAGRAM_PUBLISH_ENABLED: "true" }).enabled
    ).toBe(true);
  });
});

describe("状態の問い合わせで進める", () => {
  it("処理中 → 終われば公開して published を返す", async () => {
    const { deps, graph } = setup();
    await publish(deps, publishBody());

    const waiting = await handleStatus(deps, {
      action: "status",
      scheduled_post_ids: [POST_A],
    });
    expect(waiting.body.results).toEqual([
      { scheduled_post_id: POST_A, state: "in_progress" },
    ]);
    expect(graph.count("publish")).toBe(0);

    graph.status = "FINISHED";
    const done = await handleStatus(deps, {
      action: "status",
      scheduled_post_ids: [POST_A],
    });
    expect(done.body.results).toEqual([
      {
        scheduled_post_id: POST_A,
        state: "published",
        id: "ig-media-1",
        url: "https://www.instagram.invalid/p/abc/",
      },
    ]);
    expect(graph.count("publish")).toBe(1);

    // 何度聞かれても、二度は公開しない
    await handleStatus(deps, {
      action: "status",
      scheduled_post_ids: [POST_A],
    });
    await publish(deps, publishBody());
    expect(graph.count("publish")).toBe(1);
  });

  it("公開済みの予約に再送されたら、公開済みとして答える", async () => {
    const { deps, graph } = setup();
    await publish(deps, publishBody());
    graph.status = "FINISHED";
    await handleStatus(deps, {
      action: "status",
      scheduled_post_ids: [POST_A],
    });
    const again = await publish(deps, publishBody());
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ status: "published", id: "ig-media-1" });
  });

  it("コンテナが ERROR なら failed（公開はしていない）", async () => {
    const { deps, graph } = setup();
    await publish(deps, publishBody());
    graph.status = "ERROR";
    const result = await handleStatus(deps, {
      action: "status",
      scheduled_post_ids: [POST_A],
    });
    expect(result.body.results).toEqual([
      expect.objectContaining({ scheduled_post_id: POST_A, state: "failed" }),
    ]);
    expect(graph.count("publish")).toBe(0);
  });

  it("公開の呼び出しが失敗しても failed にしない（公開されたか分からない）", async () => {
    const { deps, graph, store } = setup();
    await publish(deps, publishBody());
    graph.status = "FINISHED";
    graph.failPublish = new GraphError(
      "Graph API に接続できませんでした",
      true
    );
    const result = await handleStatus(deps, {
      action: "status",
      scheduled_post_ids: [POST_A],
    });
    expect(result.body.results).toEqual([
      { scheduled_post_id: POST_A, state: "in_progress" },
    ]);
    expect(store.rows.get(POST_A)?.state).toBe("publishing");

    // 次の回：まだ公開されていない（FINISHED のまま）でも、自動では公開し直さない
    graph.failPublish = null;
    await handleStatus(deps, {
      action: "status",
      scheduled_post_ids: [POST_A],
    });
    await handleStatus(deps, {
      action: "status",
      scheduled_post_ids: [POST_A],
    });
    expect(graph.count("publish")).toBe(1);
    expect(store.rows.get(POST_A)?.state).toBe("publishing");
  });

  it("公開中で止まったものは、コンテナが PUBLISHED と確かめられたら published", async () => {
    const { deps, graph, store } = setup();
    await publish(deps, publishBody());
    graph.status = "FINISHED";
    graph.failPublish = new GraphError("x", true);
    await handleStatus(deps, {
      action: "status",
      scheduled_post_ids: [POST_A],
    });
    graph.status = "PUBLISHED";
    const result = await handleStatus(deps, {
      action: "status",
      scheduled_post_ids: [POST_A],
    });
    expect(result.body.results).toEqual([
      expect.objectContaining({
        scheduled_post_id: POST_A,
        state: "published",
      }),
    ]);
    expect(store.rows.get(POST_A)?.state).toBe("published");
  });

  it("知らない予約・他クライアントの予約は答えない", async () => {
    const { deps, store } = setup();
    await publish(deps, publishBody());
    store.rows.set(POST_B, {
      ...store.rows.get(POST_A)!,
      scheduledPostId: POST_B,
      externalClientId: OTHER_CLIENT,
    });
    const result = await handleStatus(deps, {
      action: "status",
      scheduled_post_ids: [
        POST_A,
        POST_B,
        "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      ],
    });
    expect((result.body.results as unknown[]).length).toBe(1);
  });

  it("無効のときは状態を答えるだけで、Graph API を呼ばない", async () => {
    const { deps, graph } = setup();
    await publish(deps, publishBody());
    graph.calls = [];
    graph.status = "FINISHED";
    const off = { ...deps, config: liveConfig({ enabled: false }) };
    const result = await handleStatus(off, {
      action: "status",
      scheduled_post_ids: [POST_A],
    });
    expect(result.body.results).toEqual([
      { scheduled_post_id: POST_A, state: "in_progress" },
    ]);
    expect(graph.calls).toHaveLength(0);
  });
});

describe("コンテナ作成の失敗", () => {
  it("一時的な失敗は待って再試行し、上限で failed（公開前なので安全）", async () => {
    const { deps, graph, store } = setup();
    graph.failCreate = new GraphError("Graph API に接続できませんでした", true);
    const first = await publish(deps, publishBody());
    expect(first.status).toBe(202);
    expect(store.rows.get(POST_A)?.state).toBe("queued");
    for (let i = 1; i < MAX_ATTEMPTS; i += 1)
      await handleStatus(deps, {
        action: "status",
        scheduled_post_ids: [POST_A],
      });
    const row = store.rows.get(POST_A)!;
    expect(row.state).toBe("failed");
    expect(row.mediaUrls).toBeNull();
    expect(graph.count("publish")).toBe(0);
  });

  it("やり直せない失敗はすぐ failed。理由にURL・トークンを含めない", async () => {
    const { deps, graph, store } = setup();
    graph.failCreate = new GraphError(
      "Graph API がエラーを返しました（HTTP 400 code=9004）",
      false,
      400
    );
    const result = await publish(deps, publishBody());
    expect(result.status).toBe(202);
    const row = store.rows.get(POST_A)!;
    expect(row.state).toBe("failed");
    // OS には状態の問い合わせで failed として伝わる
    const status = await handleStatus(deps, {
      action: "status",
      scheduled_post_ids: [POST_A],
    });
    expect(status.body.results).toEqual([
      expect.objectContaining({ scheduled_post_id: POST_A, state: "failed" }),
    ]);
    expect(JSON.stringify(row)).not.toContain("zz-signed-token");
    expect(JSON.stringify(result.body)).not.toContain("zz-");
  });

  it("公開前に失敗したものは、OS からの再送で新しいURLでやり直せる", async () => {
    const { deps, graph, store } = setup();
    graph.failCreate = new GraphError("x", false, 400);
    await publish(deps, publishBody());
    graph.failCreate = null;
    const retry = await publish(deps, publishBody());
    expect(retry.status).toBe(202);
    expect(store.rows.get(POST_A)?.state).toBe("processing");
  });
});

describe("スリープ明け・途中で落ちたとき", () => {
  const status = (deps: Parameters<typeof handleStatus>[0]) =>
    handleStatus(deps, { action: "status", scheduled_post_ids: [POST_A] });

  it("OS が待ちきれず打ち切った依頼の再送でも、二重に作らず最後まで公開する", async () => {
    const { deps, graph, store } = setup();
    // 1回目：OS は15秒で打ち切ったが、受け取り側は記録してコンテナ作成まで進めた
    await publish(deps, publishBody());
    // 10分後の再送（同じ予約）：新しい素材URLが来ても作り直さない
    const again = await publish(
      deps,
      publishBody({
        creative: {
          ...publishBody().creative,
          media: [{ slide_index: 1, image_url: SIGNED_2 }],
        },
      })
    );
    expect(again.status).toBe(202);
    expect(again.body).toMatchObject({
      status: "accepted",
      container_id: "ct-1",
    });
    expect(graph.count("createImage")).toBe(1);
    // 公開の依頼では公開しない（処理が終わっていても）
    graph.status = "FINISHED";
    await publish(deps, publishBody());
    expect(graph.count("publish")).toBe(0);
    // 問い合わせで公開。以後は何度聞かれても1回のまま
    await status(deps);
    await status(deps);
    expect(graph.count("publish")).toBe(1);
    expect(store.rows.get(POST_A)?.state).toBe("published");
  });

  it("同時に2つ届いても、コンテナを作るのは片方だけ", async () => {
    const { deps, graph } = setup();
    const first = await handlePublish(deps, publishBody());
    const second = await handlePublish(deps, publishBody());
    await Promise.all([first.afterResponse?.(), second.afterResponse?.()]);
    expect(graph.count("createImage")).toBe(1);
  });

  it("作成中の借用が生きている間は、問い合わせが来ても手を出さない", async () => {
    const { deps, graph, store } = setup();
    await handlePublish(deps, publishBody()); // 応答のあとの処理は、まだ走っていない
    store.rows.set(POST_A, {
      ...store.rows.get(POST_A)!,
      state: "creating",
      leaseToken: "someone-else",
      updatedAt: new Date(),
    });
    await status(deps);
    expect(graph.calls).toHaveLength(0);
    expect(store.rows.get(POST_A)?.state).toBe("creating");
  });

  it("カルーセルの途中で落ちたら、借用が切れたあと続きの枚から作る", async () => {
    const urls = [
      SIGNED,
      SIGNED_2,
      "https://storage.invalid/sign/three.png?token=zz-3",
    ];
    const body = publishBody({
      creative: {
        caption: "c",
        hashtags: [],
        cta: "",
        media: urls.map((url, i) => ({ slide_index: i + 1, image_url: url })),
      },
    });
    const { deps, graph, store } = setup();
    await handlePublish(deps, body);
    // 2枚目まで作って記録したところでプロセスが落ちた状態
    store.rows.set(POST_A, {
      ...store.rows.get(POST_A)!,
      state: "creating",
      leaseToken: "crashed",
      childContainerIds: ["old-1", "old-2"],
      updatedAt: new Date(Date.now() - CREATE_LEASE_MS - 1000),
    });
    await status(deps);
    const images = graph.calls.filter(c => c.op === "createImage");
    expect(images.map(c => c.args.imageUrl)).toEqual([urls[2]]);
    expect(
      graph.calls.find(c => c.op === "createCarousel")?.args.children
    ).toEqual(["old-1", "old-2", "ct-1"]);
    const row = store.rows.get(POST_A)!;
    expect(row.state).toBe("processing");
    expect(row.leaseToken).toBeNull();
    expect(row.mediaUrls).toBeNull();
  });

  it("一時的な失敗で止まったら、作れた枚は残して次の呼び出しで続きから", async () => {
    const urls = [SIGNED, SIGNED_2];
    const body = publishBody({
      creative: {
        caption: "c",
        hashtags: [],
        cta: "",
        media: urls.map((url, i) => ({ slide_index: i + 1, image_url: url })),
      },
    });
    const { deps, graph, store } = setup();
    let calls = 0;
    const original = graph.createImageContainer.bind(graph);
    graph.createImageContainer = async args => {
      calls += 1;
      if (calls === 2)
        throw new GraphError("Graph API に接続できませんでした", true);
      return original(args);
    };
    await publish(deps, body);
    let row = store.rows.get(POST_A)!;
    expect(row.state).toBe("queued");
    expect(row.childContainerIds).toEqual(["ct-1"]);
    expect(row.leaseToken).toBeNull();

    await status(deps);
    row = store.rows.get(POST_A)!;
    expect(row.state).toBe("processing");
    expect(row.childContainerIds).toEqual(["ct-1", "ct-2"]);
    // 1枚目は作り直していない
    expect(
      graph.calls.filter(c => c.op === "createImage").map(c => c.args.imageUrl)
    ).toEqual([SIGNED, SIGNED_2]);
  });

  it("借用を失った呼び出しは、書き進めずにやめる", async () => {
    const urls = [SIGNED, SIGNED_2];
    const body = publishBody({
      creative: {
        caption: "c",
        hashtags: [],
        cta: "",
        media: urls.map((url, i) => ({ slide_index: i + 1, image_url: url })),
      },
    });
    const { deps, graph, store } = setup();
    const result = await handlePublish(deps, body);
    const original = graph.createImageContainer.bind(graph);
    graph.createImageContainer = async args => {
      const id = await original(args);
      // 1枚目を作っている間に、別の呼び出しが借用を引き継いだ
      const row = store.rows.get(POST_A)!;
      store.rows.set(POST_A, { ...row, leaseToken: "taken-over" });
      return id;
    };
    await result.afterResponse?.();
    expect(graph.count("createImage")).toBe(1);
    expect(graph.count("createCarousel")).toBe(0);
    expect(store.rows.get(POST_A)?.leaseToken).toBe("taken-over");
  });
});

describe("Graph API の呼び出し（本物の実装・通信はモック）", () => {
  it("トークンをURLに載せず、エラー文にURL・トークンを含めない", async () => {
    const requests: { url: string; init: RequestInit }[] = [];
    const fetchImpl = vi.fn(
      async (url: string | URL | Request, init?: RequestInit) => {
        requests.push({ url: String(url), init: init ?? {} });
        if (String(url).endsWith("/media"))
          return new Response(JSON.stringify({ id: "ct-9" }), { status: 200 });
        return new Response(
          JSON.stringify({
            error: { message: `bad ${SIGNED}`, code: 100, is_transient: false },
          }),
          { status: 400 }
        );
      }
    );
    const graph = createHttpGraph({
      baseUrl: "https://graph.invalid/vX",
      accessToken: "zz-access-token",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(
      graph.createImageContainer({
        igUserId: "1784",
        imageUrl: SIGNED,
        caption: "c",
      })
    ).resolves.toBe("ct-9");
    const error = await graph
      .publish({ igUserId: "1784", creationId: "ct-9" })
      .catch(e => e);
    expect(error).toBeInstanceOf(GraphError);
    expect(error.retryable).toBe(false);
    expect(error.message).not.toContain("zz-");
    expect(error.message).not.toContain("https://");
    for (const request of requests)
      expect(request.url).not.toContain("zz-access-token");
  });

  it("通信失敗・5xx・429 は再試行できる失敗", async () => {
    for (const status of [500, 429]) {
      const graph = createHttpGraph({
        baseUrl: "https://graph.invalid/vX",
        accessToken: "t",
        fetchImpl: (async () =>
          new Response("{}", { status })) as unknown as typeof fetch,
      });
      const error = await graph
        .publish({ igUserId: "1", creationId: "2" })
        .catch(e => e);
      expect(error.retryable).toBe(true);
    }
    const offline = createHttpGraph({
      baseUrl: "https://graph.invalid/vX",
      accessToken: "t",
      fetchImpl: (async () => {
        throw new Error("ECONNRESET https://graph.invalid/?access_token=t");
      }) as unknown as typeof fetch,
    });
    const error = await offline
      .publish({ igUserId: "1", creationId: "2" })
      .catch(e => e);
    expect(error.retryable).toBe(true);
    expect(error.message).not.toContain("access_token");
  });

  it("知らない状態は UNKNOWN（勝手に成功・失敗にしない）", async () => {
    const graph = createHttpGraph({
      baseUrl: "https://graph.invalid/vX",
      accessToken: "t",
      fetchImpl: (async () =>
        new Response(JSON.stringify({ status_code: "SOMETHING" }), {
          status: 200,
        })) as unknown as typeof fetch,
    });
    await expect(graph.containerStatus("c")).resolves.toBe("UNKNOWN");
  });
});

describe("受け取り口（HTTP）", () => {
  const response = () => {
    const res = {
      statusCode: 0,
      body: undefined as unknown,
      status(code: number) {
        res.statusCode = code;
        return res;
      },
      json(value: unknown) {
        res.body = value;
        return res;
      },
    };
    return res;
  };

  it("Bearer の照合", () => {
    expect(bearerMatches("Bearer s", "s")).toBe(true);
    expect(bearerMatches("Bearer x", "s")).toBe(false);
    expect(bearerMatches("s", "s")).toBe(false);
    expect(bearerMatches(undefined, "s")).toBe(false);
    // シークレット未設定なら誰も通さない
    expect(bearerMatches("Bearer ", "")).toBe(false);
  });

  it("認証に失敗したら 401。台帳にも Graph API にも触れない", async () => {
    process.env.INSTAGRAM_PUBLISH_WEBHOOK_SECRET = "zz-webhook-secret";
    const store = vi.fn(() => new FakeStore());
    const handler = createInstagramPublishHandler({ store });
    const res = response();
    await handler(
      {
        headers: { authorization: "Bearer wrong" },
        body: publishBody(),
      } as never,
      res as never
    );
    expect(res.statusCode).toBe(401);
    expect(store).not.toHaveBeenCalled();
    delete process.env.INSTAGRAM_PUBLISH_WEBHOOK_SECRET;
  });

  it("既定の環境（フラグ未設定）では公開の依頼を 503 で断る", async () => {
    process.env.INSTAGRAM_PUBLISH_WEBHOOK_SECRET = "zz-webhook-secret";
    process.env.INSTAGRAM_CLIENT_ID = CLIENT;
    delete process.env.INSTAGRAM_PUBLISH_ENABLED;
    const store = new FakeStore();
    const graph = new FakeGraph();
    const handler = createInstagramPublishHandler({
      store: () => store,
      graph: () => graph,
    });
    const res = response();
    await handler(
      {
        headers: { authorization: "Bearer zz-webhook-secret" },
        body: publishBody(),
      } as never,
      res as never
    );
    expect(res.statusCode).toBe(503);
    expect(graph.calls).toHaveLength(0);
    expect(store.rows.size).toBe(0);
    delete process.env.INSTAGRAM_PUBLISH_WEBHOOK_SECRET;
    delete process.env.INSTAGRAM_CLIENT_ID;
  });
});
