import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createApp, MAX_PHOTOS, MAX_PHOTO_BYTES } from "../server/app.js";
import { ProviderChain } from "../server/llm/index.js";
import { dialInWithSource } from "../server/recommend/index.js";
import type { LlmProvider } from "../server/llm/types.js";

const app = () => createApp({ llm: new ProviderChain(["mock"]), decaidUrl: null, corsOrigins: "" });
const png = (bytes = 8) => new File([new Uint8Array(bytes)], "bag.png", { type: "image/png" });
const identify = (a: ReturnType<typeof app>, files: File[], headers: Record<string, string> = {}) => {
  const form = new FormData();
  form.set("query", "Kii AA");
  for (const f of files) form.append("images", f);
  return a.request("/api/identify", { method: "POST", body: form, headers });
};

describe("upload limits on /api/identify", () => {
  it("accepts up to four photos", async () => {
    expect((await identify(app(), Array.from({ length: MAX_PHOTOS }, () => png()))).status).toBe(200);
  });
  it("rejects more than four photos with 400", async () => {
    const res = await identify(app(), Array.from({ length: MAX_PHOTOS + 1 }, () => png()));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/at most 4/);
  });
  it("rejects an over-large body with 413 before reading it", async () => {
    const res = await app().request("/api/identify", {
      method: "POST",
      headers: { "content-type": "multipart/form-data; boundary=x", "content-length": String(500 * 1024 * 1024) },
      body: "--x--",
    });
    expect(res.status).toBe(413);
    expect((await res.json()).error).toMatch(/too large/);
  });
  it("rejects a single over-large photo with 413", async () => {
    const res = await identify(app(), [png(MAX_PHOTO_BYTES + 1)]);
    expect(res.status).toBe(413);
  });
});

describe("who may call /api/*", () => {
  const call = (origin: string | null, a = app(), host = "crema.test:8787") =>
    a.request("/api/config", { headers: { ...(origin ? { origin } : {}), host } });

  it("allows requests with no Origin (curl, same-origin GET)", async () => {
    expect((await call(null)).status).toBe(200);
  });
  it.each([
    "http://192.168.1.50:3000", // the skin served by Decaid on the tablet
    "http://decaid.local:3000",
    "http://localhost:19001", // development and scripts/e2e-live.cjs
    "http://127.0.0.1:5173",
    "http://crema.test:8787", // the server's own origin
  ])("allows %s", async (origin) => {
    const res = await call(origin);
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe(origin);
  });
  it.each(["https://example.com", "http://example.com", "http://192.168.1.50:8080", "https://192.168.1.50:3000", "null"])("refuses %s", async (origin) => {
    const res = await call(origin);
    expect(res.status).toBe(403);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });
  it("refuses a foreign page's POST before it spends an AI call", async () => {
    const res = await identify(app(), [], { origin: "https://example.com" });
    expect(res.status).toBe(403);
  });
  it("adds origins from CORS_ORIGINS, and * opens everything", async () => {
    const extra = createApp({ llm: new ProviderChain(["mock"]), corsOrigins: "https://crema.example.org, http://nas:9000/" });
    expect((await call("https://crema.example.org", extra)).status).toBe(200);
    expect((await call("http://nas:9000", extra)).status).toBe(200);
    expect((await call("https://example.com", extra)).status).toBe(403);
    const open = createApp({ llm: new ProviderChain(["mock"]), corsOrigins: "*" });
    expect((await call("https://example.com", open)).status).toBe(200);
  });
});

describe("provider reporting", () => {
  const slow = (id: "claude-cli" | "codex-cli", ms: number, fail = false): LlmProvider => ({
    id, billing: "test",
    async structured(req) {
      await new Promise((r) => setTimeout(r, ms));
      if (fail) throw new Error("nope");
      return req.schema.parse("ok") as never;
    },
  });
  const req = { system: "", prompt: "", schema: z.string(), schemaName: "S" };

  it("reports the provider with each result, even for simultaneous calls", async () => {
    // Every call to this chain falls through to codex-cli, except that the first one is slower.
    const chain = new ProviderChain([slow("claude-cli", 5, true), slow("codex-cli", 5)]);
    const solo = new ProviderChain([slow("claude-cli", 30)]);
    const [a, b] = await Promise.all([solo.structuredWithProvider(req), chain.structuredWithProvider(req)]);
    expect(a.provider).toBe("claude-cli");
    expect(b.provider).toBe("codex-cli");
    // The same chain, two overlapping calls with different winners.
    let n = 0;
    const flaky: LlmProvider = { id: "claude-cli", billing: "t", async structured(r) { const mine = n++; await new Promise((x) => setTimeout(x, mine ? 5 : 40)); if (mine) throw new Error("x"); return r.schema.parse("ok") as never; } };
    const both = new ProviderChain([flaky, slow("codex-cli", 1)]);
    const [first, second] = await Promise.all([both.structuredWithProvider(req), both.structuredWithProvider(req)]);
    expect([first.provider, second.provider]).toEqual(["claude-cli", "codex-cli"]);
  });
});

describe("errors", () => {
  afterEach(() => vi.restoreAllMocks());

  it("hides the detail of a 500 and logs it", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const boom: LlmProvider = { id: "mock", billing: "t", async structured() { throw new Error("secret path /home/someone/.claude"); } };
    const res = await createApp({ llm: new ProviderChain([boom]) }).request("/api/transcribe", { method: "POST", body: new FormData() });
    expect(res.status).toBeGreaterThanOrEqual(400);
    const bad = createApp({ llm: new ProviderChain([boom]) });
    const r = await bad.request("/api/identify", { method: "POST", body: (() => { const f = new FormData(); f.set("query", "x"); return f; })() });
    expect(r.status).toBe(500);
    expect(JSON.stringify(await r.json())).not.toContain("secret");
    expect(log).toHaveBeenCalled();
  });

  it("logs why dial-in fell back to rules", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const boom: LlmProvider = { id: "mock", billing: "t", async structured() { throw new Error("model down"); } };
    const { mockBean } = await import("../server/llm/mock.js");
    const out = await dialInWithSource(new ProviderChain([boom]), {
      bean: mockBean(""),
      recipe: { profileTitle: "x", targetTimeS: [25, 35], doseG: 18, yieldG: 36, grindDirection: null } as never,
      shot: { timestamp: "2026-11-01T00:00:00Z" },
      feedback: { sourBitter: 0, body: 0 } as never,
    });
    expect(out.source).toBe("rules");
    expect(warn.mock.calls.flat().join(" ")).toMatch(/dialin[\s\S]*model down/);
  });
});
