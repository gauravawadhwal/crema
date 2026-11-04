import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { run, stageImages } from "./cli-util.js";
import { extractJson, jsonSchemaFor, ProviderError, type LlmProvider, type StructuredRequest } from "./types.js";

/**
 * Uses the OpenAI Codex CLI (`codex exec`), so calls are billed to your
 * ChatGPT Plus/Pro subscription. Log in once with `codex login` on the host.
 */
export class CodexCliProvider implements LlmProvider {
  readonly id = "codex-cli" as const;
  readonly billing = "ChatGPT subscription (via Codex CLI)";

  constructor(
    private readonly bin = process.env.CODEX_BIN ?? "codex",
    private readonly model = process.env.CODEX_MODEL, // undefined = Codex default
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
        ...staged.files.flatMap((f) => ["-i", path.join(staged.dir, f)]),
        // Codex has no separate system prompt flag for exec; prepend it.
        `${req.system}\n\n---\n\n${req.prompt}`,
      ];
      const res = await run(this.bin, args, { cwd: staged.dir, timeoutMs: 300_000 });
      if (res.code !== 0) {
        throw new ProviderError(this.id, `exit ${res.code}: ${res.stderr}`.slice(0, 2000));
      }
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
