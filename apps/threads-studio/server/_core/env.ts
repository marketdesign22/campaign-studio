/**
 * スタンドアロン版の環境変数。Manusプラットフォーム注入変数には依存しない。
 * Railway ではサービスの Variables に設定する（.env.example 参照）。
 */
export const ENV = {
  databaseUrl: process.env.DATABASE_URL ?? "",
  /** セッションJWTの署名鍵。`openssl rand -hex 32` などで生成した値を設定する */
  cookieSecret: process.env.JWT_SECRET ?? "",

  // Google OAuth (https://console.cloud.google.com/apis/credentials)
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? "",
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
  /** 例: https://your-app.up.railway.app — 未設定ならリクエストから導出 */
  appUrl: process.env.APP_URL ?? "",
  /** ログイン許可メール（カンマ区切り）。未設定なら最初にログインした人が管理者になる */
  allowedEmails: (process.env.ALLOWED_EMAILS ?? "")
    .split(",")
    .map(s => s.trim().toLowerCase())
    .filter(Boolean),

  // AIアシスト (Anthropic API)
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
  anthropicModel: process.env.ANTHROPIC_MODEL ?? "claude-opus-5",

  // 通知メール (Resend)。未設定なら通知はサーバーログのみ
  resendApiKey: process.env.RESEND_API_KEY ?? "",
  notifyEmail: process.env.NOTIFY_EMAIL ?? "",
  emailFrom: process.env.EMAIL_FROM ?? "Threads Studio <onboarding@resend.dev>",

  /** 外部cronから /api/scheduled/tick を叩く場合の共有シークレット（内蔵スケジューラのみなら不要） */
  cronSecret: process.env.CRON_SECRET ?? "",

  isProduction: process.env.NODE_ENV === "production",
};
