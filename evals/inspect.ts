/**
 * Shows what a case looks like to the pipeline, for writing and reviewing
 * labels. For recommend: the six candidates the model is shown, which of them
 * the labels accept or forbid, and the rules' own pick. For dial-in: the
 * recipe the shot is judged against and the rules' move.
 *
 *   npx tsx evals/inspect.ts recommend [id-substring]
 *   npx tsx evals/inspect.ts dialin [id-substring]
 */
import { rankProfiles } from "../server/profiles/match.js";
import { rulesDialIn, rulesRecipe } from "../server/recommend/index.js";
import { dialInRecipe, dialInShot, expandBean, loadCases } from "./lib/dataset.js";
import { primaryMove } from "./lib/graders.js";

const [task, filter = ""] = process.argv.slice(2);

if (task === "recommend") {
  for (const c of loadCases("recommend").filter((x) => x.id.includes(filter))) {
    const bean = expandBean(c.input.bean);
    const shown = rankProfiles(bean, c.input.preferences, c.input.installed).filter((x) => x.installed).slice(0, 6);
    const rules = rulesRecipe({ bean, preferences: c.input.preferences, profileTitles: c.input.installed }).profileTitle;
    const mark = (t: string) => (c.expect.preferred?.includes(t) ? "★" : c.expect.acceptable.includes(t) ? "✓" : c.expect.forbidden?.includes(t) ? "✗" : "·");
    console.log(`\n${c.id} [${c.split}]`);
    for (const x of shown) console.log(`  ${mark(x.title)} ${x.title.padEnd(42)} ${String(x.score).padStart(6)}  ${x.recipe.doseG}→${x.recipe.yieldG} g ${x.recipe.tempC} °C`);
    console.log(`  rules pick: ${rules} ${c.expect.acceptable.includes(rules) ? "(acceptable)" : "(NOT acceptable)"}`);
    if (!shown.some((x) => c.expect.acceptable.includes(x.title))) console.log("  ! no acceptable profile is among the candidates: the ranking, not the model, decides this case");
  }
} else if (task === "dialin") {
  for (const c of loadCases("dialin").filter((x) => x.id.includes(filter))) {
    const bean = expandBean(c.input.bean);
    const recipe = dialInRecipe(c, bean);
    const move = primaryMove(rulesDialIn(c.input.feedback, dialInShot(c, recipe), recipe));
    console.log(`\n${c.id} [${c.split}]  ${recipe.profileTitle}: ${recipe.doseG}→${recipe.yieldG} g ${recipe.tempC} °C, ${recipe.targetTimeS.join("–")} s`);
    console.log(`  shot ${c.input.shot.timeS ?? "?"} s, sour/bitter ${c.input.feedback.sourBitter}, body ${c.input.feedback.body}, ${c.input.feedback.enjoyment}/5 ${c.input.feedback.notes ? `"${c.input.feedback.notes}"` : ""}`);
    console.log(`  accept ${c.expect.accept.join(", ")}${c.expect.preferred ? ` (prefer ${c.expect.preferred})` : ""} · rules say ${move} ${c.expect.accept.includes(move) ? "✓" : "✗"}`);
  }
} else {
  console.error("usage: npx tsx evals/inspect.ts recommend|dialin [id-substring]");
  process.exit(2);
}
