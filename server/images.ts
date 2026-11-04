import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { isIP } from "node:net";
import path from "node:path";

/**
 * Roaster product photos. Most roaster shops (Shopify, WooCommerce, Squarespace)
 * publish a clean packshot in the page's Open Graph or JSON-LD metadata, so we
 * read that rather than asking a model to guess an image URL. The image is
 * downloaded and cached locally so the tablet and phone don't depend on the
 * roaster's site, and so the shelf still works offline.
 */

const MAX_BYTES = 8 * 1024 * 1024;
const TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "image/avif": "avif" };

export const imageDir = () => path.resolve(process.env.CREMA_IMAGES ?? "data/images");

/** Only public http(s) hosts: this runs on your home network. */
export function isSafeUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return false;
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".lan")) return false;
  // RFC 2606 reserved names never host real pages (the mock data uses them).
  if (/(^|\.)example(\.(com|net|org))?$/.test(host) || /\.(test|invalid)$/.test(host)) return false;
  if (isIP(host)) {
    if (/^(10\.|127\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)) return false;
    if (host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80")) return false;
  }
  return true;
}

const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'");

/** Find the main product image URL in a product page's HTML. */
export function productImageFromHtml(html: string, pageUrl: string): string | null {
  const metas = [...html.matchAll(/<meta\s+[^>]*>/gi)].map((m) => m[0]);
  const attr = (tag: string, name: string) => tag.match(new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, "i"))?.[1];
  const candidates: string[] = [];

  for (const key of ["og:image:secure_url", "og:image", "twitter:image", "twitter:image:src"]) {
    for (const tag of metas) {
      if ((attr(tag, "property") ?? attr(tag, "name"))?.toLowerCase() === key) {
        const c = attr(tag, "content");
        if (c) candidates.push(c);
      }
    }
  }

  // JSON-LD Product.image (string, array, or ImageObject)
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const data = JSON.parse(m[1]);
      const nodes = (Array.isArray(data) ? data : [data]).flatMap((n) => (n?.["@graph"] ? n["@graph"] : [n]));
      for (const n of nodes) {
        const type = [].concat(n?.["@type"] ?? []).join(",");
        if (!/Product/i.test(type)) continue;
        const img = n.image;
        const first = Array.isArray(img) ? img[0] : img;
        const url = typeof first === "string" ? first : first?.url;
        if (url) candidates.unshift(url); // a Product's own image beats a generic share image
      }
    } catch {
      /* ignore malformed JSON-LD */
    }
  }

  const link = html.match(/<link\s+[^>]*rel=["']image_src["'][^>]*>/i)?.[0];
  if (link) {
    const href = attr(link, "href");
    if (href) candidates.push(href);
  }

  for (const c of candidates) {
    try {
      const abs = new URL(decode(c), pageUrl).toString();
      if (isSafeUrl(abs)) return abs;
    } catch {
      /* next */
    }
  }
  return null;
}

async function fetchLimited(url: string, accept: string) {
  const res = await fetch(url, {
    headers: { accept, "user-agent": "Mozilla/5.0 (compatible; Crema coffee companion)" },
    redirect: "follow",
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) throw new Error(`${res.status} fetching ${url}`);
  if (!isSafeUrl(res.url || url)) throw new Error("redirected to a non-public address");
  const len = Number(res.headers.get("content-length") ?? 0);
  if (len > MAX_BYTES) throw new Error("too large");
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_BYTES) throw new Error("too large");
  return { buf, type: (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase() };
}

/** Look up the product image on a roaster's page. Returns null when there isn't one. */
export async function findProductImage(productUrl: string): Promise<string | null> {
  if (!isSafeUrl(productUrl)) return null;
  try {
    const { buf, type } = await fetchLimited(productUrl, "text/html");
    if (type && !type.includes("html")) return null;
    return productImageFromHtml(buf.toString("utf8"), productUrl);
  } catch (e) {
    console.warn(`product image lookup failed for ${productUrl}: ${(e as Error).message}`);
    return null;
  }
}

/** Download an image into the local cache. Returns the URL path Crema serves it at. */
export async function cacheImage(url: string): Promise<string | null> {
  if (!isSafeUrl(url)) return null;
  try {
    const { buf, type } = await fetchLimited(url, "image/*");
    const ext = TYPES[type];
    if (!ext) return null;
    const name = `${createHash("sha256").update(url).digest("hex").slice(0, 24)}.${ext}`;
    await mkdir(imageDir(), { recursive: true });
    await writeFile(path.join(imageDir(), name), buf);
    return `/api/images/${name}`;
  } catch (e) {
    console.warn(`image download failed for ${url}: ${(e as Error).message}`);
    return null;
  }
}

export async function readCachedImage(name: string) {
  if (!/^[a-f0-9]{24}\.(jpg|png|webp|gif|avif)$/.test(name)) return null;
  try {
    const data = await readFile(path.join(imageDir(), name));
    const ext = name.split(".").pop()!;
    const type = Object.entries(TYPES).find(([, e]) => e === ext)![0];
    return { data, type };
  } catch {
    return null;
  }
}
