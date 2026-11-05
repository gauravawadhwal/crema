// Builds demo/crema-demo.html: the web app forced into demo mode, with its
// scripts inlined, as a page fragment (no <html>/<head>/<body>) suitable for
// embedding or hosting as one HTML file (for example as a Claude artifact). Run scripts/build-demo-data.ts first.
import { readFileSync, writeFileSync } from "node:fs";

let s = readFileSync("skin/index.html", "utf8");
const inline = (file) => readFileSync(`skin/${file}`, "utf8").replace(/<\/script/gi, "<\\/script");
s = s
  .replace(/<!doctype html>\s*/i, "")
  .replace(/<html[^>]*>\s*/i, "")
  .replace(/<\/?head>\s*/gi, "")
  .replace(/<body>\s*/i, "")
  .replace(/<\/body>\s*<\/html>\s*$/i, "")
  .replace("<title>Crema</title>", "<title>Crema DE1 Companion</title>")
  .replace(/<meta charset[^>]*>\s*/i, "")
  .replace(/<meta name="viewport"[^>]*>\s*/i, "")
  .replace(/<link rel="(manifest|apple-touch-icon)"[^>]*>\s*/gi, "")
  .replace(/<meta name="(apple-mobile-web-app|mobile-web-app)[^>]*>\s*/gi, "")
  // Function replacers: a replacement *string* would interpret "$$", "$&" and
  // "$'" inside the inlined code (app.js uses $$ as a helper), corrupting it.
  .replace('<script src="demo-data.js"></script>', () => `<script>window.CREMA_FORCE_DEMO = true;\n${inline("demo-data.js")}</script>`)
  .replace('<script src="demo.js"></script>', () => `<script>${inline("demo.js")}</script>`)
  .replace('<script src="app.js"></script>', () => `<script>${inline("app.js")}</script>`);
// The inlined scripts must match the source files byte for byte.
for (const f of ["demo.js", "app.js"]) if (!s.includes(inline(f))) throw new Error(`${f} was altered while inlining`);
if (/<script src=/.test(s)) throw new Error("a script was not inlined");
writeFileSync("demo/crema-demo.html", s);
console.log(`demo/crema-demo.html: ${(s.length / 1024).toFixed(0)} KB; title at ${s.indexOf("<title>")}`);
