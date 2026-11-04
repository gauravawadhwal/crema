// Builds the GitHub Pages site into _site/:
//   /            the walkthrough (demo/walkthrough.html)
//   /shots/      the screenshots it uses (docs/screenshots)
//   /app/        the full app (skin/). With no Crema server to talk to, it runs
//                its built-in demo with a simulated DE1.
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";

const out = "_site";
rmSync(out, { recursive: true, force: true });
mkdirSync(`${out}/shots`, { recursive: true });

// The walkthrough is written as a page fragment (for Claude artifacts); give it a document shell.
const fragment = readFileSync("demo/walkthrough.html", "utf8");
writeFileSync(`${out}/index.html`, `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="description" content="Crema: a custom home screen and companion app for the Decent DE1 espresso machine">
<style>body{margin:0}[hidden]{display:none!important}img{max-width:100%}</style>
<script>window.CREMA_DEMO_URL = "app/";</script>
</head>
<body>
${fragment}
</body>
</html>
`);
cpSync("docs/screenshots", `${out}/shots`, { recursive: true, filter: (f) => !f.endsWith(".json") });
cpSync("skin", `${out}/app`, { recursive: true });
writeFileSync(`${out}/.nojekyll`, "");
console.log(`${out}/ built: walkthrough at /, app at /app/`);
