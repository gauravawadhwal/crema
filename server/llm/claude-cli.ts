import { z } from "zod";
import { run, stageImages } from "./cli-util.js";
import { extractJson, ProviderError, type LlmProvider, type StructuredRequest } from "./types.js";

/**
 * Uses the Claude Code CLI in headless mode (`claude -p`), so calls are billed
 * to your Claude Pro/Max subscription instead of an API key.
 *
 * Auth: run `claude setup-token` once on the machine that hosts Crema and put
 * the token in CLAUDE_CODE_OAUTH_TOKEN (or just be logged in with `claude`).
 * This is for your own personal use; subscription auth isn't meant for serving
 * other people.
 */
export class ClaudeCliProvider implements LlmProvider {
  readonly id = "claude-cli" as const;
  readonly billing = "Claude subscription (via Claude Code CLI)";

  constructor(
    private readonly bin = process.env.CLAUDE_BIN ?? "claude",
    private readonly model = process.env.CLAUDE_CLI_MODEL ?? "opus",
  ) {}

  async structured<T extends z.ZodType>(req: StructuredRequest<T>): Promise<z.infer<T>> {
    const staged = await stageImages(req.images);
    try {
      const tools = [
        ...(staged.files.length ? ["Read"] : []),
        ...(req.web ? ["WebSearch", "WebFetch"] : []),
      ];
      const imageNote = staged.files.length
        ? `\n\nPhotos of the coffee bag are in the current directory: ${staged.files
            .map((f) => `./${f}`)
            .join(", ")}. Read every one of them before answering.`
        : "";
      const args = [
        "-p",
        req.prompt + imageNote,
        "--output-format",
        "json",
        "--json-schema",
        JSON.stringify(z.toJSONSchema(req.schema)),
        "--system-prompt",
        req.system,
        "--model",
        this.model,
        "--tools",
        tools.length ? tools.join(",") : "",
        "--no-session-persistence",
        "--strict-mcp-config",
        "--setting-sources",
        "",
      ];
      if (tools.length) args.push("--allowedTools", tools.join(","));

      const res = await run(this.bin, args, { cwd: staged.dir, timeoutMs: 300_000 });
      if (res.code !== 0) {
        throw new ProviderError(this.id, `exit ${res.code}: ${res.stderr || res.stdout}`.slice(0, 2000));
      }
      const envelope = JSON.parse(res.stdout) as {
        is_error?: boolean;
        result?: string;
        structured_output?: unknown;
      };
      if (envelope.is_error) throw new ProviderError(this.id, envelope.result ?? "unknown error");
      const raw = envelope.structured_output ?? extractJson(envelope.result ?? "");
      return req.schema.parse(raw);
    } catch (e) {
      if (e instanceof ProviderError) throw e;
      throw new ProviderError(this.id, (e as Error).message, e);
    } finally {
      await staged.cleanup();
    }
  }
}
