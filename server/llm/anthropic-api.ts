import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import { ProviderError, type LlmProvider, type StructuredRequest } from "./types.js";

/**
 * Pay-as-you-go Claude API (ANTHROPIC_API_KEY). Uses structured outputs and
 * Anthropic's server-side web search/fetch, with refusal fallbacks enabled.
 */
export class AnthropicApiProvider implements LlmProvider {
  readonly id = "anthropic-api" as const;
  readonly billing = "Anthropic API key (pay per token)";
  private readonly client = new Anthropic();

  constructor(private readonly model = process.env.ANTHROPIC_MODEL ?? "claude-opus-5-5") {}

  async structured<T extends z.ZodType>(req: StructuredRequest<T>): Promise<z.infer<T>> {
    const content: Anthropic.Beta.BetaContentBlockParam[] = [
      ...(req.images ?? []).map(
        (img): Anthropic.Beta.BetaContentBlockParam => ({
          type: "image",
          source: { type: "base64", media_type: img.mediaType, data: img.data.toString("base64") },
        }),
      ),
      { type: "text", text: req.prompt },
    ];
    const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content }];

    try {
      // Server tools can pause a long turn; resend to let it continue.
      for (let attempt = 0; attempt < 4; attempt++) {
        const response = await this.client.beta.messages.parse({
          model: this.model,
          max_tokens: 16000,
          system: req.system,
          messages,
          output_config: { effort: "medium", format: betaZodOutputFormat(req.schema) },
          tools: req.web
            ? [
                { type: "web_search_20260209", name: "web_search", max_uses: 6 },
                { type: "web_fetch_20260209", name: "web_fetch", max_uses: 4 },
              ]
            : undefined,
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
        });

        if (response.stop_reason === "pause_turn") {
          messages.push({ role: "assistant", content: response.content as Anthropic.Beta.BetaContentBlockParam[] });
          continue;
        }
        if (response.stop_reason === "refusal") {
          throw new ProviderError(this.id, "the model declined this request");
        }
        if (response.parsed_output == null) {
          throw new ProviderError(this.id, `no structured output (stop_reason=${response.stop_reason})`);
        }
        return response.parsed_output as z.infer<T>;
      }
      throw new ProviderError(this.id, "turn kept pausing; giving up");
    } catch (e) {
      if (e instanceof ProviderError) throw e;
      throw new ProviderError(this.id, (e as Error).message, e);
    }
  }
}
