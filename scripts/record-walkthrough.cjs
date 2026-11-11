// Records the walkthrough into docs/media/walkthrough.webp (the README
// animation) and docs/media/walkthrough.mp4. Needs Playwright and ffmpeg.
// WebP uses libwebp_anim when present, or an installed Python/Pillow encoder.
//
//   node scripts/build-site.mjs && node scripts/record-walkthrough.cjs
//
// Frames are captured one by one with timestamps instead of using Playwright's
// built-in video, which is too compressed (the tablet screenshots came out
// blocky). A GIF was tried and dropped: about 21 MB against about 5.6 MB for WebP.
const { chromium } = require("playwright");
const { execFileSync, spawnSync } = require("child_process");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");

const SITE = path.resolve(__dirname, "../_site");
const MEDIA = path.resolve(__dirname, "../docs/media");
const SLIDE_MS = 3400; // faster than the interactive 7.5 s per slide
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".png": "image/png", ".svg": "image/svg+xml", ".json": "application/json", ".webmanifest": "application/manifest+json" };

if (!fs.existsSync(path.join(SITE, "index.html"))) {
  console.error("Run node scripts/build-site.mjs first.");
  process.exit(1);
}

const server = http.createServer((req, res) => {
  let file = path.join(SITE, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (file.endsWith("/")) file += "index.html";
  if (!file.startsWith(SITE) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});

(async () => {
  await new Promise((r) => server.listen(0, r));
  const { port } = server.address();
  const frames = fs.mkdtempSync(path.join(os.tmpdir(), "crema-frames-"));
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1000, height: 620 } });
  await p.addInitScript((ms) => { window.REEL_DURATION = ms; }, SLIDE_MS);
  await p.goto(`http://localhost:${port}/`);
  await p.waitForTimeout(700);
  const slides = await p.evaluate(() => document.querySelectorAll(".bar").length);
  const total = slides * SLIDE_MS - 200, t0 = Date.now(), list = [];
  while (Date.now() - t0 < total) {
    const t = Date.now() - t0, f = path.join(frames, `f${String(list.length).padStart(4, "0")}.png`);
    await p.screenshot({ path: f });
    list.push({ f, t });
  }
  await b.close(); server.close();

  const concat = [];
  list.forEach((fr, i) => { concat.push(`file '${fr.f}'`, `duration ${(((list[i + 1]?.t ?? total) - fr.t) / 1000).toFixed(3)}`); });
  concat.push(`file '${list.at(-1).f}'`);
  const listFile = path.join(frames, "list.txt");
  fs.writeFileSync(listFile, concat.join("\n"));
  fs.mkdirSync(MEDIA, { recursive: true });
  const ff = (...a) => execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", listFile, ...a], { stdio: "inherit" });
  const encoders = execFileSync("ffmpeg", ["-hide_banner", "-encoders"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  if (/\blibwebp_anim\b/.test(encoders)) {
    ff("-vf", "fps=12,scale=900:-2:flags=lanczos", "-c:v", "libwebp_anim", "-lossless", "0", "-q:v", "92", "-compression_level", "6", "-loop", "0", path.join(MEDIA, "walkthrough.webp"));
  } else {
    // Some system ffmpeg builds omit WebP. Reuse an installed Pillow encoder when
    // available; no dependency installation or private image-format implementation.
    const python = [process.env.PYTHON, "python3", "/usr/bin/python3"].filter(Boolean).find(cmd =>
      spawnSync(cmd, ["-c", "from PIL import features; assert features.check('webp_anim')"], { stdio: "ignore" }).status === 0);
    if (!python) throw new Error("Recording WebP needs ffmpeg with libwebp_anim, or Python with Pillow WebP animation support.");
    const manifest = path.join(frames, "frames.json");
    fs.writeFileSync(manifest, JSON.stringify({ list, total, output: path.join(MEDIA, "walkthrough.webp") }));
    execFileSync(python, ["-c", `
import json, sys
from PIL import Image
with open(sys.argv[1]) as f: data = json.load(f)
selected = []
for frame in data['list']:
    if not selected or frame['t'] - selected[-1]['t'] >= 1000 / 12:
        selected.append(frame)
images, durations = [], []
for i, frame in enumerate(selected):
    with Image.open(frame['f']) as source:
        height = round(source.height * 900 / source.width / 2) * 2
        images.append(source.convert('RGB').resize((900, height), Image.Resampling.LANCZOS))
    durations.append(max(1, round((selected[i + 1]['t'] if i + 1 < len(selected) else data['total']) - frame['t'])))
images[0].save(data['output'], save_all=True, append_images=images[1:], duration=durations, loop=0, quality=92, method=6)
with Image.open(data['output']) as result:
    assert result.n_frames > 1, 'WebP recording must animate'
print('Animated WebP encoded with installed Pillow')
`, manifest], { stdio: "inherit" });
  }
  ff("-vf", "fps=25,scale=1000:-2:flags=lanczos,format=yuv420p", "-c:v", "libx264", "-crf", "20", "-preset", "slow", "-movflags", "+faststart", path.join(MEDIA, "walkthrough.mp4"));
  fs.rmSync(frames, { recursive: true, force: true });
  for (const f of ["walkthrough.webp", "walkthrough.mp4"]) console.log(`${f}: ${(fs.statSync(path.join(MEDIA, f)).size / 1e6).toFixed(1)} MB`);
})();
