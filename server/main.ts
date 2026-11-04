import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { createApp } from "./app.js";
import { DecaidClient } from "./decaid.js";
import { ProviderChain } from "./llm/index.js";
import { Store } from "./store.js";

const llm = ProviderChain.fromEnv();
const decaid = new DecaidClient();
const app = createApp({ llm, decaid, store: new Store() });

// The same web app is the tablet skin and the iPhone companion (installable PWA).
app.use("/*", serveStatic({ root: "./skin" }));

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port, hostname: process.env.HOST ?? "0.0.0.0" }, () => {
  console.log(`crema on http://localhost:${port}`);
  console.log(`  providers: ${llm.providers.map((p) => p.id).join(" → ")}`);
  console.log(`  decaid:    ${decaid.baseUrl}`);
});
