/**
 * A pretend DE1 + Decaid for development before the machine arrives.
 * Implements the slice of the Decaid REST/WebSocket API that Crema uses, and
 * simulates a shot (pressure/flow/weight curves) when espresso is requested.
 *
 *   npm run mock:decaid      # listens on :8080 like the real thing
 */
import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";

const PROFILE_TITLES = [
  "Adaptive v2",
  "Blooming espresso",
  "Londinium",
  "Default",
  "Best practice",
  "Extractamundo Dos!",
  "Gentle and sweet",
  "Cremina lever machine",
  "Turbo shot",
  "Allongé",
  "Damian's LRv3",
];
const profiles = PROFILE_TITLES.map((title, i) => ({
  id: `profile:${(i + 1).toString(16).padStart(16, "0")}`,
  profile: { version: "2", title, author: "Decent", notes: "", beverage_type: "espresso", steps: [], target_weight: 36, target_volume: 0, tank_temperature: 0 },
  visibility: "visible",
  isDefault: true,
}));

type Json = Record<string, any>;
const beans: Json[] = [];
const batches: Json[] = [];
const shots: Json[] = [];
let workflow: Json = {
  id: randomUUID(),
  name: "Crema",
  profile: profiles[0].profile,
  context: { targetDoseWeight: 18, targetYield: 36 },
};
let machine = { state: "idle", substate: "ready" };
let live: Json = { flow: 0, pressure: 0, weight: 0, mixTemperature: 93, groupTemperature: 93 };

function simulateShotSamples(target: number, seconds: number) {
  const samples: Json[] = [];
  const start = Date.now() - seconds * 1000;
  for (let t = 0; t <= seconds; t += 0.5) {
    const pi = t < 8;
    const pressure = pi ? Math.min(3, t * 0.6) : Math.max(5.5, 9 - (t - 8) * 0.12);
    const flow = pi ? 4 - t * 0.3 : 1.6 + Math.sin(t / 5) * 0.2;
    const weight = Math.max(0, Math.min(target, ((t - 6) / (seconds - 6)) * target));
    samples.push({
      machine: { timestamp: new Date(start + t * 1000).toISOString(), state: { state: "espresso", substate: pi ? "preinfusion" : "pouring" }, flow: +flow.toFixed(2), pressure: +pressure.toFixed(2), mixTemperature: 92.5 + Math.random() * 0.4 },
      scale: { timestamp: new Date(start + t * 1000).toISOString(), weight: +weight.toFixed(1), weightFlow: t > 6 ? +(target / (seconds - 6)).toFixed(2) : 0 },
    });
  }
  return samples;
}

function recordShot(seconds = 28 + Math.round(Math.random() * 6)) {
  const ctx = workflow.context ?? {};
  const shot = {
    id: `shot-${new Date().toISOString().replace(/[:.]/g, "-")}`,
    timestamp: new Date().toISOString(),
    measurements: simulateShotSamples(ctx.targetYield ?? 36, seconds),
    workflow: { name: workflow.name, profile: { title: workflow.profile?.title }, context: { ...ctx } },
    annotations: { actualDoseWeight: ctx.targetDoseWeight ?? 18, actualYield: +(ctx.targetYield ?? 36).toFixed(1) },
  };
  shots.unshift(shot);
  return shot;
}

function startShot() {
  if (machine.state === "espresso") return;
  machine = { state: "espresso", substate: "preinfusion" };
  const target = workflow.context?.targetYield ?? 36;
  const seconds = 30;
  let t = 0;
  const iv = setInterval(() => {
    t += 0.25;
    const pi = t < 8;
    machine.substate = pi ? "preinfusion" : "pouring";
    live = {
      pressure: pi ? Math.min(3, t * 0.6) : Math.max(5.5, 9 - (t - 8) * 0.12),
      flow: pi ? 4 - t * 0.3 : 1.6 + Math.sin(t / 5) * 0.2,
      weight: Math.max(0, Math.min(target, ((t - 6) / (seconds - 6)) * target)),
      mixTemperature: 92.6 + Math.random() * 0.3,
      groupTemperature: 92.8,
      elapsed: t,
    };
    if (t >= seconds) {
      clearInterval(iv);
      recordShot(seconds);
      machine = { state: "idle", substate: "ready" };
      live = { ...live, flow: 0, pressure: 0 };
    }
  }, 250);
}

// A little history so the UI isn't empty on first run.
for (let i = 0; i < 4; i++) {
  const s = recordShot();
  s.timestamp = new Date(Date.now() - (i + 1) * 864e5).toISOString();
}

async function body(req: IncomingMessage): Promise<Json> {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : {};
}

function send(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { "content-type": "application/json", "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" });
  res.end(JSON.stringify(data));
}

const server = createServer(async (req, res) => {
  if (req.method === "OPTIONS") return send(res, 204, {});
  const url = new URL(req.url ?? "/", "http://x");
  const p = url.pathname;
  const m = req.method;
  let match: RegExpMatchArray | null;
  try {
    if (m === "GET" && p === "/api/v1/profiles") return send(res, 200, profiles);
    if (m === "GET" && p === "/api/v1/beans") return send(res, 200, beans.filter((b) => !b.archived));
    if (m === "POST" && p === "/api/v1/beans") {
      const b = { id: randomUUID(), archived: false, createdAt: new Date().toISOString(), ...(await body(req)) };
      beans.push(b);
      return send(res, 201, b);
    }
    if ((match = p.match(/^\/api\/v1\/beans\/([^/]+)$/))) {
      const b = beans.find((x) => x.id === match![1]);
      if (!b) return send(res, 404, { error: "not found" });
      if (m === "PUT") Object.assign(b, await body(req));
      return send(res, 200, b);
    }
    if ((match = p.match(/^\/api\/v1\/beans\/([^/]+)\/batches$/))) {
      if (m === "POST") {
        const input = await body(req);
        const bt = { id: randomUUID(), beanId: match[1], weightRemaining: input.weight ?? null, frozen: false, ...input };
        batches.push(bt);
        return send(res, 201, bt);
      }
      return send(res, 200, batches.filter((b) => b.beanId === match![1]));
    }
    if (p === "/api/v1/workflow") {
      if (m === "PUT") {
        const patch = await body(req);
        workflow = { ...workflow, ...patch, context: { ...workflow.context, ...(patch.context ?? {}) } };
      }
      return send(res, 200, workflow);
    }
    if (p === "/api/v1/machine/state") {
      if (m === "PUT" || m === "POST") {
        const { state } = await body(req);
        if (state === "espresso") startShot();
        else machine = { state: state ?? "idle", substate: "ready" };
      }
      return send(res, 200, { ...machine, simulated: true });
    }
    if (m === "GET" && p === "/api/v1/shots") {
      const limit = Number(url.searchParams.get("limit") ?? 20);
      const batch = url.searchParams.get("beanBatchId");
      const items = shots.filter((s) => !batch || s.workflow.context.beanBatchId === batch);
      return send(res, 200, { items: items.slice(0, limit).map(({ measurements, ...rest }) => rest), total: items.length, limit, offset: 0 });
    }
    if (m === "GET" && p === "/api/v1/shots/latest") return send(res, 200, shots[0] ?? null);
    if ((match = p.match(/^\/api\/v1\/shots\/([^/]+)$/))) {
      const s = shots.find((x) => x.id === match![1]);
      if (!s) return send(res, 404, { error: "not found" });
      if (m === "PUT") {
        const patch = await body(req);
        s.annotations = { ...s.annotations, ...(patch.annotations ?? {}) };
      }
      return send(res, 200, s);
    }
    send(res, 404, { error: `mock-decaid has no ${m} ${p}` });
  } catch (e) {
    send(res, 500, { error: (e as Error).message });
  }
});

const wss = new WebSocketServer({ server, path: "/ws/v1/machine/snapshot" });
const clients = new Set<WebSocket>();
wss.on("connection", (ws) => {
  clients.add(ws);
  ws.on("close", () => clients.delete(ws));
});
setInterval(() => {
  const snap = JSON.stringify({
    timestamp: new Date().toISOString(),
    state: machine,
    flow: live.flow,
    pressure: live.pressure,
    weight: live.weight,
    elapsed: live.elapsed ?? 0,
    mixTemperature: live.mixTemperature,
    groupTemperature: live.groupTemperature,
    targetMixTemperature: 93,
    steamTemperature: 140,
    simulated: true,
  });
  for (const c of clients) c.send(snap);
}, 250);

const port = Number(process.env.PORT ?? 8080);
server.listen(port, () => console.log(`mock-decaid on http://localhost:${port} (POST /api/v1/machine/state {"state":"espresso"} pulls a shot)`));
