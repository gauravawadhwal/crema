import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { run, stageImages } from "./cli-util.js";
import { extractJson, jsonSchemaFor, ProviderError, type LlmProvider, type StructuredRequest, type Usage } from "./types.js";

/**
 * Uses the OpenAI Codex CLI (`codex exec`), so calls are billed to your
 * ChatGPT Plus/Pro subscription. Log in once with `codex login` on the host.
 */
export class CodexCliProvider implements LlmProvider {
  readonly id = "codex-cli" as const;
  readonly billing = "ChatGPT subscription (via Codex CLI)";

  constructor(
    private readonly bin = process.env.CODEX_BIN ?? "codex",
    readonly model = process.env.CODEX_MODEL, // undefined = Codex default
    // low | medium | high …; undefined = the user's Codex config. Extraction needs little reasoning.
    private readonly effort = process.env.CODEX_REASONING_EFFORT,
  ) {}

  async structured<T extends z.ZodType>(req: StructuredRequest<T>): Promise<z.infer<T>> {
    const staged = await stageImages(req.images);
    try {
      const schemaFile = path.join(staged.dir, "schema.json");
      const outFile = path.join(staged.dir, "out.json");
      await writeFile(schemaFile, JSON.stringify(jsonSchemaFor(req.schema)));

      const args = [
        ...(req.web ? ["--search"] : []),
        "exec",
        "--skip-git-repo-check",
        "--sandbox",
        "read-only",
        "--output-schema",
        schemaFile,
        "-o",
        outFile,
        ...(this.model ? ["-m", this.model] : []),
        ...(this.effort && /^[a-z]+$/.test(this.effort) ? ["-c", `model_reasoning_effort="${this.effort}"`] : []),
        ...staged.files.flatMap((f) => ["-i", path.join(staged.dir, f)]),
        // -i takes several files, so without "--" it swallows the prompt as another image
        // and Codex waits for a prompt on stdin. Photos never reached Codex before this.
        // Events on stdout as JSON lines; the turn.completed event carries token usage.
        "--json",
        "--",
        // Codex has no separate system prompt flag for exec; prepend it.
        `${req.system}\n\n---\n\n${req.prompt}`,
      ];
      const res = await run(this.bin, args, { cwd: staged.dir, timeoutMs: 300_000 });
      if (res.code !== 0) {
        throw new ProviderError(this.id, `exit ${res.code}: ${res.stderr}`.slice(0, 2000));
      }
      reportUsage(res.stdout, this.model, req.onUsage);
      const text = await readFile(outFile, "utf8");
      return req.schema.parse(extractJson(text));
    } catch (e) {
      if (e instanceof ProviderError) throw e;
      throw new ProviderError(this.id, (e as Error).message, e);
    } finally {
      await staged.cleanup();
    }
  }
}

/**
 * Codex's turn.completed event reports input (including cached), cached input,
 * output and reasoning tokens. Reasoning is billed as output, so both count.
 */
function reportUsage(stdout: string, model: string | undefined, onUsage?: (usage: Usage) => void) {
  if (!onUsage) return;
  for (const line of stdout.split("\n").reverse()) {
    if (!line.includes('"turn.completed"')) continue;
    try {
      const u = JSON.parse(line).usage ?? {};
      const cached = u.cached_input_tokens ?? 0;
      onUsage({
        inputTokens: u.input_tokens != null ? u.input_tokens - cached : undefined,
        cacheTokens: cached || undefined,
        outputTokens: (u.output_tokens ?? 0) + (u.reasoning_output_tokens ?? 0) || undefined,
        model,
      });
    } catch {
      /* usage is optional */
    }
    return;
  }
}
