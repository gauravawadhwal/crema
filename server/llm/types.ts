import type { z } from "zod";

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
}

export interface LlmProvider {
  readonly id: ProviderId;
  /** Human-readable description of how this provider is billed. */
  readonly billing: string;
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

/** Pull the first JSON object out of model text (handles ```json fences). */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = (fenced ? fenced[1] : text).trim();
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("no JSON object in model output");
  return JSON.parse(body.slice(start, end + 1));
}
