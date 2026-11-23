import { isAbsolute, join } from "node:path";
import { writeFileSync, unlinkSync } from "node:fs";
import { z } from "zod";
import { jsonSchemaFor, type StructuredRequest, type Usage } from "../../../server/llm/types.js";
import { AgyCliProvider } from "../agy-cli.js";
import type { EvalProvider } from "../providers.js";
import { agyQuotaWindows, assertPrivateDirectory, Meter, processOutput, quotaWindows, type Vendor } from "./runtime.js";

const file = z.string().refine(isAbsolute, "use an absolute path");
const version = z.string().regex(/^[a-z0-9][a-z0-9.-]+$/);
const positive = z.number().int().positive();
export const CliPin = z.strictObject({
  provider: z.enum(["codex-cli", "claude-cli", "agy-cli"]),
  model: version,
  effort: z.enum(["low", "medium", "high"]),
  tier: z.literal("standard"),
  binary: file,
  cliVersion: z.string().min(1),
  maxCallTokens: positive,
}).refine(pin => pin.provider !== "agy-cli" ||
  agyWindowIds(pin.model).length > 0 && pin.model.endsWith(`-${pin.effort}`),
  "Use an Antigravity catalog model with a supported quota group and matching effort");

export type CliPin = z.infer<typeof CliPin>;
export const vendorOf = (pin: CliPin): Vendor => pin.provider === "agy-cli" ? "agy" : pin.provider === "codex-cli" ? "codex" : "claude";
export const Sandbox = z.strictObject({
  home: file, codexProfile: file.optional(), claudeProfile: file.optional(), quotaBinary: file,
  timeoutMs: positive.max(300_000),
});

export function isolatedEnv(config: z.infer<typeof Sandbox>, vendor: Vendor) {
  assertPrivateDirectory(config.home);
  const env = { HOME: config.home, PATH: "/usr/bin:/bin:/opt/homebrew/bin:/usr/local/bin", TMPDIR: config.home };
  if (vendor === "agy") return env; // The isolated home contains the signed-in agy profile.
  const profile = vendor === "codex" ? config.codexProfile : config.claudeProfile;
  if (!profile) throw new Error("Missing isolated subscription profile");
  assertPrivateDirectory(profile);
  return { ...env, [vendor === "codex" ? "CODEX_HOME" : "CLAUDE_CONFIG_DIR"]: profile };
}

function agyWindowIds(model: string): string[] {
  if (/^(claude-|gpt-)/.test(model)) return ["claude_gpt_5h", "claude_gpt_weekly"];
  if (model.startsWith("gemini-")) return ["gemini_5h", "gemini_weekly",
    ...(/argon|g1-pro/.test(model) ? ["gemini_argon_weekly"] : [])];
  return [];
}

export function makeQuotaReader(config: z.infer<typeof Sandbox>, cwd: string, stop: string, pins: readonly CliPin[] = []) {
  const agyWindows = new Set(pins.filter(pin => pin.provider === "agy-cli").flatMap(pin => agyWindowIds(pin.model)));
  return async (vendor: Vendor) => {
    const selection = vendor === "agy" ? ["--max-age", "0"] : ["--profile-only"];
    const stdout = await processOutput(config.quotaBinary, ["--provider", vendor, ...selection, "--json", "--full", "--no-credential-refresh"], {
      cwd, env: isolatedEnv(config, vendor), timeoutMs: 20_000, stop,
    });
    const raw = JSON.parse(stdout);
    return vendor === "agy" ? agyQuotaWindows(raw, agyWindows) : quotaWindows(raw, vendor);
  };
}

const count = z.number().int().nonnegative();
function claudeResult(stdout: string, pin: CliPin) {
  const envelope = z.object({
    is_error: z.literal(false),
    num_turns: z.literal(1),
    structured_output: z.unknown(),
    usage: z.object({
      input_tokens: count, output_tokens: count, cache_creation_input_tokens: count.default(0), cache_read_input_tokens: count.default(0),
      server_tool_use: z.record(z.string(), count).optional(),
    }),
    modelUsage: z.record(z.string(), z.unknown()),
  }).parse(JSON.parse(stdout));
  const u = envelope.usage;
  if (Object.values(u.server_tool_use ?? {}).some(n => n > 0)) throw new Error("Unexpected server tool use");
  if (Object.keys(envelope.modelUsage).join() !== pin.model) throw new Error("Claude reported a different model");
  return { raw: envelope.structured_output, usage: {
    inputTokens: u.input_tokens, cacheTokens: u.cache_creation_input_tokens + u.cache_read_input_tokens,
    outputTokens: u.output_tokens, model: pin.model,
  } };
}

function codexResult(stdout: string) {
  const events = stdout.trim().split("\n").map(line => JSON.parse(line) as {
    type: string; item?: { type?: string; text?: string }; usage?: unknown;
  });
  const messages: string[] = [];
  const completions: unknown[] = [];
  for (const event of events) {
    if (event.type.startsWith("item.")) {
      const item = event.item;
      if (!item || !["agent_message", "reasoning"].includes(item.type ?? "")) throw new Error("Unexpected Codex tool or item");
      if (event.type === "item.completed" && item.type === "agent_message" && item.text) messages.push(item.text);
    } else if (event.type === "turn.completed") completions.push(event.usage);
    else if (!["thread.started", "turn.started"].includes(event.type)) throw new Error("Unexpected Codex event");
  }
  if (completions.length !== 1 || messages.length !== 1) throw new Error("Expected exactly one Codex turn and answer");
  const usage = z.object({ input_tokens: count, output_tokens: count, cached_input_tokens: count.default(0),
    reasoning_output_tokens: count.default(0) }).parse(completions[0]);
  if (usage.cached_input_tokens > usage.input_tokens) throw new Error("Invalid Codex token usage");
  return { raw: JSON.parse(messages[0]), usage: {
    inputTokens: usage.input_tokens - usage.cached_input_tokens, cacheTokens: usage.cached_input_tokens,
    outputTokens: usage.output_tokens + usage.reasoning_output_tokens,
  } };
}

// These eval-only adapters implement the server's LlmProvider contract. They
// deliberately bypass the general-purpose CLI adapters' inherited host config.
export class IsolatedCli implements EvalProvider {
  readonly billing = "metered subscription";
  meteringMs = 0;
  get id() { return this.pin.provider; }
  get model() { return this.pin.model; }
  get vendor() { return vendorOf(this.pin); }
  constructor(readonly pin: CliPin, private readonly sandbox: z.infer<typeof Sandbox>,
    private readonly cwd: string, private readonly stop: string, private readonly meter: Meter) {}

  async checkVersion() {
    const version = await processOutput(this.pin.binary, ["--version"], {
      cwd: this.cwd, env: isolatedEnv(this.sandbox, this.vendor), timeoutMs: 10_000, stop: this.stop,
    });
    if (version.trim() !== this.pin.cliVersion) throw new Error("CLI version differs from the run pin");
  }

  async structured<T extends z.ZodType>(req: StructuredRequest<T>): Promise<z.infer<T>> {
    if (req.web || req.images?.length) throw new Error("Iteration model calls cannot use web or images");
    const schema = JSON.stringify(jsonSchemaFor(req.schema));
    if (Buffer.byteLength(req.system + req.prompt + schema) >= this.pin.maxCallTokens) throw new Error("Request exceeds conservative token reservation");
    const started = performance.now();
    let clientMs = 0;
    const { raw, usage } = await this.meter.call(this.vendor, this.pin.maxCallTokens, async () => {
      const clientStarted = performance.now();
      try {
        const parsed = this.id === "agy-cli" ? await this.agy(req) :
          this.id === "claude-cli" ? await this.claude(req, schema) : await this.codex(req, schema);
        return { value: parsed, tokens: totalTokens(parsed.usage) };
      } finally {
        clientMs += performance.now() - clientStarted;
      }
    }).finally(() => { this.meteringMs += performance.now() - started - clientMs; });
    req.onUsage?.(usage);
    return req.schema.parse(raw);
  }

  private async agy(req: StructuredRequest<z.ZodType>) {
    const provider = new AgyCliProvider(this.pin.model, {
      binary: this.pin.binary, env: isolatedEnv(this.sandbox, "agy"), scratchRoot: this.cwd,
      timeoutMs: this.sandbox.timeoutMs, stop: this.stop,
    });
    const { value, usage } = await provider.request(req);
    if (!usage) throw new Error("Antigravity did not report token usage");
    return { raw: value, usage };
  }

  private async claude(req: StructuredRequest<z.ZodType>, schema: string) {
    const stdout = await this.command([
      "-p", "--safe-mode", "--restricted", "--strict-mcp-config", "--tools", "", "--disable-slash-commands",
      "--setting-sources", "", "--no-session-persistence", "--max-turns", "1", "--output-format", "json",
      "--model", this.pin.model, "--effort", this.pin.effort, "--system-prompt", req.system, "--json-schema", schema,
    ], req.prompt);
    return claudeResult(stdout, this.pin);
  }

  private async codex(req: StructuredRequest<z.ZodType>, schema: string) {
    const schemaFile = join(this.cwd, "output-schema.json");
    writeFileSync(schemaFile, schema, { mode: 0o600, flag: "wx" });
    try {
      const stdout = await this.command([
        "exec", "--skip-git-repo-check", "--ignore-user-config", "--ignore-rules", "--ephemeral",
        "--strict-config", "--sandbox", "read-only", "--json", "--model", this.pin.model,
        "-c", "approval_policy='never'", "-c", "web_search='disabled'", "-c", "service_tier='default'",
        "-c", `model_reasoning_effort='${this.pin.effort}'`,
        ...["plugins", "remote_plugin", "shell_tool", "unified_exec", "enable_mcp_apps", "tool_search",
          "request_permissions_tool", "skill_search", "code_mode_only_strict_3p_tools"].flatMap(feature => ["--disable", feature]),
        "--output-schema", schemaFile, "-",
      ], `${req.system}\n\n---\n\n${req.prompt}`);
      return codexResult(stdout);
    } finally { unlinkSync(schemaFile); }
  }

  private command(args: string[], stdin: string) {
    return processOutput(this.pin.binary, args, {
      cwd: this.cwd, env: isolatedEnv(this.sandbox, this.vendor), timeoutMs: this.sandbox.timeoutMs, stop: this.stop, stdin,
    });
  }
}

export function totalTokens(usage: Usage) {
  return (usage.inputTokens ?? 0) + (usage.cacheTokens ?? 0) + (usage.outputTokens ?? 0);
}
