import { lookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";

export const CRAWL_LIMITS = {
  pages: 8,
  chars: 120_000,
  responseBytes: 1_500_000,
  redirects: 3,
  timeoutMs: 8_000,
} as const;

export type CrawledPage = { url: string; title: string; text: string };

function ipv4Number(ip: string): number {
  return ip.split(".").reduce((n, part) => (n << 8) + Number(part), 0) >>> 0;
}

export function isBlockedIp(address: string): boolean {
  if (!net.isIP(address)) return true;
  if (net.isIPv4(address)) {
    const n = ipv4Number(address);
    const inRange = (base: string, bits: number) => {
      const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
      return (n & mask) === (ipv4Number(base) & mask);
    };
    return [
      ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
      ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.168.0.0", 16],
      ["198.18.0.0", 15], ["224.0.0.0", 4], ["240.0.0.0", 4],
    ].some(([base, bits]) => inRange(base as string, bits as number));
  }
  const normalized = address.toLowerCase().split("%")[0];
  return normalized === "::" || normalized === "::1" || normalized.startsWith("fc") ||
    normalized.startsWith("fd") || /^fe[89ab]/.test(normalized) || normalized.startsWith("ff") ||
    normalized.startsWith("2001:db8") || normalized.startsWith("::ffff:");
}

export function validateResolvedAddresses(records: Array<{ address: string; family: number }>): { address: string; family: 4 | 6 } {
  if (records.length === 0 || records.some((record) => isBlockedIp(record.address))) {
    throw new Error("公開サイト以外のアドレスは読み取れません。");
  }
  const first = records[0];
  return { address: first.address, family: first.family as 4 | 6 };
}

export async function resolvePublicAddress(hostname: string): Promise<{ address: string; family: 4 | 6 }> {
  const lower = hostname.toLowerCase().replace(/\.$/, "");
  if (lower === "localhost" || lower.endsWith(".localhost") || lower.endsWith(".local")) {
    throw new Error("ローカルアドレスは読み取れません。");
  }
  const records = await lookup(lower, { all: true, verbatim: true });
  return validateResolvedAddresses(records);
}

export function validatePublicUrl(input: string): URL {
  let url: URL;
  try { url = new URL(input.trim()); } catch { throw new Error("URLの形式が正しくありません。"); }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("http/https URLのみ使用できます。");
  if (url.username || url.password) throw new Error("認証情報を含むURLは使用できません。");
  if (url.port && !["80", "443"].includes(url.port)) throw new Error("標準以外のポートは使用できません。");
  url.hash = "";
  return url;
}

type SafeResponse = { url: URL; status: number; contentType: string; body: string };

export function assertAllowedContentType(contentType: string, allowPlainText = false): void {
  const normalized = contentType.toLowerCase();
  if (!normalized.includes("text/html") && !normalized.includes("application/xhtml+xml") &&
    !(allowPlainText && normalized.includes("text/plain"))) {
    throw new Error("HTML以外のコンテンツは読み取れません。");
  }
}

export function assertResponseSize(size: number): void {
  if (size > CRAWL_LIMITS.responseBytes) throw new Error("ページサイズが上限を超えました。");
}

export function validateRedirectTarget(location: string, current: URL, allowedHost: string): string {
  const target = validatePublicUrl(new URL(location, current).toString());
  if (target.hostname.toLowerCase() !== allowedHost) throw new Error("同一ドメイン以外へはリダイレクトできません。");
  return target.toString();
}

export async function safeFetchHtml(input: string, originalHost?: string, redirects = 0, allowPlainText = false): Promise<SafeResponse> {
  const url = validatePublicUrl(input);
  const allowedHost = originalHost ?? url.hostname.toLowerCase();
  if (url.hostname.toLowerCase() !== allowedHost) throw new Error("同一ドメイン以外は読み取れません。");
  const resolved = await resolvePublicAddress(url.hostname);
  const transport = url.protocol === "https:" ? https : http;

  const result = await new Promise<SafeResponse>((resolve, reject) => {
    const request = transport.request(url, {
      method: "GET",
      headers: { "User-Agent": "ThreadsStudioProfileReader/1.0", Accept: "text/html,application/xhtml+xml" },
      lookup: (_host, _options, callback) => callback(null, resolved.address, resolved.family),
      ...(url.protocol === "https:" ? { servername: url.hostname } : {}),
    }, (response) => {
      const status = response.statusCode ?? 0;
      const location = response.headers.location;
      if (status >= 300 && status < 400 && location) {
        response.resume();
        if (redirects >= CRAWL_LIMITS.redirects) return reject(new Error("リダイレクト回数が上限を超えました。"));
        let target: string;
        try { target = validateRedirectTarget(location, url, allowedHost); } catch (error) { return reject(error); }
        return safeFetchHtml(target, allowedHost, redirects + 1, allowPlainText).then(resolve, reject);
      }
      const contentType = String(response.headers["content-type"] ?? "").toLowerCase();
      try {
        assertAllowedContentType(contentType, allowPlainText);
        const declaredSize = Number(response.headers["content-length"] ?? 0);
        if (Number.isFinite(declaredSize)) assertResponseSize(declaredSize);
      } catch (error) {
        response.resume();
        return reject(error);
      }
      const chunks: Buffer[] = [];
      let size = 0;
      response.on("data", (chunk: Buffer) => {
        size += chunk.length;
        try { assertResponseSize(size); } catch (error) { request.destroy(error as Error); return; }
        chunks.push(chunk);
      });
      response.on("end", () => {
        if (status < 200 || status >= 300) return reject(new Error(`サイトの取得に失敗しました (${status})。`));
        resolve({ url, status, contentType, body: Buffer.concat(chunks).toString("utf8") });
      });
    });
    request.setTimeout(CRAWL_LIMITS.timeoutMs, () => request.destroy(new Error("サイトの読み取りがタイムアウトしました。")));
    request.on("error", reject);
    request.end();
  });
  return result;
}

function decodeEntities(text: string): string {
  return text.replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&#39;/gi, "'");
}

export function extractReadableHtml(html: string): { title: string; text: string; links: string[] } {
  const title = decodeEntities(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").replace(/\s+/g, " ").trim().slice(0, 160);
  const links = Array.from(html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["']/gi), (match) => decodeEntities(match[1]));
  const text = decodeEntities(html
    .replace(/<(script|style|noscript|svg|template)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[^]*?-->/g, " ").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ").trim();
  return { title, text, links };
}

const PRIORITY = /about|company|service|product|menu|price|pricing|case|works|faq|access|contact|blog|news|会社|概要|料金|事例|商品|サービス|アクセス|お知らせ/i;

export function robotsAllows(robots: string, pathname: string): boolean {
  let applies = false;
  const disallowed: string[] = [];
  for (const raw of robots.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const [name, ...rest] = line.split(":");
    const value = rest.join(":").trim();
    if (name?.toLowerCase() === "user-agent") applies = value === "*";
    else if (applies && name?.toLowerCase() === "disallow" && value) disallowed.push(value);
  }
  return !disallowed.some((path) => pathname.startsWith(path));
}

export async function crawlOfficialSite(homepage: string): Promise<CrawledPage[]> {
  const start = validatePublicUrl(homepage);
  let robots = "";
  try {
    robots = (await safeFetchHtml(new URL("/robots.txt", start).toString(), start.hostname.toLowerCase(), 0, true)).body;
  } catch {
    // robots.txt が無い/到達不能な場合は通常の公開ページのみ続行する。
  }
  const queue = [start.toString()];
  const seen = new Set<string>();
  const pages: CrawledPage[] = [];
  let chars = 0;
  while (queue.length && pages.length < CRAWL_LIMITS.pages && chars < CRAWL_LIMITS.chars) {
    const current = queue.shift()!;
    const key = new URL(current); key.search = ""; key.hash = "";
    if (seen.has(key.toString())) continue;
    seen.add(key.toString());
    if (robots && !robotsAllows(robots, key.pathname)) continue;
    let response: SafeResponse;
    try {
      response = await safeFetchHtml(key.toString(), start.hostname.toLowerCase());
    } catch (error) {
      if (pages.length === 0) throw error;
      continue;
    }
    const parsed = extractReadableHtml(response.body);
    const remaining = CRAWL_LIMITS.chars - chars;
    const text = Array.from(parsed.text).slice(0, remaining).join("");
    pages.push({ url: response.url.toString(), title: parsed.title, text });
    chars += Array.from(text).length;
    const candidates = parsed.links.flatMap((link) => {
      try {
        const url = new URL(link, response.url);
        url.hash = "";
        if (!(["http:", "https:"] as string[]).includes(url.protocol) || url.hostname.toLowerCase() !== start.hostname.toLowerCase()) return [];
        return [url.toString()];
      } catch { return []; }
    });
    candidates.sort((a, b) => Number(PRIORITY.test(b)) - Number(PRIORITY.test(a)));
    for (const candidate of candidates.slice(0, 30)) if (!seen.has(candidate) && !queue.includes(candidate)) queue.push(candidate);
  }
  return pages;
}
