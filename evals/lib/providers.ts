import { makeProvider, PROVIDER_IDS, ProviderChain } from "../../server/llm/index.js";
import type { LlmProvider, ProviderId } from "../../server/llm/types.js";
import { AgyCliProvider } from "./agy-cli.js";

export type EvalProviderId = ProviderId | "agy-cli";
export type EvalProvider = Omit<LlmProvider, "id"> & { readonly id: EvalProviderId };
export const EVAL_PROVIDER_IDS: readonly EvalProviderId[] = [...PROVIDER_IDS, "agy-cli"];

export function isEvalProviderId(id: string): id is EvalProviderId {
  return (EVAL_PROVIDER_IDS as readonly string[]).includes(id);
}

export function makeEvalProvider(id: EvalProviderId, model?: string): EvalProvider {
  return id === "agy-cli" ? new AgyCliProvider(model) : makeProvider(id, { model });
}

export function asServerProvider(provider: EvalProvider): LlmProvider {
  // Crema's chain accepts provider objects without consulting its live registry.
  // Keep the eval-only ID on the object so reports can attribute the answer.
  return provider as LlmProvider;
}

export function evalProviderChain(provider: EvalProvider) {
  return new ProviderChain([asServerProvider(provider)]);
}
