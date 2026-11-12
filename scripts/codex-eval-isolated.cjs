#!/usr/bin/env node
// Eval-only CODEX_BIN wrapper. Keep authentication, but do not inherit desktop
// plugins/MCP endpoints or persist a chat for each synthetic case. Production
// provider settings are unchanged. Always name the model being measured.
const { spawnSync } = require("node:child_process");
const args = process.argv.slice(2);
const at = args.indexOf("exec");
if (at < 0 || !args.some(a => a === "-m" || a === "--model")) {
  console.error("Isolated evals require codex exec with an explicit model.");
  process.exit(2);
}
args.splice(at + 1, 0, "--ignore-user-config", "--ephemeral");
const result = spawnSync(process.env.CREMA_EVAL_CODEX_BIN || "codex", args, { stdio: "inherit" });
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
