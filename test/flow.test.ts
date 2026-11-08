import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../server/app.js";
import { ProviderChain } from "../server/llm/index.js";

// The Crema server is a stateless AI add-on: identify → recommend → dial-in,
// plus the /decaid proxy, exercised with the mock LLM and the mock machine.
const PORT = 18080 + Math.floor(Math.random() * 500);
let mock: ChildProcess;

beforeAll(async () => {
  mock = spawn("npx", ["tsx", "dev/mock-decaid.ts"], { env: { ...process.env, PORT: String(PORT) }, stdio: "pipe" });
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("mock-decaid did not start")), 20000);
    mock.stdout!.on("data", (d) => {
      if (String(d).includes("mock-decaid on")) {
        clearTimeout(t);
        resolve();
      }
    });
  });
}, 30000);
afterAll(() => {
  mock?.kill();
});

const json = (body: unknown) => ({ method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });

describe("Crema server (AI add-on)", () => {
  const app = createApp({ llm: new ProviderChain(["mock"]), decaidUrl: `http://localhost:${PORT}` });

  it("describes itself", async () => {
    const cfg = await (await app.request("/api/config")).json();
    expect(cfg.ai).toBe(true);
    expect(cfg.providers[0].id).toBe("mock");
    expect(cfg.decaidWs).toBe(`ws://localhost:${PORT}/ws/v1/machine/snapshot`);
  });

  it("identifies, recommends and dials in without storing anything", async () => {
    const form = new FormData();
    form.set("query", "Example Roasters Kii AA");
    const { info } = await (await app.request("/api/identify", { method: "POST", body: form })).json();
    expect(info.name.value).toBe("Kii AA");

    const titles = ["Adaptive v2", "Londonium", "Default", "Extractamundo Dos!", "Rao Allongé"];
    const out = await (await app.request("/api/recommend", json({ bean: info, profileTitles: titles, preferences: { drink: "straight" } }))).json();
    expect(titles).toContain(out.recipe.profileTitle);
    expect(out.source).toBe("mock");
    expect(out.candidates.length).toBeGreaterThan(3);

    const { advice } = await (await app.request("/api/dialin", json({
      bean: info,
      recipe: out.recipe,
      shot: { timestamp: new Date().toISOString(), timeS: 22, doseG: 18, yieldG: 40 },
      feedback: { sourBitter: -1, body: 0, enjoyment: 6, notes: null },
    }))).json();
    expect(advice.grindDelta).toBe("finer");

    // Ratings are Decaid's 0–10 (half stars); an unrated shot sends null.
    const dial = (enjoyment: number | null) => app.request("/api/dialin", json({
      bean: info, recipe: out.recipe, shot: { timestamp: new Date().toISOString(), timeS: 30 },
      feedback: { sourBitter: 0, body: 0, enjoyment, notes: null },
    }));
    expect((await dial(10)).status).toBe(200);
    expect((await dial(null)).status).toBe(200);
    expect((await dial(11)).status).toBe(400);
  });

  it("rejects malformed requests with 400", async () => {
    expect((await app.request("/api/recommend", json({ bean: { name: "x" } }))).status).toBe(400);
    expect((await app.request("/api/images/cache", json({ url: "not a url" }))).status).toBe(400);
  });

  it("proxies Decaid for the phone app, and says so when it can't", async () => {
    const res = await app.request("/decaid/api/v1/machine/state");
    expect((await res.json()).state.state).toBeTruthy();
    const noDecaid = createApp({ llm: new ProviderChain(["mock"]) });
    expect((await noDecaid.request("/decaid/api/v1/machine/state")).status).toBe(503);
  });
});

describe("simulator shot ratings", () => {
  it("stores 0–10 as given and rejects what real Decaid rejects", async () => {
    const base = `http://localhost:${PORT}/api/v1`;
    await fetch(`${base}/machine/state/espresso`, { method: "PUT" });
    await new Promise((r) => setTimeout(r, 1500));
    await fetch(`${base}/machine/state/idle`, { method: "PUT" });
    const shot = await (await fetch(`${base}/shots/latest`)).json();
    expect(shot?.id).toBeTruthy();
    const rate = (enjoyment: unknown) => fetch(`${base}/shots/${encodeURIComponent(shot.id)}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ annotations: { enjoyment } }) });
    expect((await rate(7)).status).toBe(200);
    expect((await (await fetch(`${base}/shots/${encodeURIComponent(shot.id)}`)).json()).annotations.enjoyment).toBe(7);
    expect((await rate(11)).status).toBe(400);
    expect((await rate(null)).status).toBe(400);
  }, 10000);
});

describe("browser engine bundle", () => {
  it("skin/engine.js matches server/engine.ts", () => {
    expect(() => execFileSync("node", ["scripts/build-engine.mjs", "--check"], { stdio: "pipe" })).not.toThrow();
  });
});
