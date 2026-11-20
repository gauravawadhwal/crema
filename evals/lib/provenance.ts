import { PROVIDER_IDS } from "../../server/llm/index.js";
import type { CallRecord } from "./recorder.js";
import type { TaskName } from "./dataset.js";

export type AnswerSource = "rules" | "model" | "fallback" | "unknown";
export type RequestedSubject = { kind: "rules" } | { kind: "llm"; provider: string };
const knownProvider = (value: string) => (PROVIDER_IDS as readonly string[]).includes(value);

const schemas: Record<TaskName, readonly string[]> = {
  identify: ["BeanInfo"],
  recommend: ["Recipe"],
  dialin: ["DialInAdvice"],
  review: ["ShotReview", "CurveNarrative", "ReviewNotes"],
};

export function answerSource(
  task: TaskName,
  calls: readonly CallRecord[],
  context: unknown,
  requested?: RequestedSubject,
): AnswerSource {
  const { source, fellBack } = (context ?? {}) as { source?: string; fellBack?: boolean };
  const relevant = calls.filter(c => schemas[task].includes(c.schemaName));
  const failed = relevant.some(c => c.error !== undefined);
  const completed = relevant.some(c => c.error === undefined && c.output != null && c.schemaName !== "ReviewNotes");
  const rules = source === "rules";
  if (requested?.kind === "rules") return relevant.length || fellBack || (source !== undefined && !rules) ? "unknown" : "rules";
  if (failed || fellBack === true || source?.startsWith("rules (")) return "fallback";
  if (rules) return requested?.kind === "llm" || relevant.length ? "fallback" : "unknown";
  if (!completed) return "unknown";
  if (source !== undefined) {
    return knownProvider(source) && (!requested || requested.provider === source) ? "model" : "unknown";
  }
  // Older reports stored the requested provider in metadata and the fallback
  // flag in context. A successful raw reply alone cannot prove it was used.
  return requested?.kind === "llm" && knownProvider(requested.provider) && (fellBack === false || task === "identify") ? "model" : "unknown";
}
