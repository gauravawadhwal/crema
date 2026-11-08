import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";
import type { Readable } from "node:stream";

/**
 * Fetching pages and images from addresses that came from a model or a user, on a
 * server that sits on someone's home network. Every hop, redirects included, must
 * be a public http(s) address:
 *
 * - the URL's host name is checked by spelling (isSafeUrl), and literal IPs against
 *   the reserved ranges below;
 * - the name is resolved once, every resolved address is checked, and the socket
 *   connects to that vetted address (the check is the socket's own `lookup`, so
 *   there is no second resolution to race);
 * - redirects are followed here, not by the HTTP client, so each target is checked
 *   before any request is sent to it;
 * - one deadline covers every hop, and the body is streamed and abandoned as soon as
 *   it passes the byte limit, counted after decompression.
 */

// Reserved, private, shared, loopback, link-local, documentation, benchmarking,
// multicast and future-use ranges. IPv4-mapped, NAT64 and 6to4 IPv6 ranges embed an
// IPv4 address, so they're blocked outright; public sites don't need them.
const V4: [string, number][] = [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16],
  ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
];
const V6: [string, number][] = [
  ["::", 128], ["::1", 128], ["::ffff:0:0", 96], ["::", 96], ["64:ff9b::", 96], ["64:ff9b:1::", 48],
  ["100::", 64], ["2001::", 23], ["2001:db8::", 32], ["2002::", 16], ["3fff::", 20], ["5f00::", 16],
  ["fc00::", 7], ["fe80::", 10], ["fec0::", 10], ["ff00::", 8],
];
// Two lists: a BlockList also matches IPv4 lookups against IPv4-mapped IPv6 rules,
// which would block every IPv4 address.
const reserved4 = new BlockList(), reserved6 = new BlockList();
for (const [net, bits] of V4) reserved4.addSubnet(net, bits, "ipv4");
for (const [net, bits] of V6) reserved6.addSubnet(net, bits, "ipv6");

/** A literal IP address that's on the public internet. */
export function isPublicAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) return !reserved4.check(ip, "ipv4");
  if (v === 6) return !reserved6.check(ip, "ipv6");
  return false;
}

/** Only public http(s) URLs, judged by spelling. Names are checked again once resolved. */
export function isSafeUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return false;
  if (u.username || u.password) return false;
  const host = u.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
  if (!host) return false;
  if (isIP(host)) return isPublicAddress(host);
  if (!host.includes(".")) return false; // single-label names only resolve on a local network
  if (host === "localhost" || /\.(localhost|local|internal|lan|home|arpa)$/.test(host)) return false;
  // RFC 2606 reserved names never host real pages (the mock data uses them).
  if (/(^|\.)example(\.(com|net|org))?$/.test(host) || /\.(test|invalid)$/.test(host)) return false;
  return true;
}

export class UnsafeAddressError extends Error {}

export type Resolver = (host: string) => Promise<{ address: string; family: number }[]>;
const systemResolve: Resolver = (host) => dns.promises.lookup(host, { all: true, verbatim: true });

export interface SafeFetchOptions {
  accept?: string;
  /** Largest body to read, after decompression. Default 8 MB. */
  maxBytes?: number;
  /** One deadline for every hop and the body. Default 12 s. */
  timeoutMs?: number;
  maxRedirects?: number;
  /** false: only the status is wanted, so the body isn't read. */
  readBody?: boolean;
  /** For tests: how names resolve, and which addresses count as public. */
  resolve?: Resolver;
  allowAddress?: (ip: string) => boolean;
}

export interface SafeResponse {
  status: number;
  /** The address that answered, after redirects. */
  url: string;
  /** Media type without parameters, lower case. */
  type: string;
  body: Buffer;
}

function vettedLookup(resolve: Resolver, allow: (ip: string) => boolean): LookupFunction {
  return ((hostname: string, options: dns.LookupOptions, cb: (...a: unknown[]) => void) => {
    resolve(hostname).then(
      (addrs) => {
        const bad = addrs.find((a) => !allow(a.address));
        if (bad) return cb(new UnsafeAddressError(`${hostname} resolves to a non-public address`));
        const fam = options?.family;
        const list = fam === 4 || fam === 6 ? addrs.filter((a) => a.family === fam) : addrs;
        if (!list.length) return cb(Object.assign(new Error(`${hostname} has no address`), { code: "ENOTFOUND" }));
        if (options?.all) cb(null, list);
        else cb(null, list[0].address, list[0].family);
      },
      (e) => cb(e),
    );
  }) as LookupFunction;
}

function decoded(res: http.IncomingMessage): Readable {
  const enc = String(res.headers["content-encoding"] ?? "").trim().toLowerCase();
  if (enc === "gzip" || enc === "x-gzip") return res.pipe(createGunzip());
  if (enc === "deflate") return res.pipe(createInflate());
  if (enc === "br") return res.pipe(createBrotliDecompress());
  return res;
}

function once(url: URL, o: Required<Omit<SafeFetchOptions, "resolve" | "allowAddress">> & { lookup: LookupFunction; signal: AbortSignal }) {
  return new Promise<{ status: number; location: string | null; type: string; body: Buffer }>((resolve, reject) => {
    const mod = url.protocol === "https:" ? https : http;
    const req = mod.request(url, {
      method: "GET",
      agent: false,
      lookup: o.lookup,
      signal: o.signal,
      headers: { accept: o.accept, "accept-encoding": "gzip, deflate, br", "user-agent": "Mozilla/5.0 (compatible; Crema coffee companion)" },
    });
    req.on("error", reject);
    req.on("response", (res) => {
      const status = res.statusCode ?? 0;
      const location = status >= 300 && status < 400 ? (res.headers.location ?? null) : null;
      const type = String(res.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
      if (location || !o.readBody) {
        res.destroy();
        return resolve({ status, location, type, body: Buffer.alloc(0) });
      }
      if (Number(res.headers["content-length"] ?? 0) > o.maxBytes) {
        req.destroy();
        return reject(new Error("too large"));
      }
      const chunks: Buffer[] = [];
      let size = 0;
      const body = decoded(res);
      body.on("data", (c: Buffer) => {
        size += c.length;
        if (size > o.maxBytes) {
          req.destroy();
          body.destroy();
          return reject(new Error("too large"));
        }
        chunks.push(c);
      });
      body.on("end", () => resolve({ status, location: null, type, body: Buffer.concat(chunks) }));
      body.on("error", reject);
      res.on("error", reject);
    });
    req.end();
  });
}

/** GET a public URL, following redirects only to public addresses. Throws when it can't. */
export async function safeFetch(start: string, opts: SafeFetchOptions = {}): Promise<SafeResponse> {
  const o = {
    accept: opts.accept ?? "*/*",
    maxBytes: opts.maxBytes ?? 8 * 1024 * 1024,
    timeoutMs: opts.timeoutMs ?? 12_000,
    maxRedirects: opts.maxRedirects ?? 5,
    readBody: opts.readBody ?? true,
    lookup: vettedLookup(opts.resolve ?? systemResolve, opts.allowAddress ?? isPublicAddress),
    signal: AbortSignal.timeout(opts.timeoutMs ?? 12_000),
  };
  let url = start;
  for (let hop = 0; hop <= o.maxRedirects; hop++) {
    if (!isSafeUrl(url)) throw new UnsafeAddressError(hop ? "redirected to a non-public address" : "not a public address");
    const res = await once(new URL(url), o);
    if (!res.location) return { status: res.status, url, type: res.type, body: res.body };
    url = new URL(res.location, url).toString();
  }
  throw new Error("too many redirects");
}
