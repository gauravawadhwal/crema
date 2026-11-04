import type { z } from "zod";
import { AnthropicApiProvider } from "./anthropic-api.js";
import { ClaudeCliProvider } from "./claude-cli.js";
import { CodexCliProvider } from "./codex-cli.js";
import { GeminiApiProvider } from "./gemini-api.js";
import { MockProvider } from "./mock.js";
import { ProviderError, type LlmProvider, type ProviderId, type StructuredRequest } from "./types.js";

const factories: Record<ProviderId, () => LlmProvider> = {
  "claude-cli": () => new ClaudeCliProvider(),
  "codex-cli": () => new CodexCliProvider(),
  "anthropic-api": () => new AnthropicApiProvider(),
  "gemini-api": () => new GeminiApiProvider(),
  mock: () => new MockProvider(),
};

/**
 * Tries each configured provider in order and falls through on failure, so a
 * spent subscription limit on one service moves on to the next.
 *
 *   LLM_PROVIDERS=claude-cli,codex-cli,gemini-api
 */
export class ProviderChain implements Omit<LlmProvider, "id" | "billing"> {
  readonly providers: LlmProvider[];
  lastUsed: ProviderId | null = null;

  constructor(ids: ProviderId[]) {
    if (!ids.length) throw new Error("no LLM providers configured");
    this.providers = ids.map((id) => {
      const make = factories[id];
      if (!make) throw new Error(`unknown provider "${id}" (expected one of ${Object.keys(factories).join(", ")})`);
      return make();
    });
  }

  static fromEnv(env = process.env.LLM_PROVIDERS ?? "claude-cli,codex-cli") {
    return new ProviderChain(
      env.split(",").map((s) => s.trim()).filter(Boolean) as ProviderId[],
    );
  }

  async structured<T extends z.ZodType>(req: StructuredRequest<T>): Promise<z.infer<T>> {
    const errors: string[] = [];
    for (const p of this.providers) {
      try {
        const out = await p.structured(req);
        this.lastUsed = p.id;
        return out;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        errors.push(msg);
        console.warn(`provider ${p.id} failed, trying next: ${msg.slice(0, 300)}`);
      }
    }
    throw new ProviderError(this.providers.at(-1)!.id, `all providers failed:\n${errors.join("\n")}`);
  }
}
