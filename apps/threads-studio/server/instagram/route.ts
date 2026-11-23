/**
 * POST /api/instagram/publish
 *
 * 大漁マーケットOS の公開 Webhook（META_PUBLISH_WEBHOOK_URL）の受け取り口。
 *   Authorization: Bearer <INSTAGRAM_PUBLISH_WEBHOOK_SECRET>
 *   本文 action: "publish"（既定）… 公開の依頼
 *        action: "status"            … 結果の問い合わせ
 *
 * 本文・素材URL・トークンはログに出さない。
 */
import { timingSafeEqual } from "crypto";
import type { Request, Response } from "express";

import { readInstagramConfig, missingLiveSettings } from "./config";
import { createHttpGraph, type InstagramGraph } from "./graph";
import {
  handlePublish,
  handleStatus,
  type PublicationStore,
} from "./publisher";
import { createDbPublicationStore } from "./store";

export function bearerMatches(header: unknown, secret: string): boolean {
  if (!secret) return false;
  if (typeof header !== "string" || !header.startsWith("Bearer ")) return false;
  const supplied = Buffer.from(header.slice(7));
  const expected = Buffer.from(secret);
  return (
    supplied.length === expected.length && timingSafeEqual(supplied, expected)
  );
}

type Factories = {
  store?: () => PublicationStore;
  graph?: (baseUrl: string, accessToken: string) => InstagramGraph;
};

export function createInstagramPublishHandler(factories: Factories = {}) {
  return async function instagramPublishHandler(req: Request, res: Response) {
    const config = readInstagramConfig();
    // 共有シークレットが未設定なら、受け取り口ごと閉じる
    if (!bearerMatches(req.headers.authorization, config.webhookSecret))
      return res.status(401).json({ error: "unauthorized" });

    const body =
      req.body && typeof req.body === "object"
        ? (req.body as Record<string, unknown>)
        : {};
    const live = missingLiveSettings(config).length === 0;
    const graph = live
      ? (
          factories.graph ??
          ((baseUrl, accessToken) => createHttpGraph({ baseUrl, accessToken }))
        )(config.graphApiBase, config.accessToken)
      : null;

    try {
      const store = (factories.store ?? createDbPublicationStore)();
      const deps = { store, graph, config };
      const result =
        body.action === "status"
          ? await handleStatus(deps, body)
          : await handlePublish(deps, body);
      return res.status(result.status).json(result.body);
    } catch (error) {
      // DB に届かない等。中身（URL・本文）は出さない
      console.error(
        "[instagram] publish handler failed:",
        error instanceof Error ? error.name : "unknown"
      );
      return res.status(503).json({ error: "temporarily_unavailable" });
    }
  };
}

export const instagramPublishHandler = createInstagramPublishHandler();
