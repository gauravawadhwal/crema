/**
 * Optional model-graded checks for the free-text parts of an answer: the
 * rationale and dial-in guidance of a recipe, and the reasoning of dial-in
 * advice. Code graders already settle the choices; the judge only scores what
 * code can't: is the text true to the inputs, specific, and plainly written.
 *
 * Use a strong model as the judge and keep it fixed across the runs you
 * compare, or the scores move for reasons that have nothing to do with the
 * system under test.
 */
import { z } from "zod";
import type { ProviderChain } from "../../server/llm/index.js";
import type { Check } from "./graders.js";

const Contradiction = z.object({
  answerSays: z.string().describe("Exact words from the answer"),
  inputSays: z.string().describe("Exact words from the input that the answer conflicts with"),
});

export const JudgeVerdict = z.object({
  contradictions: z
    .array(Contradiction)
    .describe("Places where the answer conflicts with the input, each with both quotes. If you can't quote input words that the answer contradicts, it doesn't belong here. Empty if none."),
  inventedFigures: z
    .array(z.string())
    .describe("Exact words from the answer that state a specific target or figure (pressure, flow, drip time, rest days, grind steps) as this profile's or coffee's own, when the input gives no such figure. Empty if none."),
  specificity: z.number().int().min(1).max(5).describe("1 = generic advice that fits any coffee; 5 = clearly about this coffee, this profile and this user"),
  actionable: z.number().int().min(1).max(5).describe("1 = vague; 5 = says exactly what to do and what to look for"),
  plainLanguage: z.number().int().min(1).max(5).describe("1 = jargon-heavy, padded or salesy; 5 = plain, short, from the user's side"),
  comment: z.string().describe("One sentence on the biggest weakness, or 'none'"),
});
export type JudgeVerdict = z.infer<typeof JudgeVerdict>;

const SYSTEM = `You grade answers from an espresso assistant for a Decent DE1 owner. You are strict, consistent and brief.

You get the exact input the assistant received and its answer. Judge only the answer's text against that input:
- ASSISTANT SYSTEM INSTRUCTIONS define field names, enums, scales and output responsibilities. They are interpretation context, not task measurements. Illustrative style examples and their numbers are NOT facts about the actual shot. Only ACTUAL CASE INPUT supplies case evidence. Do not mark correctly translated enums or taste-scale meanings as invented. If historical instructions are unavailable, do not invent them.
- Do not diagnose the input as synthetic, simulated, fabricated or faulty merely because curves are flat or tidy. Unless the actual case explicitly identifies a simulation, grade the review as a response to the supplied recording. Missing taste should lead to calibrated mechanics or a useful check, not a demand to infer nonexistent taste.
- contradictions: the answer states something the input contradicts. Examples: a range or number quoted differently from the input; a bag age or rest day count when the input has no roast date; a fact about the user's past shots that isn't what they show; a grind direction opposite to the input's guidance. Quote both sides. A deliberate, explained change to a suggested recipe is not a contradiction.
- inventedFigures: specific numbers presented as this profile's or this coffee's own targets (e.g. "first drips at 8–12 s", "peak at 9 bar") when the input gives no such figure. Numbers the input gives, simple arithmetic on them, and the recipe the answer itself recommends don't count.
- Flavour opinions and general espresso knowledge ("finer grinding slows the shot", "levers suit milk") belong in neither list; an expert is allowed opinions.
- Before you answer, re-check every entry: if it isn't clearly wrong, delete it. An entry you would describe as "fine", "minor" or "consistent" must not be listed.
- specificity, actionable, plainLanguage: integers 1–5 as described in the schema. Reserve 5 for answers you couldn't easily improve.
- For a shot review, the UI header already displays dose, yield, ratio, time and stop reason. A useful answer connects the most relevant evidence to a qualified interpretation and a next decision. Penalize specificity and actionable (score ≤ 2) for header readback, keyword padding, or a list of measurements without explaining their significance. Do not require every number or a fixed checklist: one salient, correct comparison can support a good concise takeaway.
- Shot-review actionability: a good answer proposes at most one small trial, explains why it fits this evidence, and says what to watch for (e.g. pressure building while pace approaches the window, or taste improving). Repeating a supported recipe can be the best decision. A useful abstention names the specific uncertainty/conflict and a check that resolves it; generic "need more data" earns at most 2 for actionable.
- Shot-review calibration: machine curves do not prove taste, extraction quality, channeling or a grind cause. A flow/pressure limit can be intended. A shorter/faster shot is not automatically worse, and a shot in the nominal time window is not automatically dialed in. Penalize confident causal or quality claims unsupported by reported taste and comparable recordings. Never infer finer/coarser direction from numeric or alphanumeric grinder-setting labels unless the input explicitly gives that direction.
- Shot-review history: comparisons require matching recorded profile, dose, yield and temperature. Changed or missing recipe facts weaken a comparison; recent timestamps alone do not establish comparability. A changed grind setting coinciding with a time change is an association, not proof of cause. Do not reward invented prior times, recipe changes or improvement inferred from previous model prose. If history facts are incomplete, acknowledging the limit is better than a fabricated trend.

Do not reward length. Do not judge whether the chosen profile or move is right; other checks cover that.`;

export async function judge(llm: ProviderChain, kind: "recipe" | "dial-in advice" | "shot review", input: string, answer: unknown): Promise<JudgeVerdict> {
  return llm.structured({
    system: SYSTEM,
    prompt: `THE ASSISTANT'S INPUT:\n<input>\n${input}\n</input>\n\nTHE ASSISTANT'S ANSWER (${kind}):\n<answer>\n${JSON.stringify(answer, null, 1)}\n</answer>\n\nGrade the answer.`,
    schema: JudgeVerdict,
    schemaName: "JudgeVerdict",
  });
}

/** Recipe/dial-in quality is diagnostic; judged reviews gate each quality dimension independently. */
export function judgeChecks(v: JudgeVerdict, review = false): Check[] {
  const quality = Math.round(((v.specificity + v.actionable + v.plainLanguage - 3) / 12) * 100) / 100;
  return [
    { name: "judge.noContradictions", pass: v.contradictions.length === 0, critical: review, detail: v.contradictions.map((c) => `"${c.answerSays}" vs input "${c.inputSays}"`).join(" | ") || undefined },
    { name: "judge.noInventedFigures", pass: v.inventedFigures.length === 0, critical: review, score: 1 / (1 + v.inventedFigures.length), detail: v.inventedFigures.join(" | ") || undefined },
    ...(review ? [
      { name: "judge.specificity", pass: v.specificity >= 3, critical: true, detail: `${v.specificity}/5: ${v.comment}` },
      { name: "judge.actionable", pass: v.actionable >= 3, critical: true, detail: `${v.actionable}/5: ${v.comment}` },
      { name: "judge.plainLanguage", pass: v.plainLanguage >= 3, critical: true, detail: `${v.plainLanguage}/5: ${v.comment}` },
    ] : []),
    { name: "judge.quality", pass: quality >= 0.5, score: quality, detail: `specific ${v.specificity}, actionable ${v.actionable}, plain ${v.plainLanguage}: ${v.comment}` },
  ];
}
