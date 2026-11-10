/**
 * A pretend DE1 + scale + Decaid for development before the machine arrives.
 * Implements the slice of the Decaid REST/WebSocket API that Crema uses:
 * espresso, steam, hot water and flush with live telemetry; a scale with tare;
 * the water tank; machine and shot settings; sleep, wake schedules and
 * presence; display brightness; beans, batches, profiles, workflow and shots;
 * the plugin list, including Time To Ready's WebSocket; and the device list
 * (REST and ws/v1/devices), with dev routes to drop and reconnect the machine.
 *
 *   npm run mock:decaid      # listens on :8080 like the real thing
 *   curl -X PUT localhost:8080/api/v1/machine/state/espresso
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { findProfile } from "../server/profiles/catalog.js";
import { outlineProfile, shotSim } from "../server/profiles/curve.js";

type Json = Record<string, any>;

// Titles as bundled with Decaid (assets/defaultProfiles), the espresso ones.
const PROFILE_TITLES = [
  "Adaptive v2", "Adaptive v3", "Best practice (light roast)", "Gagné/Adaptive Shot 92C v1.0", "Gagné/Adaptive Allongé 94C v1.0",
  "Blooming Espresso", "Easy blooming - active pressure decline", "Rao Allongé", "Blooming Allongé", "Extractamundo Dos!",
  "TurboBloom", "TurboTurbo", "D-Flow / default", "Damian's Q", "A-Flow / default-light", "A-Flow / default-medium",
  "A-Flow / default-dark", "A-Flow / default-very-dark", "Londonium", "Damian's LRv2", "Damian's LRv3", "Damian's LM Leva",
  "80's Espresso", "Espresso Forge Dark", "Espresso Forge Light", "Classic Italian espresso", "Default", "Gentle and sweet",
  "Flow profile for milky drinks", "Flow profile for straight espresso", "Trendy 6 bar low pressure shot", "I got your back",
  "Cremina lever machine", "Traditional lever machine", "Baseline • Medium Contact • 6 Bar", "7g basket",
];
const profiles = PROFILE_TITLES.map((title, i) => ({
  id: `profile:${(i + 1).toString(16).padStart(16, "0")}`,
  // Crema's simplified step outline for the profile's style, not Decaid's file.
  profile: { ...outlineProfile(title, findProfile(title)?.style ?? "flat-pressure", findProfile(title)?.recipe.tempC ?? 92, findProfile(title)?.recipe.yieldG ?? 36), tank_temperature: 0 },
  visibility: "visible",
  isDefault: true,
}));

// Decaid 0.9.1 bundled profile data; used only by the simulators/demo.
profiles.push(...JSON.parse(readFileSync(new URL("../samples/manual-profiles.json", import.meta.url), "utf8")).map((profile: Json, i: number) => ({ id: `manual-${i}`, profile, visibility: "visible", isDefault: true })));

const beans: Json[] = [];
const kv: Record<string, Record<string, unknown>> = {};
const batches: Json[] = [];
const grinders: Json[] = [];
const shots: Json[] = [];
let shotSettings: Json = { steamSetting: 0, targetSteamTemp: 150, targetSteamDuration: 45, targetHotWaterTemp: 85, targetHotWaterVolume: 120, targetHotWaterDuration: 60, targetShotVolume: 36, groupTemp: 92 };
let settings: Json = { usb: false, fan: 50, flushTemp: 88, flushFlow: 6.0, flushTimeout: 5, hotWaterFlow: 6.0, steamFlow: 1.5, tankTemp: 0 };
let workflow: Json = {
  id: randomUUID(), name: "Crema", profile: profiles[0].profile, context: { targetDoseWeight: 18, targetYield: 36 },
  // Like Decaid, the workflow carries steam, hot water and flush, and sends them to the
  // machine when they change (applyWorkflowSettings). A direct shot-settings write
  // doesn't flow back into the workflow.
  steamSettings: { targetTemperature: shotSettings.targetSteamTemp, duration: shotSettings.targetSteamDuration, flow: settings.steamFlow, stopAtTemperature: 0 },
  hotWaterData: { targetTemperature: shotSettings.targetHotWaterTemp, duration: shotSettings.targetHotWaterDuration, volume: shotSettings.targetHotWaterVolume, flow: settings.hotWaterFlow },
  rinseData: { targetTemperature: settings.flushTemp, duration: settings.flushTimeout, flow: settings.flushFlow },
};
function applyWorkflowSettings() {
  const { steamSettings: st, hotWaterData: hw, rinseData: r } = workflow;
  shotSettings = { ...shotSettings, targetSteamTemp: st.targetTemperature, targetSteamDuration: st.duration, targetHotWaterTemp: hw.targetTemperature, targetHotWaterVolume: hw.volume, targetHotWaterDuration: hw.duration };
  settings = { ...settings, steamFlow: st.flow, hotWaterFlow: hw.flow, flushTimeout: r.duration, flushFlow: r.flow, flushTemp: r.targetTemperature };
}
let presence: Json = { userPresenceEnabled: true, sleepTimeoutMinutes: 30 };
const schedules: Json[] = [{ id: randomUUID(), time: "06:45", daysOfWeek: [1, 2, 3, 4, 5], enabled: true }];
let display: Json = { wakeLockEnabled: true, wakeLockOverride: false, brightness: 80, requestedBrightness: 80, lowBatteryBrightnessActive: false, platformSupported: { brightness: true, wakeLock: true } };

// ---------------- the simulated machine ----------------
const sim = {
  state: "idle",
  substate: "idle",
  group: 92.8,
  steamTemp: 150,
  water: 58, // mm in the tank, like the DE1's level sensor
  refill: 7,
  scaleConnected: true,
  // Decaid can be up while its DE1 isn't (Bluetooth drop, power cycle). Then the
  // machine sockets stay open but send nothing, and ws/v1/devices says so.
  machineConnected: true,
  connectionError: null as Json | null,
  scaleWeight: 0,
  scaleOffset: 0,
  scaleBattery: 86,
  live: { pressure: 0, flow: 0, targetPressure: 0, targetFlow: 0, elapsed: 0, profileFrame: 0 } as Json,
  timer: null as NodeJS.Timeout | null,
  samples: [] as Json[],
  lastActive: Date.now(),
};


function stop(next = "idle") {
  if (sim.timer) clearInterval(sim.timer);
  sim.timer = null;
  if (sim.state === "espresso" && sim.samples.length > 10) recordShot();
  sim.state = next;
  sim.substate = next === "idle" ? "idle" : next;
  sim.live = { pressure: 0, flow: 0, targetPressure: 0, targetFlow: 0, elapsed: 0, profileFrame: 0 };
}

function run(state: string) {
  if (sim.state === "sleeping" && state !== "idle") return;
  if (sim.water <= sim.refill) {
    sim.state = "needsWater";
    return;
  }
  if (sim.timer) stop();
  sim.state = state;
  sim.lastActive = Date.now();
  sim.samples = [];
  const ctx = workflow.context ?? {};
  const target = Number(ctx.targetYield ?? 36);
  // The puck follows the loaded profile's steps; resistance varies like grind does.
  const puck = state === "espresso" ? shotSim(workflow.profile ?? {}, { resistance: 0.9 + Math.random() * 0.2 }) : null;
  const limit =
    state === "steam" ? Number(shotSettings.targetSteamDuration || 600) :
    state === "hotWater" ? Number(shotSettings.targetHotWaterVolume) / Number(settings.hotWaterFlow || 6) :
    state === "flush" ? Number(settings.flushTimeout) : 120;
  let t = 0;
  if (state === "espresso") sim.scaleOffset = sim.scaleWeight; // auto-tare
  sim.timer = setInterval(() => {
    t += 0.1;
    let p = 0, f = 0;
    if (state === "espresso") {
      const before = sim.samples.at(-1)?.cup ?? 0;
      const s = puck!.tick(0.1);
      p = s.p; f = s.f;
      sim.scaleWeight += s.w - before;
      sim.substate = s.w < 0.5 ? "preinfusion" : "pouring";
      sim.live = { pressure: p, flow: f, targetPressure: s.tp ?? 0, targetFlow: s.tf ?? 0, elapsed: t, profileFrame: s.frame };
      sim.samples.push({ t, p, f, w: sim.scaleWeight - sim.scaleOffset, cup: s.w, temp: sim.group, tp: s.tp ?? 0, tf: s.tf ?? 0, frame: s.frame });
      // stop at weight, with the usual lag
      if ((target > 0 && sim.scaleWeight - sim.scaleOffset >= target - 1.2) || (puck!.done && workflow.profile?.beverage_type !== "manual") || t >= 120) {
        sim.substate = "pouringDone";
        return stop();
      }
    } else if (state === "steam") {
      p = 1.8 + Math.random() * 0.2; f = Number(settings.steamFlow);
      sim.steamTemp = Math.max(135, sim.steamTemp - 0.05);
      sim.substate = "pouring";
    } else if (state === "hotWater") {
      f = Number(settings.hotWaterFlow); p = 0.4;
      sim.scaleWeight += f * 0.1;
    } else if (state === "flush") {
      f = Number(settings.flushFlow); p = 0.3;
    }
    sim.water = Math.max(0, sim.water - (f * 0.1) / 40);
    sim.live = { ...sim.live, pressure: p, flow: f, elapsed: t };
    if (state !== "espresso" && t >= limit) stop();
  }, 100);
}

function recordShot() {
  const ctx = workflow.context ?? {};
  const start = Date.now() - sim.samples.length * 100;
  const shot = {
    id: `shot-${new Date().toISOString().replace(/[:.]/g, "-")}`,
    timestamp: new Date().toISOString(),
    measurements: sim.samples.filter((_, i) => i % 2 === 0).map((s) => ({
      machine: { timestamp: new Date(start + s.t * 1000).toISOString(), state: { state: "espresso", substate: "pouring" }, flow: +s.f.toFixed(2), pressure: +s.p.toFixed(2), targetFlow: s.tf, targetPressure: s.tp, profileFrame: s.frame, mixTemperature: +s.temp.toFixed(1) },
      scale: { timestamp: new Date(start + s.t * 1000).toISOString(), weight: +s.w.toFixed(1) },
    })),
    workflow: { name: workflow.name, profile: structuredClone(workflow.profile), context: { ...ctx } },
    annotations: { actualDoseWeight: ctx.targetDoseWeight ?? 18, actualYield: +(sim.scaleWeight - sim.scaleOffset).toFixed(1) },
  };
  shots.unshift(shot);
  return shot;
}

// Idle drift and auto-sleep.
setInterval(() => {
  if (sim.state === "sleeping") {
    sim.group = Math.max(25, sim.group - 0.05);
    return;
  }
  if (sim.state === "heating") {
    sim.group = Math.min(92.8, sim.group + 0.6);
    if (sim.group >= 92.8) sim.state = "idle";
  } else if (sim.state === "idle") sim.group = 92.6 + Math.random() * 0.3;
  if (presence.userPresenceEnabled && presence.sleepTimeoutMinutes > 0 && sim.state === "idle" && Date.now() - sim.lastActive > presence.sleepTimeoutMinutes * 60_000) sim.state = "sleeping";
  if (sim.state !== "steam") sim.steamTemp = Math.min(150, sim.steamTemp + 0.2);
}, 1000);

// A little history so the UI isn't empty on first run.
for (let i = 0; i < 5; i++) {
  workflow.profile = profiles[i % 3].profile;
  const target = 36 + i * 2;
  sim.samples = [];
  let w = 0;
  for (let t = 0; t < 30 + i; t += 0.2) {
    const p = t < 7 ? Math.min(3, t * 0.7) : t < 9 ? 3 + (t - 7) * 3 : Math.max(5.5, 9 - (t - 9) * 0.13);
    const f = t < 7 ? Math.max(1, 4 - t * 0.45) : 1.7 + (t - 7) * 0.025;
    if (t > 6) w = Math.min(target, w + f * 0.2 * 0.93);
    sim.samples.push({ t, p, f, w, temp: 92.4 });
  }
  sim.scaleWeight = target; sim.scaleOffset = 0;
  workflow.context = { targetDoseWeight: 18, targetYield: target };
  recordShot().timestamp = new Date(Date.now() - (i + 1) * 864e5).toISOString();
}
workflow.profile = profiles[0].profile;
sim.samples = []; sim.scaleWeight = 0; sim.scaleOffset = 0;

// ---------------- HTTP ----------------
async function body(req: IncomingMessage): Promise<Json> {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : {};
}

function send(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { "content-type": "application/json", "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" });
  res.end(status === 204 ? undefined : JSON.stringify(data));
}

const snapshot = () => ({
  timestamp: new Date().toISOString(),
  state: { state: sim.state, substate: sim.substate },
  flow: +sim.live.flow.toFixed(2),
  pressure: +sim.live.pressure.toFixed(2),
  targetFlow: sim.live.targetFlow,
  targetPressure: sim.live.targetPressure,
  mixTemperature: +(sim.group + (sim.state === "espresso" ? -0.3 : 0)).toFixed(1),
  groupTemperature: +sim.group.toFixed(1),
  targetMixTemperature: 92.8,
  targetGroupTemperature: 92.8,
  profileFrame: sim.live.profileFrame,
  steamTemperature: +sim.steamTemp.toFixed(1),
  // Not in Decaid's snapshot: the elapsed time of the current operation, so
  // a client can tell how long it's been running.
  elapsed: +sim.live.elapsed.toFixed(1),
  simulated: true,
});

const server = createServer(async (req, res) => {
  if (req.method === "OPTIONS") return send(res, 204, {});
  const url = new URL(req.url ?? "/", "http://x");
  const p = url.pathname;
  const m = req.method;
  let match: RegExpMatchArray | null;
  try {
    // devices
    if (m === "GET" && p === "/api/v1/devices") return send(res, 200, devices().devices);
    // dev helpers: drop or reconnect the machine, raise or clear a connection error
    if (m === "POST" && p === "/dev/machine/disconnect") {
      if (sim.timer) stop("idle");
      sim.machineConnected = false;
      sim.connectionError = connectionError("machineDisconnected", "error", "The DE1 disconnected.", "Retry scan.");
      return devicesChanged(res);
    }
    if (m === "POST" && p === "/dev/machine/connect") {
      sim.machineConnected = true;
      sim.connectionError = null;
      return devicesChanged(res);
    }
    // Like older Decaid after a machine swap: open machine sockets go quiet, new ones work.
    if (m === "POST" && p === "/dev/machine/freeze-sockets") {
      for (const ws of liveSockets) if (ws.path.startsWith("/ws/v1/machine/")) ws.frozen = true;
      return send(res, 200, { ok: true });
    }
    // A flaky link: close every machine socket now, and optionally refuse new ones until told
    // otherwise ({ refuse: false }), so a shot can finish while the app is away.
    if (m === "POST" && p === "/dev/sockets/drop") {
      const b = await body(req);
      if (b.refuse !== undefined) refuseSockets = !!b.refuse;
      if (b.drop !== false) for (const ws of liveSockets) if (ws.path.startsWith("/ws/v1/machine/")) ws.terminate();
      return send(res, 200, { ok: true, refusing: refuseSockets });
    }
    if (m === "GET" && p === "/dev/sockets") {
      const counts: Record<string, number> = {};
      for (const ws of liveSockets) counts[ws.path] = (counts[ws.path] ?? 0) + 1;
      return send(res, 200, counts);
    }
    if (m === "POST" && p === "/dev/connection-error") {
      const b = await body(req);
      sim.connectionError = b.kind ? connectionError(b.kind, b.severity ?? "error", b.message ?? b.kind, b.suggestion ?? null) : null;
      return devicesChanged(res);
    }
    // machine
    if (p.startsWith("/api/v1/machine/") && !sim.machineConnected && m !== "GET") return send(res, 503, { error: "No machine connected" });
    if (m === "GET" && p === "/api/v1/machine/state") return send(res, 200, snapshot());
    if (m === "GET" && p === "/api/v1/machine/info") return send(res, 200, { model: "DE1+ (simulated)", serialNumber: "SIM-0001", GHC: true, firmwareVersion: "1352" });
    if ((match = p.match(/^\/api\/v1\/machine\/state\/(\w+)$/)) && m === "PUT") {
      const next = match[1];
      sim.lastActive = Date.now();
      if (next === "idle") {
        if (sim.state === "sleeping") sim.state = "heating";
        else stop("idle");
      } else if (next === "sleeping") {
        stop("sleeping");
      } else if (["espresso", "steam", "hotWater", "flush"].includes(next)) run(next);
      else return send(res, 400, { error: `unsupported state ${next}` });
      return send(res, 200, snapshot());
    }
    // Older Crema/mock form, kept for the tests: PUT /machine/state {state}
    if (p === "/api/v1/machine/state" && (m === "PUT" || m === "POST")) {
      const { state } = await body(req);
      if (state === "espresso") run("espresso");
      return send(res, 200, snapshot());
    }
    // Like Decaid 0.9.1: no GET (read ws/v1/machine/shotSettings instead), and a
    // write must carry every field; a partial one fails with a 500.
    if (p === "/api/v1/machine/shotSettings" && m === "POST") {
      const next = (await body(req)) as Json;
      const missing = Object.keys(shotSettings).filter((k) => next[k] === undefined || next[k] === null);
      if (missing.length) return send(res, 500, { error: `type 'Null' is not a subtype of type 'String' (missing ${missing.join(", ")})` });
      shotSettings = { ...next };
      return send(res, 200, null);
    }
    if (p === "/api/v1/machine/settings") {
      if (m === "POST") settings = { ...settings, ...(await body(req)) };
      return send(res, 200, settings);
    }
    if (p === "/api/v1/machine/waterLevels") {
      if (m === "POST") {
        const b = await body(req);
        if (typeof b.refillLevel !== "number" || !Number.isFinite(b.refillLevel)) return send(res, 400, { error: "refillLevel must be a number in mm" });
        sim.refill = Math.trunc(b.refillLevel);
      }
      return send(res, 200, { currentLevel: Math.round(sim.water), refillLevel: sim.refill });
    }
    if (p === "/api/v1/machine/heartbeat" && m === "POST") {
      sim.lastActive = Date.now();
      return send(res, 200, { timeout: presence.userPresenceEnabled ? presence.sleepTimeoutMinutes * 60 : -1 });
    }
    if (m === "PUT" && p === "/api/v1/scale/tare") {
      if (!sim.scaleConnected) return send(res, 404, { error: "no scale" });
      sim.scaleOffset = sim.scaleWeight;
      return send(res, 200, { ok: true });
    }
    // demo helper: refill the tank
    if (m === "POST" && p === "/dev/refill") {
      sim.water = 58;
      if (sim.state === "needsWater") sim.state = "idle";
      return send(res, 200, { ok: true });
    }
    // presence & display
    if (p === "/api/v1/presence/settings") {
      if (m === "POST") {
        const b = await body(req);
        if (("sleepTimeoutMinutes" in b && !Number.isInteger(b.sleepTimeoutMinutes)) || ("userPresenceEnabled" in b && typeof b.userPresenceEnabled !== "boolean")) return send(res, 400, { error: "Invalid presence setting" });
        if ("sleepTimeoutMinutes" in b) b.sleepTimeoutMinutes = Math.max(0, Math.min(240, b.sleepTimeoutMinutes));
        presence = { ...presence, ...b };
      }
      return send(res, 200, { ...presence, schedules });
    }
    if (p === "/api/v1/presence/schedules") {
      if (m === "POST") {
        const b = await body(req);
        const s = { id: randomUUID(), time: b.time ?? `${String(b.hour).padStart(2, "0")}:${String(b.minute).padStart(2, "0")}`, daysOfWeek: b.daysOfWeek ?? [], enabled: b.enabled ?? true };
        schedules.push(s);
        return send(res, 201, s);
      }
      return send(res, 200, schedules);
    }
    if ((match = p.match(/^\/api\/v1\/presence\/schedules\/([^/]+)$/))) {
      const i = schedules.findIndex((s) => s.id === match![1]);
      if (i < 0) return send(res, 404, { error: "not found" });
      if (m === "DELETE") { schedules.splice(i, 1); return send(res, 200, { ok: true }); }
      if (m === "PUT") Object.assign(schedules[i], await body(req));
      return send(res, 200, schedules[i]);
    }
    if (p === "/api/v1/display") return send(res, 200, display);
    if (p === "/api/v1/display/brightness" && m === "PUT") {
      const { brightness } = await body(req);
      display = { ...display, brightness, requestedBrightness: brightness };
      return send(res, 200, display);
    }
    if (p === "/api/v1/plugins") {
      return send(res, 200, [
        { id: "visualizer.reaplugin", name: "Visualizer upload", version: "1.5.11", settings: { Username: { type: "string" }, Password: { type: "string", secure: true }, AutoUpload: { type: "boolean" } } },
        { id: "time-to-ready.reaplugin", name: "Time To Ready", version: "1.0.4", api: [{ id: "timeToReady", type: "websocket" }] },
        { id: "decent-profile.reaplugin", name: "Decent Profile Generator", version: "1.1.2" },
      ]);
    }
    // key-value store (Crema keeps its records and settings here)
    if ((match = p.match(/^\/api\/v1\/store\/([^/]+)$/)) && m === "GET") {
      return send(res, 200, Object.keys(kv[decodeURIComponent(match[1])] ?? {}));
    }
    if ((match = p.match(/^\/api\/v1\/store\/([^/]+)\/([^/]+)$/))) {
      const ns = decodeURIComponent(match[1]), key = decodeURIComponent(match[2]);
      kv[ns] ??= {};
      if (m === "POST") { kv[ns][key] = await body(req); return send(res, 200, kv[ns][key]); }
      if (m === "DELETE") { const had = key in kv[ns]; delete kv[ns][key]; return send(res, 200, { deleted: had }); }
      // Decaid 0.9.1 answers a missing key with 200 and null, although its docs say 404.
      if (!(key in kv[ns])) return send(res, 200, null);
      return send(res, 200, kv[ns][key]);
    }
    // library
    if (m === "GET" && p === "/api/v1/profiles") return send(res, 200, profiles);
    if (m === "GET" && p === "/api/v1/beans") return send(res, 200, beans.filter((b) => url.searchParams.get("includeArchived") === "true" || !b.archived));
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
        const bt = { id: randomUUID(), beanId: match[1], weightRemaining: input.weight ?? null, frozen: false, archived: false, createdAt: new Date().toISOString(), ...input };
        batches.push(bt);
        return send(res, 201, bt);
      }
      // Like Decaid: archived (finished) bags are left out unless asked for.
      const all = url.searchParams.get("includeArchived") === "true";
      return send(res, 200, batches.filter((b) => b.beanId === match![1] && (all || !b.archived)));
    }
    if ((match = p.match(/^\/api\/v1\/bean-batches\/([^/]+)$/))) {
      const bt = batches.find((x) => x.id === match![1]);
      if (!bt) return send(res, 404, { error: "not found" });
      if (m === "PUT") Object.assign(bt, await body(req));
      return send(res, 200, bt);
    }
    if (p === "/api/v1/grinders") {
      if (m === "POST") {
        const g = { id: randomUUID(), archived: false, ...(await body(req)) };
        grinders.push(g);
        return send(res, 201, g);
      }
      return send(res, 200, grinders);
    }
    if (p === "/api/v1/workflow") {
      if (m === "PUT") {
        const patch = await body(req);
        const groups = ["steamSettings", "hotWaterData", "rinseData"] as const;
        // Decaid rejects a wrong type with a 400 but accepts any number.
        for (const g of groups) for (const v of Object.values(patch[g] ?? {})) if (typeof v !== "number") return send(res, 400, { error: `${g} values must be numbers` });
        if (patch.context === null || (patch.context && "targetYield" in patch.context && (typeof patch.context.targetYield !== "number" || !Number.isFinite(patch.context.targetYield)))) return send(res, 400, { error: "targetYield must be a number; use 0 to disable" });
        const before = workflow;
        workflow = { ...workflow, ...patch, context: { ...workflow.context, ...(patch.context ?? {}) } };
        for (const g of groups) if (patch[g]) workflow[g] = { ...before[g], ...patch[g] }; // fields merge, like Decaid
        if (groups.some((g) => patch[g])) applyWorkflowSettings();
      }
      return send(res, 200, workflow);
    }
    // Like Decaid 0.9.1: newest first, at most 100 per page, and the reply echoes the
    // limit that was asked for even when it gave fewer (so a client can't trust it).
    if (m === "GET" && p === "/api/v1/shots") {
      const asked = Number(url.searchParams.get("limit") ?? 20);
      const offset = Number(url.searchParams.get("offset") ?? 0);
      const batch = url.searchParams.get("beanBatchId");
      const items = shots.filter((s) => !batch || s.workflow.context.beanBatchId === batch);
      const page = items.slice(offset, offset + Math.min(asked, 100));
      return send(res, 200, { items: page.map(({ measurements, ...rest }) => rest), total: items.length, limit: asked, offset });
    }
    if (m === "GET" && p === "/api/v1/shots/latest") {
      const { measurements, ...rest } = shots[0] ?? ({} as Json);
      return send(res, 200, shots[0] ? rest : null);
    }
    // dev helper: add `count` older shots (for paging tests), optionally for one bag
    if (m === "POST" && p === "/dev/shots/seed") {
      const b = await body(req);
      const oldest = shots.length ? Date.parse(shots[shots.length - 1].timestamp) : Date.now();
      for (let i = 1; i <= Number(b.count ?? 0); i++) {
        const t = new Date(oldest - i * 60000).toISOString();
        shots.push({
          id: `seed-${t.replace(/[:.]/g, "-")}`, timestamp: t,
          measurements: [{ machine: { timestamp: t, state: { state: "espresso", substate: "pouring" }, flow: 2, pressure: 9, mixTemperature: 93 }, scale: { timestamp: t, weight: 36 } }],
          workflow: { name: "Crema", profile: { title: b.profileTitle ?? "Adaptive v2" }, context: { targetDoseWeight: b.dose ?? 18, targetYield: 36, beanBatchId: b.batchId ?? null } },
          annotations: { actualDoseWeight: b.dose ?? 18, actualYield: 36 },
        });
      }
      return send(res, 200, { total: shots.length });
    }
    if ((match = p.match(/^\/api\/v1\/shots\/([^/]+)$/))) {
      const s = shots.find((x) => x.id === match![1]);
      if (!s) return send(res, 404, { error: "not found" });
      if (m === "PUT") {
        const patch = await body(req);
        // Like Decaid: enjoyment is a number from 0 to 10 (shots_handler.dart, _enjoymentRangeError).
        const e = patch.annotations?.enjoyment;
        if (patch.annotations && "enjoyment" in patch.annotations && (typeof e !== "number" || !(e >= 0 && e <= 10))) {
          return send(res, 400, { error: `annotations.enjoyment must be between 0 and 10, got ${e}` });
        }
        s.annotations = { ...s.annotations, ...(patch.annotations ?? {}) };
      }
      return send(res, 200, s);
    }
    send(res, 404, { error: `mock-decaid has no ${m} ${p}` });
  } catch (e) {
    send(res, 500, { error: (e as Error).message });
  }
});

// ---------------- devices ----------------
function connectionError(kind: string, severity: string, message: string, suggestion: string | null) {
  return { kind, severity, timestamp: new Date().toISOString(), deviceId: kind.startsWith("machine") ? "SIM-DE1" : null, deviceName: kind.startsWith("machine") ? "DE1" : null, message, suggestion, details: null };
}
function devices() {
  const list = [
    { name: "DE1", id: "SIM-DE1", state: sim.machineConnected ? "connected" : "disconnected", type: "machine", available: sim.machineConnected },
    ...(sim.scaleConnected ? [{ name: "Decent Scale", id: "SIM-SCALE", state: "connected", type: "scale", available: true, connectionRole: "primary" }] : []),
  ];
  return { timestamp: new Date().toISOString(), devices: list, scanning: false, connectionStatus: { phase: sim.machineConnected ? "ready" : "idle", foundMachines: [], foundScales: [], pendingAmbiguity: null, error: sim.connectionError } };
}
const devicesSockets = new Set<WebSocket>();
function devicesChanged(res: ServerResponse) {
  const frame = JSON.stringify(devices());
  for (const ws of devicesSockets) if (ws.readyState === ws.OPEN) ws.send(frame);
  return send(res, 200, devices());
}

// ---------------- WebSockets ----------------
const streams: Record<string, { hz: number; frame: () => unknown }> = {
  "/ws/v1/devices": { hz: 0, frame: () => devices() },
  "/ws/v1/machine/snapshot": { hz: 10, frame: snapshot },
  "/ws/v1/scale/snapshot": { hz: 5, frame: () => ({ timestamp: new Date().toISOString(), weight: +(sim.scaleWeight - sim.scaleOffset).toFixed(1), batteryLevel: sim.scaleBattery }) },
  "/ws/v1/machine/waterLevels": { hz: 1, frame: () => ({ currentLevel: Math.round(sim.water), refillLevel: sim.refill }) },
  "/ws/v1/machine/shotSettings": { hz: 0.5, frame: () => shotSettings },
  "/ws/v1/plugins/time-to-ready.reaplugin/timeToReady": {
    hz: 1,
    frame: () => sim.state === "heating"
      ? { status: "heating", remainingTimeMs: Math.max(0, ((92.8 - sim.group) / 0.6) * 1000), heatingRate: 0.6 }
      : { status: sim.state === "sleeping" ? "not_heating" : "reached", remainingTimeMs: 0 },
  },
};
let refuseSockets = false;
const wss = new WebSocketServer({ noServer: true });
const liveSockets = new Set<WebSocket & { path: string; frozen?: boolean }>();
server.on("upgrade", (req, socket, head) => {
  const path = new URL(req.url ?? "/", "http://x").pathname;
  const stream = streams[path];
  if (!stream || (refuseSockets && path.startsWith("/ws/v1/machine/"))) return socket.destroy();
  wss.handleUpgrade(req, socket, head, (raw: WebSocket) => {
    const ws = Object.assign(raw, { path, frozen: false });
    liveSockets.add(ws);
    ws.on("close", () => liveSockets.delete(ws));
    if (path === "/ws/v1/devices") {
      // Sent on connect and on every change, like Decaid's aggregator; no timer.
      devicesSockets.add(ws);
      ws.send(JSON.stringify(devices()));
      ws.on("close", () => devicesSockets.delete(ws));
      return;
    }
    if (path === "/ws/v1/scale/snapshot") ws.send(JSON.stringify({ status: "connected" }));
    // Machine sockets stay open while the machine is gone, but send nothing.
    const silent = () => ws.frozen || (path.startsWith("/ws/v1/machine/") && !sim.machineConnected);
    const tick = () => ws.readyState === ws.OPEN && !silent() && ws.send(JSON.stringify(stream.frame()));
    tick(); // Decaid sends the current value as soon as a client connects
    const iv = setInterval(tick, 1000 / stream.hz);
    ws.on("close", () => clearInterval(iv));
  });
});

const port = Number(process.env.PORT ?? 8080);
server.listen(port, () => console.log(`mock-decaid on http://localhost:${port} (PUT /api/v1/machine/state/espresso pulls a shot)`));
