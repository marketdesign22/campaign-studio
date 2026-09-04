import { describe, expect, it } from "vitest";
import {
  assertAllowedContentType, assertResponseSize, CRAWL_LIMITS, extractReadableHtml, isBlockedIp,
  robotsAllows, validatePublicUrl, validateRedirectTarget, validateResolvedAddresses,
} from "./safeSiteCrawler";

describe("サイト読み取りのSSRF防御", () => {
  it("localhost、プライベートIP、メタデータIP、IPv6ローカルを拒否する", () => {
    for (const address of ["127.0.0.1", "10.0.0.1", "172.16.1.2", "192.168.1.1", "169.254.169.254", "::1", "fe80::1", "fd00::1"]) {
      expect(isBlockedIp(address), address).toBe(true);
    }
    expect(isBlockedIp("93.184.216.34")).toBe(false);
  });

  it("DNS応答に1つでもプライベートIPが混じればDNS rebinding候補として拒否する", () => {
    expect(() => validateResolvedAddresses([
      { address: "93.184.216.34", family: 4 }, { address: "127.0.0.1", family: 4 },
    ])).toThrow(/公開サイト/);
  });

  it("無効スキーム、認証情報、非標準ポートを拒否する", () => {
    for (const url of ["file:///etc/passwd", "https://user:pass@example.com", "http://example.com:8080"]) {
      expect(() => validatePublicUrl(url), url).toThrow();
    }
  });

  it("危険な別ドメイン、認証情報、非標準ポートへのリダイレクトを拒否する", () => {
    const current = new URL("https://example.com/about");
    expect(() => validateRedirectTarget("https://169.254.169.254/latest", current, "example.com")).toThrow(/同一ドメイン/);
    expect(() => validateRedirectTarget("https://user:secret@example.com/", current, "example.com")).toThrow(/認証情報/);
    expect(() => validateRedirectTarget("https://example.com:8443/", current, "example.com")).toThrow(/ポート/);
    expect(validateRedirectTarget("/company", current, "example.com")).toBe("https://example.com/company");
  });

  it("非HTMLと巨大レスポンスを拒否する", () => {
    expect(() => assertAllowedContentType("application/pdf")).toThrow(/HTML以外/);
    expect(() => assertAllowedContentType("text/plain")).toThrow(/HTML以外/);
    expect(() => assertAllowedContentType("text/plain", true)).not.toThrow();
    expect(() => assertResponseSize(CRAWL_LIMITS.responseBytes + 1)).toThrow(/ページサイズ/);
    expect(() => assertResponseSize(CRAWL_LIMITS.responseBytes)).not.toThrow();
  });

  it("robots.txtのUser-agent: * / Disallowを尊重する", () => {
    const robots = "User-agent: *\nDisallow: /private\nDisallow: /admin";
    expect(robotsAllows(robots, "/about")).toBe(true);
    expect(robotsAllows(robots, "/private/report")).toBe(false);
  });

  it("HTMLからスクリプトを実行・抽出せず、テキストとリンクだけ返す", () => {
    const parsed = extractReadableHtml('<title>About &amp; Us</title><script>stealSecret()</script><h1>Safe</h1><a href="/price">Price</a>');
    expect(parsed.title).toBe("About & Us");
    expect(parsed.text).toContain("Safe");
    expect(parsed.text).not.toContain("stealSecret");
    expect(parsed.links).toEqual(["/price"]);
  });

  it("巡回にページ数・文字数・応答サイズ・リダイレクト・タイムアウト上限がある", () => {
    expect(CRAWL_LIMITS).toEqual(expect.objectContaining({ pages: 8, chars: 120_000, responseBytes: 1_500_000, redirects: 3, timeoutMs: 8_000 }));
  });
});
