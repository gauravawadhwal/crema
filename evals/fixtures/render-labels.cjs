// Renders the synthetic bag-label photos in evals/fixtures/labels/ from the
// HTML below. The coffees and roasters are fictional. Each label is built
// around something identification gets wrong in practice: date formats, a
// best-before date with no roast date, a bag that disagrees with the website,
// a recipe in small print. The "photo" look (paper texture, tilt, glare, slight
// blur) keeps them from being perfectly clean scans.
//
//   node evals/fixtures/render-labels.cjs
const { chromium } = require("playwright");
const path = require("node:path");

const OUT = path.join(__dirname, "labels");

const photo = (inner, { tilt = -2.5, bg = "#b98c5a" } = {}) => `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;width:900px;height:1100px;overflow:hidden;background:${bg};font-family:Inter,"DejaVu Sans",sans-serif}
  body{display:grid;place-items:center;background:
    radial-gradient(ellipse at 30% 20%, rgba(255,255,255,.25), transparent 55%),
    repeating-linear-gradient(87deg, rgba(0,0,0,.035) 0 2px, transparent 2px 7px), ${bg}}
  .label{position:relative;transform:rotate(${tilt}deg);filter:blur(.35px);box-shadow:0 18px 40px rgba(0,0,0,.35)}
  .glare{position:absolute;inset:0;background:linear-gradient(120deg, transparent 40%, rgba(255,255,255,.28) 50%, transparent 62%);pointer-events:none}
  .hand{font-family:"FreeSerif",serif;font-style:italic;color:#1b2a8a;transform:skew(-8deg) rotate(-4deg);letter-spacing:1px}
</style></head><body><div class="label">${inner}<div class="glare"></div></div></body></html>`;

const LABELS = {
  // Australian roaster, DD/MM/YY sticker and a best-before date: two photos.
  "fernhollow-front.jpg": photo(`
    <div style="width:620px;height:860px;background:#f4efe6;padding:56px;box-sizing:border-box;color:#2b2b2b">
      <div style="font-size:22px;letter-spacing:6px">FERNHOLLOW ROASTERS</div>
      <div style="font-size:15px;color:#777;margin-top:6px">Melbourne · Australia</div>
      <div style="margin-top:120px;font-size:54px;font-weight:800;line-height:1.05">KIRINYAGA<br>KIAMUGUMO AA</div>
      <div style="margin-top:28px;font-size:24px">Kenya · Washed · SL28 / SL34</div>
      <div style="margin-top:18px;font-size:22px;color:#8a3b2e">blackcurrant · pink grapefruit · demerara</div>
      <div style="position:absolute;bottom:56px;left:56px;font-size:20px">250 g net · whole bean · light roast</div>
    </div>`),
  "fernhollow-sticker.jpg": photo(`
    <div style="width:560px;height:360px;background:#fff;border-radius:180px;display:grid;place-items:center;text-align:center;color:#222">
      <div>
        <div style="font-size:24px;letter-spacing:4px">ROASTED</div>
        <div style="font-size:72px;font-weight:700;font-family:'JetBrains Mono',monospace">03/10/26</div>
        <div style="font-size:18px;color:#666;margin-top:8px">Best before 03/04/27 · Lot K-1142</div>
      </div>
    </div>`, { tilt: 6, bg: "#f4efe6" }),

  // UK blend: best-before and lot only. There is no roast date to read.
  "quarry-foundry-back.jpg": photo(`
    <div style="width:640px;height:820px;background:#1f2a2e;color:#e9e4da;padding:60px;box-sizing:border-box">
      <div style="font-size:20px;letter-spacing:5px">QUARRY LANE ROASTERY</div>
      <div style="margin-top:60px;font-size:46px;font-weight:800">FOUNDRY<br>ESPRESSO BLEND</div>
      <div style="margin-top:24px;font-size:20px;line-height:1.6">Brazil · Colombia · Papua New Guinea<br>Medium-dark roast · built for milk</div>
      <div style="margin-top:70px;font-size:17px;line-height:1.7;color:#b9b3a8">100% arabica coffee beans.<br>Store in a cool, dry place. Once opened, keep sealed.<br>Quarry Lane Roastery Ltd, Leeds, United Kingdom</div>
      <div style="position:absolute;bottom:60px;left:60px;right:60px;display:flex;justify-content:space-between;font-family:'JetBrains Mono',monospace;font-size:22px">
        <span>BEST BEFORE<br>14 MAR 2027</span><span style="text-align:right">LOT 2291<br>1 kg</span>
      </div>
    </div>`, { tilt: 1.5 }),

  // US roaster: MM/DD/YYYY, which reads as a valid DD/MM date too.
  "switchback-us.jpg": photo(`
    <div style="width:620px;height:860px;background:#e8dcc4;color:#3a2f22;padding:56px;box-sizing:border-box;border:10px solid #3a2f22">
      <div style="font-size:26px;font-weight:800;letter-spacing:3px">SWITCHBACK</div>
      <div style="font-size:16px;letter-spacing:4px">COFFEE ROASTERS · PORTLAND, OREGON</div>
      <div style="margin-top:110px;font-size:50px;font-weight:800">HUILA<br>LAS FLORES</div>
      <div style="margin-top:22px;font-size:22px">Colombia · Washed · Caturra</div>
      <div style="margin-top:12px;font-size:22px">panela · red cherry · cocoa</div>
      <div style="position:absolute;bottom:56px;left:56px;right:56px;display:flex;justify-content:space-between;font-size:19px">
        <span>NET WT 12 OZ (340 g)</span><span style="font-family:'JetBrains Mono',monospace">ROASTED ON 10/03/2026</span>
      </div>
    </div>`, { tilt: -1 }),

  // The bag says NATURAL (lot 14); the roaster's page now describes a washed lot.
  "littlecomet-konga-natural.jpg": photo(`
    <div style="width:600px;height:840px;background:#11163a;color:#f3e9d2;padding:56px;box-sizing:border-box">
      <div style="font-size:22px;letter-spacing:6px">LITTLE COMET COFFEE</div>
      <div style="margin-top:130px;font-size:52px;font-weight:800">YIRGACHEFFE<br>KONGA</div>
      <div style="margin-top:26px;display:inline-block;background:#e8a33d;color:#11163a;padding:8px 18px;font-size:26px;font-weight:800">NATURAL · LOT 14</div>
      <div style="margin-top:26px;font-size:22px">Ethiopia · Gedeo · heirloom</div>
      <div style="margin-top:12px;font-size:22px">blueberry · strawberry · milk chocolate</div>
      <div style="position:absolute;bottom:56px;left:56px;font-size:20px">250 g · Roasted 20 Oct 2026</div>
    </div>`, { tilt: 3 }),

  // German back label: espresso recipe in small print, roast date written by hand.
  "roestwerk-pantano-back.jpg": photo(`
    <div style="width:640px;height:840px;background:#fbf8f2;color:#262626;padding:56px;box-sizing:border-box">
      <div style="font-size:20px;letter-spacing:5px">RÖSTWERK ELBUFER · HAMBURG</div>
      <div style="margin-top:50px;font-size:44px;font-weight:800">Brasilien<br>Fazenda Pantano</div>
      <div style="margin-top:18px;font-size:21px;line-height:1.6">Cerrado Mineiro · Natural · Gelber Catuaí<br>Röstgrad: mittel · für Espresso</div>
      <div style="margin-top:12px;font-size:21px">Haselnuss · Milchschokolade · Kirsche</div>
      <div style="margin-top:46px;border-top:1px solid #bbb;padding-top:18px;font-size:16px;line-height:1.7;color:#555">
        Unser Espresso-Rezept: 18 g rein → 40 g raus · 28–32 s · 93 °C<br>Inhalt: 500 g Röstkaffee, ganze Bohne
      </div>
      <div style="position:absolute;right:50px;bottom:60px;width:260px;height:150px;background:#fff7b0;box-shadow:0 4px 10px rgba(0,0,0,.2);display:grid;place-items:center">
        <div class="hand" style="font-size:40px">geröstet<br>28.10.26</div>
      </div>
    </div>`, { tilt: -3.5 }),

  // Black foil bag: only a faint dot-matrix code (a production code, not a
  // labelled roast date) and a best-before. Nothing here says when it was roasted.
  "northline-foil.jpg": photo(`
    <div style="width:600px;height:880px;background:linear-gradient(160deg,#2a2a2a,#0e0e0e 60%,#1d1d1d);color:#cfcfcf;padding:60px;box-sizing:border-box">
      <div style="font-size:30px;font-weight:800;letter-spacing:10px;color:#9a9a9a">NORTHLINE</div>
      <div style="margin-top:150px;font-size:44px;font-weight:300">Espresso No. 4</div>
      <div style="margin-top:14px;font-size:20px;color:#8d8d8d">Brazil · Ethiopia · El Salvador<br>Medium roast · 500 g</div>
      <div style="position:absolute;left:70px;bottom:120px;font-family:'JetBrains Mono',monospace;font-size:24px;color:#6f6f6f;letter-spacing:3px;filter:blur(.6px)">L6299 14:32<br>BB 26.04.27</div>
    </div>`, { tilt: -6, bg: "#6d7a83" }),

  // Japanese label: roaster, origin, process and roast level in Japanese; 焙煎日 = roast date.
  "hoshizora-jp.jpg": photo(`
    <div style="width:600px;height:840px;background:#f7f3ea;color:#1e2a44;padding:56px;box-sizing:border-box;font-family:'IPAPGothic','IPAGothic',sans-serif">
      <div style="font-size:26px;letter-spacing:6px">珈琲焙煎所 ほしぞら</div>
      <div style="font-size:15px;color:#777;margin-top:6px;font-family:Inter,sans-serif">HOSHIZORA COFFEE ROASTERY · KYOTO</div>
      <div style="margin-top:120px;font-size:46px;font-weight:700;line-height:1.3">エチオピア<br>グジ ナチュラル</div>
      <div style="margin-top:28px;font-size:24px;line-height:1.8">焙煎度：浅煎り<br>風味：ブルーベリー、ジャスミン、蜂蜜</div>
      <div style="position:absolute;bottom:56px;left:56px;right:56px;display:flex;justify-content:space-between;font-size:22px">
        <span>内容量 200g</span><span>焙煎日 2026.10.18</span>
      </div>
    </div>`, { tilt: 2 }),

  // Two dates on one stamp: packed and roasted.
  "harbourside-stamp.jpg": photo(`
    <div style="width:620px;height:820px;background:#dfe7e3;color:#1f3b35;padding:56px;box-sizing:border-box">
      <div style="font-size:22px;letter-spacing:5px">HARBOURSIDE COFFEE · BRISTOL</div>
      <div style="margin-top:120px;font-size:50px;font-weight:800">COLOMBIA<br>INZÁ</div>
      <div style="margin-top:22px;font-size:22px">Cauca · Washed · Castillo, Caturra</div>
      <div style="margin-top:12px;font-size:22px">plum · brown sugar · cocoa</div>
      <div style="position:absolute;bottom:70px;left:56px;border:3px solid #6b2a2a;color:#6b2a2a;padding:12px 18px;transform:rotate(-3deg);font-family:'JetBrains Mono',monospace;font-size:22px;line-height:1.5">
        PACKED&nbsp; 02/11/2026<br>ROASTED 30/10/2026
      </div>
      <div style="position:absolute;bottom:70px;right:56px;font-size:20px">250 g</div>
    </div>`, { tilt: 1 }),
};

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 900, height: 1100 }, deviceScaleFactor: 1 });
  for (const [file, html] of Object.entries(LABELS)) {
    await page.setContent(html, { waitUntil: "load" });
    await page.screenshot({ path: path.join(OUT, file), type: "jpeg", quality: 80 });
    console.log(`wrote ${path.relative(process.cwd(), path.join(OUT, file))}`);
  }
  await browser.close();
})();
