import { TRPCError } from "@trpc/server";
import { ENV } from "./env";

export type NotificationPayload = {
  title: string;
  content: string;
};

const TITLE_MAX_LENGTH = 1200;
const CONTENT_MAX_LENGTH = 20000;

const trimValue = (value: string): string => value.trim();
const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const validatePayload = (input: NotificationPayload): NotificationPayload => {
  if (!isNonEmptyString(input.title)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Notification title is required.",
    });
  }
  if (!isNonEmptyString(input.content)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Notification content is required.",
    });
  }

  const title = trimValue(input.title);
  const content = trimValue(input.content);

  if (title.length > TITLE_MAX_LENGTH) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Notification title must be at most ${TITLE_MAX_LENGTH} characters.`,
    });
  }
  if (content.length > CONTENT_MAX_LENGTH) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Notification content must be at most ${CONTENT_MAX_LENGTH} characters.`,
    });
  }

  return { title, content };
};

/**
 * 運用者への通知（スタンドアロン版）。
 * RESEND_API_KEY と NOTIFY_EMAIL が設定されていれば Resend でメール送信し、
 * 未設定ならサーバーログに出力して false を返す（トークン失効・投稿エラー等の
 * 呼び出し元は送信失敗でも処理を続行できる設計）。
 */
export async function notifyOwner(
  payload: NotificationPayload
): Promise<boolean> {
  const { title, content } = validatePayload(payload);

  if (!ENV.resendApiKey || !ENV.notifyEmail) {
    console.warn(
      `[Notify] Email not configured (RESEND_API_KEY / NOTIFY_EMAIL) — ${title}: ${content}`
    );
    return false;
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ENV.resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: ENV.emailFrom,
        to: [ENV.notifyEmail],
        subject: title,
        text: content,
      }),
    });
    if (!res.ok) {
      console.error(
        `[Notify] Resend returned ${res.status}: ${await res.text()}`
      );
      return false;
    }
    return true;
  } catch (error) {
    console.error("[Notify] Failed to send email:", error);
    return false;
  }
}
