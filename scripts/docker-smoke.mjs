// Builds the Crema server's Docker image and checks it starts and does its job:
// config, the web app, the Decaid proxy (against the simulator), identification
// with the mock AI, and a writable photo cache, running as a non-root user.
// No AI account or secret is needed.
//
//   node scripts/docker-smoke.mjs            # build, then test
//   node scripts/docker-smoke.mjs --no-build # test an image already built as crema-smoke
import { spawn, spawnSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const IMAGE = "crema-smoke";
const NAME = `crema-smoke-${process.pid}`;
const MOCK = 18900 + Math.floor(Math.random() * 50);
const PORT = 18960 + Math.floor(Math.random() * 30);
const base = `http://localhost:${PORT}`;

let failed = false;
const check = (ok, label, detail = "") => { console.log(`${ok ? "ok  " : "FAIL"} ${label}${ok || !detail ? "" : ` (${detail})`}`); if (!ok) failed = true; };
const docker = (args, opts = {}) => spawnSync("docker", args, { encoding: "utf8", ...opts });

let mock;
const cleanup = () => {
  docker(["rm", "-f", NAME]);
  if (mock) { try { process.kill(-mock.pid, "SIGTERM"); } catch {} }
};
process.on("exit", cleanup);

if (!process.argv.includes("--no-build")) {
  console.log("building the image…");
  const b = docker(["build", "-t", IMAGE, "."], { stdio: "inherit" });
  if (b.status !== 0) { console.error("docker build failed"); process.exit(1); }
}

// The simulated Decaid runs on the host; the container reaches it as host.docker.internal
// (Docker Desktop provides the name; on Linux, --add-host maps it to the host).
mock = spawn("npx", ["tsx", "dev/mock-decaid.ts"], { env: { ...process.env, PORT: String(MOCK) }, stdio: ["ignore", "pipe", "pipe"], detached: true });
await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error("the simulator didn't start")), 30000);
  mock.stdout.on("data", (d) => { if (String(d).includes("mock-decaid on")) { clearTimeout(t); resolve(); } });
});

const run = docker(["run", "-d", "--name", NAME, "-p", `${PORT}:8787`, "--add-host=host.docker.internal:host-gateway",
  "-e", "LLM_PROVIDERS=mock", "-e", `DECAID_URL=http://host.docker.internal:${MOCK}`, IMAGE]);
if (run.status !== 0) { console.error(run.stderr); process.exit(1); }

const get = async (path, opts) => { const r = await fetch(base + path, { ...opts, signal: AbortSignal.timeout(15000) }); return { status: r.status, type: r.headers.get("content-type") || "", text: await r.text() }; };
let up = false;
for (let i = 0; i < 60 && !up; i++) { try { up = (await get("/api/config")).status === 200; } catch {} if (!up) await sleep(500); }
check(up, "the container starts and answers on :8787", docker(["logs", NAME]).stdout.slice(-400));

if (up) {
  const cfg = JSON.parse((await get("/api/config")).text);
  check(cfg.crema === true && cfg.providers?.some((p) => p.id === "mock") && cfg.decaidUrl?.includes(String(MOCK)), "config reports the mock AI and the Decaid address", JSON.stringify(cfg));
  const page = await get("/");
  check(page.status === 200 && /<title>Crema/.test(page.text), "serves the web app at /");
  const js = await get("/app.js");
  check(js.status === 200 && /javascript/.test(js.type) && js.text.includes("makeLiveApi"), "serves the app's scripts", `${js.status} ${js.type}`);
  const proxied = await get("/decaid/api/v1/machine/info");
  check(proxied.status === 200 && /simulated/.test(proxied.text), "proxies /decaid/* to Decaid (the simulator)", `${proxied.status} ${proxied.text.slice(0, 120)}`);
  const form = new FormData(); form.set("query", "Example Roasters Kii AA");
  const id = await get("/api/identify", { method: "POST", body: form });
  let name = null; try { name = JSON.parse(id.text).info?.name?.value; } catch {}
  check(id.status === 200 && !!name, `identifies a coffee with the mock AI (${name})`, `${id.status} ${id.text.slice(0, 160)}`);
  const priv = await get("/api/images/cache", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: "http://169.254.169.254/latest/meta-data/" }) });
  check(priv.status === 502, "refuses to fetch a private address for the photo cache", String(priv.status));
  const who = docker(["exec", NAME, "sh", "-c", "id -u && mkdir -p /data/images && touch /data/images/.write-test && echo writable"]);
  const [uid, ok] = who.stdout.trim().split("\n");
  check(uid !== "0" && ok === "writable", `runs as a non-root user (uid ${uid}) with a writable /data`, who.stderr);
}

cleanup();
process.exit(failed ? 1 : 0);
