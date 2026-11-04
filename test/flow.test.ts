import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../server/app.js";
import { DecaidClient } from "../server/decaid.js";
import { ProviderChain } from "../server/llm/index.js";
import { Store } from "../server/store.js";

// End-to-end: identify → save → recommend → apply → shot → feedback, against
// the mock Decaid process and the mock LLM provider.
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

describe("full flow", () => {
  it("adds a coffee, recommends, applies, and dials in", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "crema-test-"));
    const decaid = new DecaidClient(`http://localhost:${PORT}`);
    const app = createApp({ llm: new ProviderChain(["mock"]), decaid, store: new Store(path.join(dir, "crema.json")) });

    const form = new FormData();
    form.set("query", "Example Roasters Kii AA");
    const idRes = await app.request("/api/identify", { method: "POST", body: form });
    expect(idRes.status).toBe(200);
    const { info } = await idRes.json();
    expect(info.name.value).toBe("Kii AA");

    const saveRes = await app.request("/api/beans", { method: "POST", body: JSON.stringify({ info }), headers: { "content-type": "application/json" } });
    expect(saveRes.status).toBe(201);
    const rec = await saveRes.json();
    expect(rec.decaidBatchId).toBeTruthy();

    const shelf = await (await app.request("/api/shelf")).json();
    expect(shelf).toHaveLength(1);
    expect(shelf[0].rest.status).toBe("resting"); // mock roast date is 9 days ago; light rests 14+

    const recRes = await app.request("/api/recommend", { method: "POST", body: JSON.stringify({ beanId: rec.decaidBeanId }), headers: { "content-type": "application/json" } });
    const { recipe, source, candidates } = await recRes.json();
    expect(source).toBe("mock");
    expect(recipe.profileTitle).toBeTruthy();
    expect(candidates.length).toBeGreaterThan(3);
    expect(recipe.profileId).toMatch(/^profile:/);

    const applyRes = await app.request("/api/apply", { method: "POST", body: JSON.stringify({ beanId: rec.decaidBeanId }), headers: { "content-type": "application/json" } });
    const applied = await applyRes.json();
    expect(applied.workflow.context.beanBatchId).toBe(rec.decaidBatchId);
    expect(applied.workflow.profile.title).toBe(recipe.profileTitle);

    const shots = await (await app.request("/api/shots?limit=1")).json();
    const shotId = shots.items[0].id;
    const fbRes = await app.request(`/api/shots/${shotId}/feedback`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ beanId: rec.decaidBeanId, feedback: { sourBitter: -1, body: -1, enjoyment: 3, notes: "a bit sharp" } }),
    });
    const { advice } = await fbRes.json();
    expect(advice.grindDelta).toBe("finer");
    const shot = await decaid.shot(shotId);
    expect(shot.annotations?.enjoyment).toBe(3);
  }, 30000);
});
