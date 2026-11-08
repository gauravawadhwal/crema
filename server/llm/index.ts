import type { z } from "zod";
import { AnthropicApiProvider } from "./anthropic-api.js";
import { ClaudeCliProvider } from "./claude-cli.js";
import { CodexCliProvider } from "./codex-cli.js";
import { GeminiApiProvider } from "./gemini-api.js";
import { MockProvider } from "./mock.js";
import { ProviderError, type LlmProvider, type ProviderId, type StructuredRequest, type TranscribeRequest } from "./types.js";

const factories: Record<ProviderId, (model?: string) => LlmProvider> = {
  "claude-cli": (model) => new ClaudeCliProvider(undefined, model),
  "codex-cli": (model) => new CodexCliProvider(undefined, model),
  "anthropic-api": (model) => new AnthropicApiProvider(model),
  "gemini-api": (model) => new GeminiApiProvider(undefined, model),
  mock: () => new MockProvider(),
};

export const PROVIDER_IDS = Object.keys(factories) as ProviderId[];

/** One provider, optionally with a specific model (otherwise its env var or default). */
export function makeProvider(id: ProviderId, opts: { model?: string } = {}): LlmProvider {
  const make = factories[id];
  if (!make) throw new Error(`unknown provider "${id}" (expected one of ${PROVIDER_IDS.join(", ")})`);
  return make(opts.model || undefined);
}

/**
 * Tries each configured provider in order and falls through on failure, so a
 * spent subscription limit on one service moves on to the next.
 *
 *   LLM_PROVIDERS=claude-cli,codex-cli,gemini-api
 */
export class ProviderChain implements Omit<LlmProvider, "id" | "billing" | "transcribe"> {
  readonly providers: LlmProvider[];
  lastUsed: ProviderId | null = null;

  /** Provider ids (built with their defaults) or ready-made providers. */
  constructor(providers: (ProviderId | LlmProvider)[]) {
    if (!providers.length) throw new Error("no LLM providers configured");
    this.providers = providers.map((p) => (typeof p === "string" ? makeProvider(p) : p));
  }

  /**
   * Providers that can turn speech into text, in order: those in the chain
   * that take audio, then Gemini on its own when GEMINI_API_KEY is set, so a
   * Claude or ChatGPT setup can add voice with just a Gemini key.
   */
  get transcribers(): LlmProvider[] {
    const own = this.providers.filter((p) => p.transcribe && (!(p instanceof GeminiApiProvider) || p.configured));
    if (!own.some((p) => p.id === "gemini-api")) {
      const extra = (this.voiceOnly ??= new GeminiApiProvider());
      if (extra.configured) own.push(extra);
    }
    return own;
  }
  private voiceOnly?: GeminiApiProvider;

  async transcribe(req: TranscribeRequest): Promise<{ text: string; provider: ProviderId }> {
    const list = this.transcribers;
    if (!list.length) throw new ProviderError("gemini-api", "no provider can transcribe audio (set GEMINI_API_KEY)");
    const errors: string[] = [];
    for (const p of list) {
      try {
        return { text: await p.transcribe!(req), provider: p.id };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        errors.push(msg);
        console.warn(`provider ${p.id} failed to transcribe: ${msg.slice(0, 300)}`);
      }
    }
    throw new ProviderError(list.at(-1)!.id, `transcription failed:\n${errors.join("\n")}`);
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
