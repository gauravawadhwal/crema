import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { isPublicAddress, isSafeUrl, safeFetch, UnsafeAddressError } from "../server/safe-fetch.js";
import { cacheImage } from "../server/images.js";

// A local server plays the public internet: made-up names resolve to it through an
// injected resolver, and only its address is allowed. Everything else uses the real
// rules, so a "private" answer means one the production code would refuse.
const servers: ReturnType<typeof createServer>[] = [];
afterEach(() => { servers.splice(0).forEach((s) => s.close()); });

async function serve(handler: (req: IncomingMessage, res: ServerResponse) => void) {
  const seen: string[] = [];
  const server = createServer((req, res) => { seen.push(`${req.headers.host?.split(":")[0]}${req.url}`); handler(req, res); });
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  return { seen, port, url: (host: string, path = "/") => `http://${host}:${port}${path}` };
}

const LOCAL = "127.0.0.1";
// Names ending in .private resolve to a private address; the rest to the test server.
const resolve = async (host: string) => [{ address: host.endsWith(".private") ? "10.0.0.5" : LOCAL, family: 4 }];
const allowLocal = (ip: string) => ip === LOCAL || isPublicAddress(ip);
const net = { resolve, allowAddress: allowLocal };

describe("isPublicAddress", () => {
  it.each(["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111", "2a00:1450:4009:81f::200e"])("allows %s", (ip) => expect(isPublicAddress(ip)).toBe(true));
  it.each([
    "127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.4", "169.254.169.254", "100.64.0.1", "0.0.0.0",
    "198.18.0.1", "224.0.0.1", "255.255.255.255", "192.0.2.1",
    "::", "::1", "fe80::1", "fc00::1", "fd12:3456::1", "ff02::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:192.168.1.1",
    "64:ff9b::7f00:1", "2002:7f00:1::", "2001:db8::1", "not an ip",
  ])("blocks %s", (ip) => expect(isPublicAddress(ip)).toBe(false));
});

describe("isSafeUrl", () => {
  it("allows public https", () => expect(isSafeUrl("https://cdn.shopify.com/a.jpg")).toBe(true));
  it.each([
    "http://localhost/x", "http://localhost./x", "http://192.168.1.4/x", "http://10.0.0.2/x", "file:///etc/passwd", "http://tablet.local/x",
    "https://roaster.example/x", "http://[::1]/x", "http://[::ffff:127.0.0.1]/x", "http://2130706433/x", "http://0x7f.1/x", "http://127.1/x",
    "http://[fe80::1]/x", "http://100.64.1.1/x", "http://0.0.0.0/x", "http://nas/x", "http://router.home/x", "http://user:pw@shop.coffee/x",
  ])("blocks %s", (u) => expect(isSafeUrl(u)).toBe(false));
});

describe("safeFetch", () => {
  it("fetches a public page", async () => {
    const s = await serve((_, res) => { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end("<p>hi</p>"); });
    const r = await safeFetch(s.url("shop.coffee", "/p"), net);
    expect([r.status, r.type, r.body.toString()]).toEqual([200, "text/html", "<p>hi</p>"]);
  });

  it("follows redirects between public addresses and reports where it ended", async () => {
    const s = await serve((req, res) => {
      if (req.url === "/old") { res.writeHead(301, { location: "/new" }); return res.end(); }
      res.end("here");
    });
    const r = await safeFetch(s.url("shop.coffee", "/old"), net);
    expect(r.url).toBe(s.url("shop.coffee", "/new"));
    expect(r.body.toString()).toBe("here");
  });

  it("refuses a redirect to a private literal without requesting it", async () => {
    const s = await serve((_, res) => { res.writeHead(302, { location: "http://192.168.1.10/admin" }); res.end(); });
    await expect(safeFetch(s.url("shop.coffee", "/sneaky"), net)).rejects.toThrow(/redirected to a non-public address/);
    expect(s.seen).toEqual(["shop.coffee/sneaky"]);
  });

  it("refuses a redirect to a name that resolves privately, before connecting", async () => {
    const s = await serve((req, res) => {
      if (req.url === "/go") { res.writeHead(302, { location: `http://router.private:${(req.socket.localPort)}/admin` }); return res.end(); }
      res.end("reached");
    });
    await expect(safeFetch(s.url("shop.coffee", "/go"), net)).rejects.toBeInstanceOf(UnsafeAddressError);
    expect(s.seen).toEqual(["shop.coffee/go"]);
  });

  it("refuses a name if any of its addresses is private (DNS rebinding with mixed answers)", async () => {
    const s = await serve((_, res) => res.end("reached"));
    const mixed = async () => [{ address: LOCAL, family: 4 }, { address: "192.168.0.1", family: 4 }];
    await expect(safeFetch(s.url("shop.coffee"), { resolve: mixed, allowAddress: allowLocal })).rejects.toBeInstanceOf(UnsafeAddressError);
    expect(s.seen).toEqual([]);
  });

  it("uses the real address rules by default: the loopback test server itself is refused", async () => {
    const s = await serve((_, res) => res.end("reached"));
    await expect(safeFetch(s.url("shop.coffee"), { resolve })).rejects.toBeInstanceOf(UnsafeAddressError);
    expect(s.seen).toEqual([]);
  });

  it("stops after too many redirects", async () => {
    const s = await serve((req, res) => { res.writeHead(302, { location: `/r${Number(req.url!.slice(2) || 0) + 1}` }); res.end(); });
    await expect(safeFetch(s.url("shop.coffee", "/r0"), { ...net, maxRedirects: 3 })).rejects.toThrow(/too many redirects/);
    expect(s.seen.length).toBe(4);
  });

  it("rejects a declared length over the limit without reading it", async () => {
    const s = await serve((_, res) => { res.writeHead(200, { "content-length": "5000" }); res.end("x".repeat(5000)); });
    await expect(safeFetch(s.url("shop.coffee"), { ...net, maxBytes: 1000 })).rejects.toThrow(/too large/);
  });

  it("aborts a chunked body as soon as it passes the limit", async () => {
    let written = 0, closed = false;
    const s = await serve((_, res) => {
      res.on("close", () => (closed = true));
      const tick = () => { if (closed || written > 1_000_000) return res.end(); res.write("x".repeat(1000)); written += 1000; setTimeout(tick, 2); };
      tick();
    });
    await expect(safeFetch(s.url("shop.coffee"), { ...net, maxBytes: 5000 })).rejects.toThrow(/too large/);
    await new Promise((r) => setTimeout(r, 100));
    expect(closed).toBe(true);
    expect(written).toBeLessThan(100_000);
  });

  it("counts the limit after decompression", async () => {
    const bomb = gzipSync(Buffer.alloc(200_000));
    const s = await serve((_, res) => { res.writeHead(200, { "content-encoding": "gzip", "content-length": String(bomb.length) }); res.end(bomb); });
    expect(bomb.length).toBeLessThan(5000);
    await expect(safeFetch(s.url("shop.coffee"), { ...net, maxBytes: 5000 })).rejects.toThrow(/too large/);
  });

  it("decompresses gzip within the limit", async () => {
    const s = await serve((_, res) => { res.writeHead(200, { "content-encoding": "gzip" }); res.end(gzipSync("roasted")); });
    expect((await safeFetch(s.url("shop.coffee"), net)).body.toString()).toBe("roasted");
  });

  it("gives up at the deadline when the server stalls", async () => {
    const s = await serve((_, res) => { res.writeHead(200); res.write("a"); /* never ends */ });
    const t = Date.now();
    await expect(safeFetch(s.url("shop.coffee"), { ...net, timeoutMs: 300 })).rejects.toThrow();
    expect(Date.now() - t).toBeLessThan(2000);
  });

  it("can return only the status, without reading the body", async () => {
    const s = await serve((_, res) => { res.writeHead(410); res.end("gone"); });
    const r = await safeFetch(s.url("shop.coffee"), { ...net, readBody: false });
    expect([r.status, r.body.length]).toEqual([410, 0]);
  });
});

describe("cacheImage", () => {
  it("refuses private addresses without making a request", async () => {
    expect(await cacheImage("http://169.254.169.254/latest/meta-data/")).toBeNull();
    expect(await cacheImage("http://[::ffff:127.0.0.1]:8080/x.png")).toBeNull();
  });
});
