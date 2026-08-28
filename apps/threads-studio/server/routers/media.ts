import { randomBytes } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createMedia } from "../db";
import { protectedProcedure, router } from "../_core/trpc";

/** Threadsが受け付ける画像形式 */
const ALLOWED_MIME = new Set(["image/jpeg", "image/png"]);
/** 1枚あたりの上限。クライアント側で縮小してから送る想定 */
const MAX_BYTES = 4 * 1024 * 1024;

export type ParsedImage = { mimeType: string; base64: string; byteSize: number };

/**
 * data URL を検証して中身を取り出す（純粋関数・テスト対象）。
 * 形式・MIME・サイズのいずれかが不正なら理由付きで例外を投げる。
 */
export function parseImageDataUrl(dataUrl: string): ParsedImage {
  const m = /^data:([a-zA-Z0-9/+.-]+);base64,([\s\S]+)$/.exec(dataUrl);
  if (!m) throw new Error("画像の形式が不正です。");
  const [, mimeType, base64] = m;
  if (!ALLOWED_MIME.has(mimeType)) {
    throw new Error("画像は JPEG または PNG のみ利用できます。");
  }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
    throw new Error("画像の形式が不正です。");
  }
  const byteSize = Buffer.byteLength(base64, "base64");
  if (byteSize > MAX_BYTES) {
    throw new Error("画像サイズが大きすぎます（4MBまで）。");
  }
  return { mimeType, base64, byteSize };
}

export const mediaRouter = router({
  /**
   * data URL 形式（data:image/jpeg;base64,...）で画像を受け取り、
   * 公開URL（/api/media/<token>）を返す。
   */
  upload: protectedProcedure
    .input(z.object({ dataUrl: z.string().min(1).max(12_000_000) }))
    .mutation(async ({ input }) => {
      let parsed;
      try {
        parsed = parseImageDataUrl(input.dataUrl);
      } catch (e) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: e instanceof Error ? e.message : "画像の形式が不正です。",
        });
      }
      const { mimeType, base64, byteSize } = parsed;

      const token = randomBytes(16).toString("hex");
      await createMedia({ token, mimeType, byteSize, data: base64 });
      return { token, url: `/api/media/${token}`, byteSize };
    }),
});
