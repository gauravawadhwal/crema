import type { z } from "zod";
import { extractJson, jsonSchemaFor, ProviderError, type LlmProvider, type StructuredRequest, type TranscribeRequest, type Usage } from "./types.js";

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
    private readonly voiceModel = process.env.GEMINI_VOICE_MODEL ?? model,
  ) {}

  get configured() {
    return !!this.apiKey;
  }

  private async generate(model: string, body: unknown, onUsage?: (usage: Usage) => void): Promise<string> {
    if (!this.apiKey) throw new ProviderError(this.id, "GEMINI_API_KEY is not set");
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": this.apiKey },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(90_000),
    });
    if (!res.ok) throw new ProviderError(this.id, `HTTP ${res.status}: ${(await res.text()).slice(0, 1000)}`);
    const json = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number; cachedContentTokenCount?: number };
      modelVersion?: string;
    };
    const um = json.usageMetadata;
    onUsage?.({
      // promptTokenCount includes cached tokens; report them separately.
      inputTokens: um?.promptTokenCount != null ? um.promptTokenCount - (um.cachedContentTokenCount ?? 0) : undefined,
      outputTokens: (um?.candidatesTokenCount ?? 0) + (um?.thoughtsTokenCount ?? 0) || undefined,
      cacheTokens: um?.cachedContentTokenCount,
      model: json.modelVersion ?? model,
    });
    return json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  }

  /**
   * Gemini hears the audio itself, so it can be told what to expect: roaster
   * names, origins and varieties that general dictation tends to mangle.
   * The reply is JSON with a fixed schema, so silence comes back as "" rather
   * than a made-up sentence.
   */
  async transcribe(req: TranscribeRequest): Promise<string> {
    const text = await this.generate(this.voiceModel, {
      systemInstruction: {
        parts: [{
          text: `You transcribe short voice notes for a home espresso app. ${req.context}
Write down what the speaker says, in their words, with normal punctuation. Spell proper nouns the way the roaster or producer spells them when you recognise them. Write numbers and dates as digits ("250 grams", "the 2nd of November").
Drop filler words ("um", "uh"). Keep self-corrections as said; a later step resolves them.
If there is no speech, or only noise, return an empty string. Never invent words that weren't said.`,
        }],
      },
      contents: [{
        role: "user",
        parts: [
          { inline_data: { mime_type: req.audio.mediaType, data: req.audio.data.toString("base64") } },
          { text: "Transcribe this recording." },
        ],
      }],
      generationConfig: {
        temperature: 0,
        responseMimeType: "application/json",
        responseSchema: { type: "OBJECT", properties: { text: { type: "STRING" } }, required: ["text"] },
      },
    });
    try {
      const out = extractJson(text) as { text?: unknown };
      return typeof out.text === "string" ? out.text.trim() : "";
    } catch (e) {
      throw new ProviderError(this.id, `could not parse transcript: ${(e as Error).message}`, e);
    }
  }

  async structured<T extends z.ZodType>(req: StructuredRequest<T>): Promise<z.infer<T>> {
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
    const text = await this.generate(this.model, body, req.onUsage);
    try {
      const raw = extractJson(text);
      const first = req.schema.safeParse(raw);
      if (first.success) return first.data;
      // With search grounding the schema is only described, not enforced, and Gemini sometimes
      // answers a text field with a list (a blend's countries). Join those and try once more.
      return req.schema.parse(joinListsWhereTextExpected(raw, first.error.issues));
    } catch (e) {
      throw new ProviderError(this.id, `could not parse reply: ${(e as Error).message}`, e);
    }
  }
}

/** For each "expected string, received array" issue whose array holds only strings, join it with ", ". */
export function joinListsWhereTextExpected(raw: unknown, issues: readonly z.core.$ZodIssue[]): unknown {
  const copy = structuredClone(raw) as Record<string, unknown>;
  for (const issue of issues) {
    if (issue.code !== "invalid_type" || issue.expected !== "string" || !issue.path.length) continue;
    let parent: any = copy;
    for (const key of issue.path.slice(0, -1)) parent = parent?.[key as keyof typeof parent];
    const last = issue.path.at(-1) as string | number;
    const value = parent?.[last];
    if (Array.isArray(value) && value.every((x) => typeof x === "string")) parent[last] = value.join(", ");
  }
  return copy;
}
