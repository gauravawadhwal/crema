import { toJSONSchema, type z } from "zod";

export interface ImageInput {
  /** Raw bytes of the photo. */
  data: Buffer;
  mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif";
}

export interface StructuredRequest<T extends z.ZodType> {
  system: string;
  prompt: string;
  schema: T;
  /** Name used where a provider needs one (e.g. Gemini/OpenAI schema names). */
  schemaName: string;
  images?: ImageInput[];
  /** Allow the model to search and read the web while answering. */
  web?: boolean;
  /** Called with token and cost figures when the provider reports them (used by the evals); may be called once per model turn. */
  onUsage?: (usage: Usage) => void;
}

/** What one call cost, as far as the provider reports it. Any field may be missing. */
export interface Usage {
  inputTokens?: number;
  outputTokens?: number;
  /** Cache reads and writes, counted separately from inputTokens. */
  cacheTokens?: number;
  costUsd?: number;
  /** The model that actually answered, if the provider says. */
  model?: string;
  webSearches?: number;
}

export interface LlmProvider {
  readonly id: ProviderId;
  /** Human-readable description of how this provider is billed. */
  readonly billing: string;
  /** The model this provider asks for, when it is configurable. */
  readonly model?: string;
  structured<T extends z.ZodType>(req: StructuredRequest<T>): Promise<z.infer<T>>;
}

export type ProviderId = "claude-cli" | "codex-cli" | "anthropic-api" | "gemini-api" | "mock";

export class ProviderError extends Error {
  constructor(
    readonly provider: ProviderId,
    message: string,
    readonly cause?: unknown,
  ) {
    super(`[${provider}] ${message}`);
  }
}

/**
 * JSON Schema for a Zod schema, without the `$schema` draft marker: Claude
 * Code's validator and OpenAI's strict mode reject the 2020-12 meta-schema URI.
 */
export function jsonSchemaFor(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _drop, ...rest } = toJSONSchema(schema) as Record<string, unknown>;
  return rest;
}

/** Pull the first JSON object out of model text (handles ```json fences). */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = (fenced ? fenced[1] : text).trim();
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("no JSON object in model output");
  return JSON.parse(body.slice(start, end + 1));
}
