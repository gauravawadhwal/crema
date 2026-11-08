import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../server/app.js";
import { dropDeadLinks, identify, isRoasterSite, preferRoasterPages, resolveGroundingLinks, tidyConfirmations } from "../server/identify.js";
import { mockBean } from "../server/llm/mock.js";
import { ProviderChain } from "../server/llm/index.js";
import type { StructuredRequest } from "../server/llm/types.js";

// A provider chain that records what identify() asks for instead of calling a model.
function recorder() {
  const seen: StructuredRequest<any>[] = [];
  const llm = { structured: async (req: StructuredRequest<any>) => { seen.push(req); return mockBean(""); } } as unknown as ProviderChain;
  return { llm, seen };
}

describe("identifying from a description", () => {
  it("passes the description and today's date to the model, with web search on", async () => {
    const { llm, seen } = recorder();
    await identify(llm, { description: "on a coffee la fincona, roasted last tuesday, 250 grams", today: "2026-11-07" });
    expect(seen[0].prompt).toContain("Today is 2026-11-07.");
    expect(seen[0].prompt).toContain("on a coffee la fincona, roasted last tuesday, 250 grams");
    expect(seen[0].web).toBe(true);
    expect(seen[0].system).toMatch(/speech-to-text/);
  });

  it("leaves the date out of a plain search", async () => {
    const { llm, seen } = recorder();
    await identify(llm, { query: "Square Mile Red Brick" });
    expect(seen[0].prompt).not.toContain("Today is");
  });

  it("needs something to go on", async () => {
    const { llm } = recorder();
    await expect(identify(llm, {})).rejects.toThrow(/description/);
  });

  const app = createApp({ llm: new ProviderChain(["mock"]), decaidUrl: "http://localhost:1" });
  const post = (fields: Record<string, string>) => {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.set(k, v);
    return app.request("/api/identify", { method: "POST", body: form });
  };

  it("accepts a description on /api/identify", async () => {
    const res = await post({ description: "Example Roasters Kii AA, roasted on the 2nd", today: "2026-11-07" });
    expect(res.status).toBe(200);
    expect((await res.json()).info.name.value).toBe("Kii AA");
  });

  it("rejects an over-long description or a malformed date with 400", async () => {
    expect((await post({ description: "x".repeat(2001) })).status).toBe(400);
    expect((await post({ description: "Kii AA", today: "next week" })).status).toBe(400);
  });
});

describe("Gemini's grounding links", () => {
  afterEach(() => vi.unstubAllGlobals());
  const G = "https://vertexaisearch.cloud.google.com/grounding-api-redirect/";

  it("are replaced by the pages they point to, and dead ones dropped", async () => {
    const targets: Record<string, string | null> = {
      [`${G}a`]: "https://roaster.example/products/la-fincona",
      [`${G}b`]: "https://roaster.example/products/la-fincona",
      [`${G}c`]: null,
    };
    const fetch = vi.fn(async (u: string) => new Response(null, targets[u] ? { status: 302, headers: { location: targets[u]! } } : { status: 404 }));
    vi.stubGlobal("fetch", fetch);
    const info = { ...mockBean("light"), sources: [`${G}a`, `${G}b`, `${G}c`, "https://other.example/page"], productUrl: `${G}a` };
    const out = await resolveGroundingLinks(info);
    expect(out.sources).toEqual(["https://roaster.example/products/la-fincona", "https://other.example/page"]);
    expect(out.productUrl).toBe("https://roaster.example/products/la-fincona");
    expect(fetch.mock.calls.map((c) => c[0])).toEqual([`${G}a`, `${G}b`, `${G}c`]);   // only the redirect host
  });

  it("leave ordinary links alone without a network call", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const info = mockBean("light");
    expect(await resolveGroundingLinks(info)).toBe(info);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("the roaster's own site comes first", () => {
  it.each([
    ["https://onacoffee.com.au/product/la-fincona-honduras-washed/", "ONA Coffee", true],
    ["https://shop.onacoffee.com.au/x", "ONA", true],
    ["https://www.squaremilecoffee.com/shop/coffee/red-brick-espresso/", "Square Mile", true],
    ["https://thebarn.de/products/x", "The Barn", true],
    ["https://onyxcoffeelab.com/products/x", "Onyx Coffee Lab", true],
    ["https://www.lacabra.com/x", "La Cabra", true],
    ["https://specialitycoffee.ca/products/ona-coffee-la-fincona", "ONA Coffee", false],
    ["https://nationalcoffee.com/ona", "ONA Coffee", false],
    ["https://www.amazon.com.au/square-mile-red-brick", "Square Mile", false],
    ["https://squarespace.com/mile", "Square Mile", false],
    ["https://onacoffee.com.au/x", null, false],
  ])("%s is %s's site: %s", (url, roaster, own) => {
    expect(isRoasterSite(url, roaster)).toBe(own);
  });

  it("orders sources, trims other pages, and swaps a retailer product link for the roaster's", () => {
    const info = {
      ...mockBean("light"),
      roaster: { value: "ONA Coffee", source: "bag" as const },
      productUrl: "https://specialitycoffee.ca/products/ona-coffee-la-fincona",
      sources: [
        "https://specialitycoffee.ca/products/ona-coffee-la-fincona",
        "https://someblog.example/la-fincona-review",
        "https://onacoffee.com.au/blogs/brewguides/la-fincona-honduras-washed",
        "https://another.example/ona",
        "https://onacoffee.com.au/product/la-fincona-honduras-washed/",
      ],
    };
    const out = preferRoasterPages(info);
    expect(out.productUrl).toBe("https://onacoffee.com.au/product/la-fincona-honduras-washed/");
    expect(out.sources).toEqual([
      "https://onacoffee.com.au/blogs/brewguides/la-fincona-honduras-washed",
      "https://onacoffee.com.au/product/la-fincona-honduras-washed/",
      "https://specialitycoffee.ca/products/ona-coffee-la-fincona",
      "https://someblog.example/la-fincona-review",
    ]);
  });

  it("keeps a retailer when the roaster has no page, and up to four sources", () => {
    const sources = ["https://a.example/1", "https://b.example/2", "https://c.example/3", "https://d.example/4", "https://e.example/5"];
    const info = { ...mockBean("light"), roaster: { value: "Tiny Roasters", source: "bag" as const }, productUrl: sources[0], sources };
    const out = preferRoasterPages(info);
    expect(out.productUrl).toBe(sources[0]);
    expect(out.sources).toEqual(sources.slice(0, 4));
  });

  it("asks the model to search the roaster's own site first", async () => {
    const { llm, seen } = recorder();
    await identify(llm, { query: "ONA La Fincona" });
    expect(seen[0].system).toMatch(/official website/);
    expect(seen[0].system).toMatch(/site:<their domain>/);
    expect(seen[0].prompt).toMatch(/roaster's own website/);
  });
});

describe("Gemini replies for blends", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("joins a list given where text is expected, instead of failing the lookup", async () => {
    const { GeminiApiProvider } = await import("../server/llm/gemini-api.js");
    const { BeanInfo } = await import("../server/schema.js");
    const bean = { ...mockBean("blend"), country: { value: ["Brazil", "Colombia"], source: "web" }, process: { value: ["Natural", "Washed"], source: "web" } };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(bean) }] } }] }))));
    const out = await new GeminiApiProvider("k").structured({ system: "", prompt: "", schema: BeanInfo, schemaName: "BeanInfo", web: true });
    expect(out.country.value).toBe("Brazil, Colombia");
    expect(out.process.value).toBe("Natural, Washed");
    expect(out.variety.value).toEqual(bean.variety.value);   // real lists stay lists
  });
});

describe("dead links", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("drops pages the site says are gone, keeps the rest, and never fetches private addresses", async () => {
    const replies: Record<string, Response> = {
      "https://roaster.coffee/product/old": new Response(null, { status: 404 }),
      "https://roaster.coffee/coffee/moved": new Response(null, { status: 301, headers: { location: "https://shop.roaster.coffee/coffee/moved" } }),
      "https://shop.roaster.coffee/coffee/moved": new Response(null, { status: 404 }),
      "https://roaster.coffee/products/real": new Response(null, { status: 429 }),
      "https://retailer.shop/sneaky": new Response(null, { status: 302, headers: { location: "http://192.168.1.10/admin" } }),
    };
    const fetch = vi.fn(async (u: string) => replies[u] ?? new Response("ok"));
    vi.stubGlobal("fetch", fetch);
    const info = {
      ...mockBean("light"),
      productUrl: "https://roaster.coffee/product/old",
      sources: ["https://roaster.coffee/products/real", "https://roaster.coffee/coffee/moved", "https://retailer.shop/sneaky", "https://example.com/coffee"],
    };
    const out = await dropDeadLinks(info);
    expect(out.productUrl).toBeNull();
    expect(out.sources).toEqual(["https://roaster.coffee/products/real", "https://retailer.shop/sneaky", "https://example.com/coffee"]);
    const fetched = fetch.mock.calls.map((c) => c[0]);
    expect(fetched).not.toContain("http://192.168.1.10/admin");
    expect(fetched).not.toContain("https://example.com/coffee");
  });
});

describe("fields flagged for checking", () => {
  it("keeps guesses, drops fields that were simply not found, and always asks for a missing roast date", () => {
    const base = mockBean("light");
    const info = {
      ...base,
      name: { value: "La Fincona", source: "inferred" as const },          // corrected from "lafing kona"
      altitudeMasl: { value: null, source: null },                          // not found
      producer: { value: null, source: null },                              // not found
      roastLevel: { value: "light" as const, source: "web" as const },
      roastDate: { value: null, source: null },
      weightGrams: null,
      needsConfirmation: ["altitudeMasl", "producer", "weightGrams", "roastLevel", "notAField"],
    };
    expect(tidyConfirmations(info).needsConfirmation).toEqual(["roastLevel", "name", "roastDate"]);
  });

  it("keeps a flagged roast date even when one was worked out", () => {
    const info = { ...mockBean("light"), roastDate: { value: "2026-11-02", source: "bag" as const }, needsConfirmation: ["roastDate"] };
    expect(tidyConfirmations(info).needsConfirmation).toEqual(["roastDate", "roastLevel"]);
  });
});

describe("Gemini replies with numbers as text", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("turns plain numeric text into numbers, and leaves real text alone", async () => {
    const { GeminiApiProvider } = await import("../server/llm/gemini-api.js");
    const { BeanInfo } = await import("../server/schema.js");
    const bean = { ...mockBean("light"), altitudeMasl: { value: ["1,400", "1600"], source: "web" }, weightGrams: "250" };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(bean) }] } }] }))));
    const out = await new GeminiApiProvider("k").structured({ system: "", prompt: "", schema: BeanInfo, schemaName: "BeanInfo", web: true });
    expect(out.altitudeMasl.value).toEqual([1400, 1600]);
    expect(out.weightGrams).toBe(250);
  });

  it("still rejects text that isn't a number", async () => {
    const { GeminiApiProvider } = await import("../server/llm/gemini-api.js");
    const { BeanInfo } = await import("../server/schema.js");
    const bean = { ...mockBean("light"), weightGrams: "about a quarter kilo" };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(bean) }] } }] }))));
    await expect(new GeminiApiProvider("k").structured({ system: "", prompt: "", schema: BeanInfo, schemaName: "BeanInfo", web: true })).rejects.toThrow(/could not parse/);
  });
});
