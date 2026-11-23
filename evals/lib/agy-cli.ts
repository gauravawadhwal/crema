import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { extractJson, jsonSchemaFor, type StructuredRequest, type Usage } from "../../server/llm/types.js";
import { processOutput, TransportFailure } from "./iteration/runtime.js";

const repo = fileURLToPath(new URL("../../", import.meta.url));
const settings = JSON.stringify({
  agentMode: "", allowNonWorkspaceAccess: false, modelProvider: "", useG1Credits: false,
  toolPermission: "strict", historySize: 0,
  permissions: { deny: ["command", "read_file", "write_file", "read_url", "execute_url", "mcp"].map(tool => `${tool}(*)`) },
});
const count = z.number().int().nonnegative();
const Envelope = z.object({
  status: z.literal("SUCCESS"),
  num_turns: z.literal(1),
  structured_output: z.unknown(),
  response: z.string().optional(),
  usage: z.object({
    input_tokens: count, output_tokens: count, thinking_tokens: count.default(0),
    cache_read_tokens: count.default(0), total_tokens: count.optional(),
  }).optional(),
});

function checkExit(model: string, code: number | null, stdout: string, stderr: string) {
  const fallback = /\b(?:fall(?:ing)? back|using default model|model override ignored)\b/i.test(stderr);
  if (code === 0 && !fallback && stdout.trim()) return;
  // CLI diagnostics can echo supplied data. Report categories and the requested model.
  const diagnostics = stderr + "\n" + stdout;
  if (/quota|rate.limit|resource.exhausted|credits|(?:usage|weekly|hour|request) limit|limit (?:reached|exceeded)|\b429\b/i.test(diagnostics)) {
    throw new Error(`Antigravity quota or rate limit reached for ${model}`);
  }
  if (/authenticat|sign.in|log.in|oauth|unauthorized|credential|\b401\b/i.test(diagnostics)) throw new Error("Antigravity authentication failed. Sign in with agy before running the eval");
  if (/trust|permission prompt/i.test(diagnostics)) throw new Error("Antigravity requires workspace trust or tool approval in print mode");
  if (/deadline exceeded|timed out/i.test(diagnostics)) throw new Error("Antigravity print mode timed out");
  if (fallback || /model|unavailable|\b404\b/i.test(diagnostics)) throw new Error(`Antigravity could not use ${model}. Check the catalog with agy models`);
  if (code === 0) throw new Error("Antigravity returned no output");
  throw new Error(`Antigravity print mode exited with code ${code}`);
}

type Options = {
  binary?: string;
  env?: NodeJS.ProcessEnv;
  scratchRoot?: string;
  timeoutMs?: number;
  stop?: string;
};

export class AgyCliProvider {
  readonly id = "agy-cli";
  readonly billing = "Antigravity subscription";
  readonly model: string;

  constructor(model: string | undefined, private readonly options: Options = {}) {
    if (!model || !/^[a-z0-9][a-z0-9.-]+$/.test(model)) {
      throw new Error("agy-cli needs an exact model ID from agy models");
    }
    this.model = model;
  }

  async structured<T extends z.ZodType>(req: StructuredRequest<T>): Promise<z.infer<T>> {
    const { value, usage } = await this.request(req);
    if (usage) req.onUsage?.(usage);
    return value;
  }

  async request<T extends z.ZodType>(req: StructuredRequest<T>): Promise<{ value: z.infer<T>; usage?: Usage }> {
    if (req.images?.length || req.web) throw new Error("agy-cli accepts text-only eval requests");
    const { binary = process.env.AGY_BIN || "agy", stop, timeoutMs = 180_000 } = this.options;
    const root = await realpath(this.options.scratchRoot ?? tmpdir());
    const rel = relative(await realpath(repo), root);
    if (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`)) {
      throw new Error("agy-cli needs a scratch directory outside the repository");
    }
    const cwd = await mkdtemp(join(root, "crema-agy-"));
    try {
      const env = { ...(this.options.env ?? process.env) };
      for (const key of ["GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_APPLICATION_CREDENTIALS", "GOOGLE_GENAI_USE_VERTEXAI"]) delete env[key];
      const prompt = `${req.system}\n\n---\n\n${req.prompt}`;
      const args = ["-p", prompt, "--model", this.model, "--output-format", "json",
        "--json-schema", JSON.stringify(jsonSchemaFor(req.schema)), "--disable-slash-commands",
        "--sandbox", "--settings", settings, "--print-timeout", `${Math.max(1, Math.ceil(timeoutMs / 1000) - 1)}s`];
      const stdout = await processOutput(binary, args, { cwd, env, timeoutMs, stop,
        check: (code, out, err) => checkExit(this.model, code, out, err) });
      let raw: unknown;
      try { raw = JSON.parse(stdout); }
      catch { raw = extractJson(stdout); }
      if (raw && typeof raw === "object" && "status" in raw &&
          ("conversation_id" in raw || "num_turns" in raw || "response" in raw || "structured_output" in raw)) {
        if (raw.status !== "SUCCESS") checkExit(this.model, 1, stdout, "");
        const envelope = Envelope.parse(raw);
        const u = envelope.usage;
        if (u && (u.cache_read_tokens > u.input_tokens ||
            (u.total_tokens !== undefined && u.total_tokens < u.input_tokens + u.output_tokens))) {
          throw new Error("Invalid Antigravity token usage");
        }
        return {
          value: req.schema.parse(envelope.structured_output ?? extractJson(envelope.response ?? "")),
          usage: u && { inputTokens: u.input_tokens - u.cache_read_tokens, cacheTokens: u.cache_read_tokens,
            outputTokens: Math.max(u.output_tokens + u.thinking_tokens, (u.total_tokens ?? 0) - u.input_tokens) },
        };
      }
      return { value: req.schema.parse(raw) };
    } catch (error) {
      if (error instanceof TransportFailure) throw error;
      if (error instanceof z.ZodError || error instanceof SyntaxError ||
          (error instanceof Error && error.message === "no JSON object in model output")) {
        throw new Error("[agy-cli] Antigravity returned invalid structured output");
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message.includes("ENOENT") ? "[agy-cli] agy executable not found. Install Antigravity CLI or set AGY_BIN" : `[agy-cli] ${message}`);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  }
}
