import { describe, expect, it } from "vitest";
import { createApp } from "../server/app.js";
import { identify } from "../server/identify.js";
import { ProviderChain } from "../server/llm/index.js";
import type { StructuredRequest } from "../server/llm/types.js";

// A provider chain that records what identify() asks for instead of calling a model.
function recorder() {
  const seen: StructuredRequest<any>[] = [];
  const llm = { structured: async (req: StructuredRequest<any>) => { seen.push(req); return {}; } } as unknown as ProviderChain;
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
