import type { z } from "zod";
import { extractJson, jsonSchemaFor, ProviderError, type LlmProvider, type StructuredRequest } from "./types.js";

/**
 * Google Gemini over its REST API (GEMINI_API_KEY). Grounding with Google
 * Search is used when the request allows web access. Because grounding and a
 * strict response schema don't always combine, the schema goes in the prompt
 * and the reply is validated with Zod here.
 */
export class GeminiApiProvider implements LlmProvider {
  readonly id = "gemini-api" as const;
  readonly billing = "Google Gemini API key";

  constructor(
    private readonly apiKey = process.env.GEMINI_API_KEY,
    readonly model = process.env.GEMINI_MODEL ?? "gemini-2.5-flash",
  ) {}

  async structured<T extends z.ZodType>(req: StructuredRequest<T>): Promise<z.infer<T>> {
    if (!this.apiKey) throw new ProviderError(this.id, "GEMINI_API_KEY is not set");
    const schemaText = JSON.stringify(jsonSchemaFor(req.schema));
    const body = {
      systemInstruction: { parts: [{ text: req.system }] },
      contents: [
        {
          role: "user",
          parts: [
            ...(req.images ?? []).map((img) => ({
              inline_data: { mime_type: img.mediaType, data: img.data.toString("base64") },
            })),
            {
              text: `${req.prompt}\n\nReply with only a JSON object matching this JSON Schema (${req.schemaName}):\n${schemaText}`,
            },
          ],
        },
      ],
      tools: req.web ? [{ google_search: {} }] : undefined,
    };
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": this.apiKey },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new ProviderError(this.id, `HTTP ${res.status}: ${(await res.text()).slice(0, 1000)}`);
    const json = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number; cachedContentTokenCount?: number };
      modelVersion?: string;
    };
    const um = json.usageMetadata;
    req.onUsage?.({
      // promptTokenCount includes cached tokens; report them separately.
      inputTokens: um?.promptTokenCount != null ? um.promptTokenCount - (um.cachedContentTokenCount ?? 0) : undefined,
      outputTokens: (um?.candidatesTokenCount ?? 0) + (um?.thoughtsTokenCount ?? 0) || undefined,
      cacheTokens: um?.cachedContentTokenCount,
      model: json.modelVersion ?? this.model,
    });
    const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    try {
      return req.schema.parse(extractJson(text));
    } catch (e) {
      throw new ProviderError(this.id, `could not parse reply: ${(e as Error).message}`, e);
    }
  }
}
