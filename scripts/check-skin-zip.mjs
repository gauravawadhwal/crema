// Checks the packaged skin the way Decaid will see it: unzips dist/crema-skin.zip
// into a temporary folder and fails if anything a tablet install needs is missing.
//
//   node scripts/check-skin-zip.mjs              # after node scripts/package-skin.mjs
//   node scripts/check-skin-zip.mjs 0.1.0        # also require this manifest version
//
// Run by CI and by the release workflow before the ZIP is attached to a release.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

const zip = "dist/crema-skin.zip";
const wantVersion = process.argv[2];
const problems = [];
const fail = (msg) => problems.push(msg);

if (!existsSync(zip)) {
  console.error(`${zip} not found. Run node scripts/package-skin.mjs first.`);
  process.exit(1);
}
const dir = mkdtempSync(join(tmpdir(), "crema-skin-"));
try {
  execFileSync("unzip", ["-q", zip, "-d", dir]);
  const files = [];
  const walk = (d) => readdirSync(d).forEach((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : files.push(relative(dir, join(d, f)))));
  walk(dir);

  // Decaid serves the skin's root folder, so index.html must be at the top, not in a subfolder.
  if (!files.includes("index.html")) fail("index.html is not at the root of the ZIP");

  let manifest = null;
  try { manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")); } catch { fail("manifest.json is missing or isn't valid JSON"); }
  if (manifest) {
    if (manifest.id !== "crema") fail(`manifest id is "${manifest.id}", expected "crema"`);
    if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(manifest.version ?? "")) fail(`manifest version "${manifest.version}" isn't a semantic version`);
    if (wantVersion && manifest.version !== wantVersion) fail(`manifest version is ${manifest.version}, expected ${wantVersion}`);
  }

  // Every local script, stylesheet and image index.html refers to must be in the ZIP, by a relative path.
  const html = existsSync(join(dir, "index.html")) ? readFileSync(join(dir, "index.html"), "utf8") : "";
  for (const [, ref] of html.matchAll(/\b(?:src|href)="([^"#?]+)[^"]*"/g)) {
    if (/^(https?:|data:|mailto:|\/\/)/.test(ref)) continue;
    if (ref.startsWith("/")) { fail(`index.html uses an absolute path (${ref}); Decaid serves skins from their own folder`); continue; }
    if (!files.includes(ref.replace(/^\.\//, ""))) fail(`index.html refers to ${ref}, which isn't in the ZIP`);
  }

  // The scripts must parse; a syntax error shows as a blank tablet.
  for (const f of files.filter((f) => f.endsWith(".js"))) {
    try { execFileSync(process.execPath, ["--check", join(dir, f)], { stdio: "pipe" }); } catch (e) { fail(`${f} doesn't parse: ${String(e.stderr).split("\n").find(Boolean)}`); }
  }

  // Nothing from development, tests or deployment belongs in the skin.
  for (const f of files) {
    if (/(^|\/)(\.env|\.git|node_modules|test|tests|evals|dev)(\/|$)|\.(ts|map|pem|key)$/.test(f)) fail(`${f} shouldn't be in the skin`);
  }

  if (problems.length) {
    console.error(`${zip}: ${problems.length} problem(s)\n  ${problems.join("\n  ")}`);
    process.exitCode = 1;
  } else {
    console.log(`${zip} ok: ${files.length} files, version ${manifest.version}`);
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
