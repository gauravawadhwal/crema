/**
 * Browser entry for the logic the web app runs without a server: the profile
 * catalog, ranking, rules recipes, dial-in rules and defaults. Bundled to
 * skin/engine.js as `window.CremaEngine` by scripts/build-engine.mjs.
 * Everything imported here must stay free of Node APIs and runtime zod.
 */
export { CATALOG, findProfile } from "./profiles/catalog.js";
export { beanTraits, rankProfiles, suggestRecipe } from "./profiles/match.js";
export { baseline, inferRoast, restOf } from "./recommend/rules.js";
export { rulesDialIn, rulesRecipe, strip, toPastShot, withTemperature } from "./recommend/local.js";
export { DEFAULT_MAINTENANCE, DEFAULT_PRESETS, DEFAULT_SETTINGS, GRIND_STEPS } from "./shared/defaults.js";
export { outlineProfile, planAt, profileCurve, shotSim, simulateShot, stepDurations } from "./profiles/curve.js";
export { analyzeShot } from "./profiles/analysis.js";
export { rulesReview } from "./recommend/review-local.js";
export {
  adoptPatch, afterStartSent, bagRemaining, gramsUsed, isStarting, loadDecision, near, NOT_READY, reconcileOutcome, recipeMatches,
  mergeRecord, recommendPatch, saveBeanPatch, pruneNewRows, sameGrind, shotAcrossOnLoss, shotRunning, snapshotDecision, socketFrame, socketLost, startGate, startSettled, startSteps, trackNewRows, waitingForRecipe,
  plainError, steadyWeightFlow, stepProgress, stepTimes, stopReason,
} from "./control/index.js";
