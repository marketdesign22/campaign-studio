import { describe, expect, it } from "vitest";
import { parseImageDataUrl } from "./routers/media";

const jpegBase64 = Buffer.from("fake-jpeg-bytes").toString("base64");

describe("parseImageDataUrl", () => {
  it("accepts a JPEG data URL and reports the decoded size", () => {
    const r = parseImageDataUrl(`data:image/jpeg;base64,${jpegBase64}`);
    expect(r.mimeType).toBe("image/jpeg");
    expect(r.base64).toBe(jpegBase64);
    expect(r.byteSize).toBe(Buffer.byteLength(jpegBase64, "base64"));
  });

  it("accepts PNG", () => {
    expect(parseImageDataUrl(`data:image/png;base64,${jpegBase64}`).mimeType).toBe("image/png");
  });

  it("rejects formats Threads cannot post", () => {
    expect(() => parseImageDataUrl(`data:image/webp;base64,${jpegBase64}`)).toThrow(/JPEG/);
    expect(() => parseImageDataUrl(`data:image/gif;base64,${jpegBase64}`)).toThrow(/JPEG/);
  });

  it("rejects anything that is not a base64 data URL", () => {
    expect(() => parseImageDataUrl("https://example.com/a.jpg")).toThrow(/形式/);
    expect(() => parseImageDataUrl("data:image/jpeg,notbase64")).toThrow(/形式/);
    expect(() => parseImageDataUrl(`data:image/jpeg;base64,not valid base64!`)).toThrow(/形式/);
  });

  it("rejects images over 4MB", () => {
    // 4MBを超えるbase64（1文字=0.75バイト相当）
    const big = "A".repeat(4 * 1024 * 1024 * 2);
    expect(() => parseImageDataUrl(`data:image/jpeg;base64,${big}`)).toThrow(/大きすぎ/);
  });
});
