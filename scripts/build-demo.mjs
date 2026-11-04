// Builds demo/crema-demo.html: the web app forced into demo mode, as a page
// fragment (no <html>/<head>/<body>) suitable for publishing as a Claude artifact.
import { readFileSync, writeFileSync } from "node:fs";

let s = readFileSync("skin/index.html", "utf8");
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
  .replace('<script>\n"use strict";', '<script>\n"use strict";\nwindow.CREMA_FORCE_DEMO = true;');
writeFileSync("demo/crema-demo.html", s);
console.log(`demo/crema-demo.html: ${s.length} bytes; title at ${s.indexOf("<title>")}`);
