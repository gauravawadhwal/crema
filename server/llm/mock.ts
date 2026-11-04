import type { z } from "zod";
import type { BeanInfo } from "../schema.js";
import type { LlmProvider, StructuredRequest } from "./types.js";

/**
 * Offline provider for development, tests and the demo skin. It returns
 * plausible canned answers so the whole flow can be clicked through with no
 * account. It does not look at images.
 */
export class MockProvider implements LlmProvider {
  readonly id = "mock" as const;
  readonly billing = "free (canned responses)";

  async structured<T extends z.ZodType>(req: StructuredRequest<T>): Promise<z.infer<T>> {
    const make = mockAnswers[req.schemaName];
    if (!make) throw new Error(`mock has no answer for ${req.schemaName}`);
    return req.schema.parse(make(req.prompt));
  }
}

const s = <T>(value: T, source: "bag" | "web" | "inferred" = "web") => ({ value, source });

export function mockBean(prompt: string): BeanInfo {
  const light = !/dark|italian|french|blend/i.test(prompt);
  return {
    roaster: s("Example Roasters", "bag"),
    name: s(light ? "Kii AA" : "House Espresso Blend", "bag"),
    country: s(light ? "Kenya" : "Brazil"),
    region: s(light ? "Kirinyaga" : "Cerrado Mineiro"),
    producer: s(light ? "Kii Factory" : null),
    variety: s(light ? ["SL28", "SL34"] : ["Yellow Catuai", "Mundo Novo"]),
    process: s(light ? "Washed" : "Natural / pulped natural"),
    processKind: light ? "washed" : "natural",
    altitudeMasl: s(light ? [1700, 1800] : [900, 1100]),
    roastLevel: s(light ? "light" : "medium-dark", "inferred"),
    roastedFor: light ? "omni" : "espresso",
    roastDate: s(new Date(Date.now() - 9 * 864e5).toISOString().slice(0, 10), "bag"),
    bestBefore: null,
    weightGrams: 250,
    tastingNotes: s(light ? ["blackcurrant", "grapefruit", "brown sugar"] : ["milk chocolate", "hazelnut", "caramel"]),
    isBlend: !light,
    blendComponents: light ? null : ["Brazil Cerrado", "Colombia Huila"],
    roasterRecipe: light
      ? null
      : { doseG: 18, yieldG: 38, timeS: 30, tempC: 92, text: "18g in, 38g out, ~30s" },
    productUrl: "https://example.com/coffee",
    imageUrl: null,
    sources: ["https://example.com/coffee"],
    confidence: 0.8,
    needsConfirmation: ["roastLevel"],
    summary: light
      ? "A bright, juicy washed Kenyan with blackcurrant acidity."
      : "A chocolatey, low-acid espresso blend built for milk.",
  };
}

const mockAnswers: Record<string, (prompt: string) => unknown> = {
  BeanInfo: mockBean,
  // Picks the top-ranked candidate from the prompt, like a model that agrees with the rules.
  Recipe: (prompt) => {
    const cards = prompt.slice(prompt.indexOf("CANDIDATE PROFILES"));
    const title = cards.match(/"title": "([^"]+)"/)?.[1] ?? "Adaptive v2";
    const recipe = JSON.parse(cards.match(/"suggestedRecipe": (\{[^}]*\})/)?.[1] ?? '{"doseG":18,"yieldG":36,"tempC":92,"timeS":[25,35]}');
    return {
      profileTitle: title,
      profileId: null,
      doseG: recipe.doseG,
      yieldG: recipe.yieldG,
      tempC: recipe.tempC,
      targetTimeS: recipe.timeS,
      grindHint: "Start from your usual setting and adjust by taste.",
      restAdvice: null,
      dialIn: "(mock) Follow the profile author's guidance.",
      rationale: ["(mock) agrees with the rules ranking"],
      alternatives: [],
    };
  },
  DialInAdvice: () => ({
    change: "Grind one step finer and keep the same yield.",
    grindDelta: "finer",
    yieldDeltaG: 0,
    tempDeltaC: 0,
    switchProfile: null,
    reasoning: "(mock) Sour and thin usually means under-extracted.",
  }),
};
