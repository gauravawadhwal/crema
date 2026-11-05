// Packages the web app as a Decaid skin: dist/crema-skin.zip, with index.html
// at the root and a manifest.json that gives the skin its id and version.
// Install it on the tablet via Decaid → Launcher → Skins → ⚙ → Install skin → ZIP file,
// or attach it to a GitHub release (see .github/workflows/release.yml).
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const stage = "dist/crema-skin";
rmSync("dist", { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
cpSync("skin", stage, { recursive: true });
writeFileSync(`${stage}/manifest.json`, JSON.stringify({
  id: "crema",
  name: "Crema",
  description: pkg.description,
  version: pkg.version,
  author: "Crema contributors",
}, null, 2) + "\n");
execFileSync("zip", ["-qr", "../crema-skin.zip", "."], { cwd: stage, stdio: "inherit" });
console.log(`dist/crema-skin.zip (version ${pkg.version})`);
