/**
 * Instagram 公開の設定（Threads Studio 側の受け取り口）。
 *
 * どれも既定は「何もしない」側に倒す。
 *   INSTAGRAM_PUBLISH_ENABLED が "true" でなければ、実際の公開は一切しない
 *   （dry-run の検証と、状態の問い合わせにだけ答える）。
 *
 * 秘密値（共有シークレット・アクセストークン）は、ログ・応答・エラー文に出さない。
 * 読むたびに process.env を見る（テストと、再起動なしの切り替えのため）。
 */
export type InstagramConfig = {
  /** "true" のときだけ、Graph API を呼んで実際に公開する */
  enabled: boolean;
  /** "true" なら、どの依頼も検証だけ行い公開しない */
  dryRun: boolean;
  /** 大漁マーケットOS と共有する Bearer シークレット */
  webhookSecret: string;
  /** 公開してよい大漁マーケットの clients.id（第1段階は CREAW の1件だけ） */
  allowedClientId: string;
  /** Instagram のプロアカウントの ID（Graph API の ig-user-id） */
  igUserId: string;
  /** Graph API のアクセストークン */
  accessToken: string;
  /**
   * Graph API の基点（バージョン込み）。
   * 例の形：https://<host>/<version>
   * 【要確認】ログイン方式（Facebookログイン／Instagramログイン）でホストが変わる。
   * 推測で既定値を置かない。未設定なら実投稿の設定不足として止める。
   */
  graphApiBase: string;
};

export function readInstagramConfig(
  env: NodeJS.ProcessEnv = process.env
): InstagramConfig {
  return {
    enabled: env.INSTAGRAM_PUBLISH_ENABLED === "true",
    dryRun: env.INSTAGRAM_PUBLISH_DRY_RUN === "true",
    webhookSecret: env.INSTAGRAM_PUBLISH_WEBHOOK_SECRET ?? "",
    allowedClientId: (env.INSTAGRAM_CLIENT_ID ?? "").trim(),
    igUserId: (env.INSTAGRAM_IG_USER_ID ?? "").trim(),
    accessToken: env.INSTAGRAM_ACCESS_TOKEN ?? "",
    graphApiBase: (env.INSTAGRAM_GRAPH_API_BASE ?? "")
      .trim()
      .replace(/\/+$/, ""),
  };
}

/** 実投稿に必要な設定のうち、欠けているものの名前（値は返さない）。 */
export function missingLiveSettings(config: InstagramConfig): string[] {
  const missing: string[] = [];
  if (!config.allowedClientId) missing.push("INSTAGRAM_CLIENT_ID");
  if (!config.igUserId) missing.push("INSTAGRAM_IG_USER_ID");
  if (!config.accessToken) missing.push("INSTAGRAM_ACCESS_TOKEN");
  if (!/^https:\/\//.test(config.graphApiBase))
    missing.push("INSTAGRAM_GRAPH_API_BASE");
  return missing;
}
