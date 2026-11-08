import { createHash } from "node:crypto";
import type { z } from "zod";
import type { LlmProvider, StructuredRequest, Usage } from "../../server/llm/types.js";

export interface CallRecord {
  schemaName: string;
  ms: number;
  /** Short hash of the system prompt: changes when the prompt is edited. */
  systemHash: string;
  prompt: string;
  images: number;
  web: boolean;
  usage?: Usage;
  /** The provider's raw structured answer, before Crema post-processes it. */
  output?: unknown;
  error?: string;
}

export const hash = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 10);

/** Every system prompt seen in this process, by hash, so a results file records which prompt version it ran. */
export const SYSTEM_PROMPTS = new Map<string, { schemaName: string; text: string }>();

function addUsage(a: Usage | undefined, b: Usage): Usage {
  if (!a) return b;
  const sum = (x?: number, y?: number) => (x == null && y == null ? undefined : (x ?? 0) + (y ?? 0));
  return {
    inputTokens: sum(a.inputTokens, b.inputTokens),
    outputTokens: sum(a.outputTokens, b.outputTokens),
    cacheTokens: sum(a.cacheTokens, b.cacheTokens),
    costUsd: sum(a.costUsd, b.costUsd),
    webSearches: sum(a.webSearches, b.webSearches),
    model: b.model ?? a.model,
  };
}

/**
 * Wraps a provider and records every call: latency, tokens and cost, the
 * prompt version, the raw answer and any error. The pipeline under test
 * swallows some errors (it falls back to rules), so this is how the evals tell
 * a model answer from a fallback.
 */
export class RecordingProvider implements LlmProvider {
  readonly calls: CallRecord[] = [];
  constructor(private readonly inner: LlmProvider) {}

  get id() {
    return this.inner.id;
  }
  get billing() {
    return this.inner.billing;
  }
  get model() {
    return this.inner.model;
  }

  async structured<T extends z.ZodType>(req: StructuredRequest<T>): Promise<z.infer<T>> {
    const systemHash = hash(req.system);
    SYSTEM_PROMPTS.set(systemHash, { schemaName: req.schemaName, text: req.system });
    const rec: CallRecord = { schemaName: req.schemaName, ms: 0, systemHash, prompt: req.prompt, images: req.images?.length ?? 0, web: !!req.web };
    this.calls.push(rec);
    const t0 = performance.now();
    try {
      // A provider may report more than once per call (e.g. resumed turns): add them up.
      const out = await this.inner.structured({ ...req, onUsage: (u) => (rec.usage = addUsage(rec.usage, u)) });
      rec.output = out;
      return out;
    } catch (e) {
      rec.error = (e as Error).message.slice(0, 2000);
      throw e;
    } finally {
      rec.ms = Math.round(performance.now() - t0);
    }
  }
}
