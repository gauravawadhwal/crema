import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { createApp } from "./app.js";
import { ProviderChain } from "./llm/index.js";

const llm = ProviderChain.fromEnv();
const decaidUrl = process.env.DECAID_URL || null;
const app = createApp({ llm, decaidUrl });

// The web app, for phones. The tablet gets the same app as a Decaid skin.
app.use("/*", serveStatic({ root: "./skin" }));

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port, hostname: process.env.HOST ?? "0.0.0.0" }, () => {
  console.log(`crema on http://localhost:${port}`);
  console.log(`  AI providers: ${llm.providers.map((p) => p.id).join(" → ")}`);
  console.log(`  decaid proxy: ${decaidUrl ?? "off (set DECAID_URL to serve the phone app with machine control)"}`);
});
