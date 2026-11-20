import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { shotFacts } from "../../server/profiles/analysis.js";
import { findProfile } from "../../server/profiles/catalog.js";
import type { ProfileLike } from "../../server/profiles/curve.js";
import { fullReviewTrace, REVIEW_POINT_LIMIT, summarizeReviewTrace } from "../../server/recommend/review-evidence.js";
import type { ReviewInput, ReviewPoint } from "../../server/recommend/review-types.js";
import { ReviewBody, ReviewPoint as PointSchema, type Recipe } from "../../server/schema.js";
import type { ReviewEvalCase } from "./review-ablation.js";
import { PumpMode, validateReviewLabels } from "./review-labels.js";

const numeric = z.union([z.number(), z.string()]).nullish();
const text = z.string().nullish();
const reading = z.number().nullish();
const DecaidShot = z.object({
  id: text, timestamp: text, stopReason: text,
  workflow: z.object({
    // Retain recorded profile metadata for the same shape comparison as the skin.
    profile: z.custom<ProfileLike & { target_volume?: string | number }>((value) => ReviewBody.shape.profile.unwrap().safeParse(value).success).nullish(),
    context: z.object({ beanBatchId: text, grinderSetting: numeric, targetDoseWeight: numeric, targetYield: numeric,
      targetWaterVolume: numeric, targetTimeS: z.unknown().optional(), stopReason: text }).nullish(),
  }).nullish(),
  annotations: z.object({
    actualDoseWeight: numeric, actualYield: numeric, enjoyment: reading, espressoNotes: text, stopReason: text,
    extras: z.object({ crema: z.object({
      sourBitter: reading, body: reading, targetTimeS: z.unknown().optional(),
      review: z.object({ review: z.object({ summary: text }).nullish(), summary: text }).nullish(),
    }).nullish() }).nullish(),
  }).nullish(),
  measurements: z.array(z.object({
    machine: z.object({
      timestamp: text, pressure: reading, flow: reading, mixTemperature: reading, targetPressure: reading,
      targetFlow: reading, targetMixTemperature: reading, groupTemperature: reading, targetGroupTemperature: reading,
      profileFrame: reading, state: z.object({ substate: text }).nullish(),
    }).nullish(),
    scale: z.object({ timestamp: text, weight: reading, weightFlow: reading }).nullish(),
    volume: reading,
  })).nullish(),
}).refine((value) => value.measurements != null || !!value.id, "expected a Decaid shot recording");
type DecaidShot = z.infer<typeof DecaidShot>;

/** Mirror shotPoints and recordedReviewContext in skin/app.js for offline replay. */
function recordedPoints(shot: DecaidShot) {
  const points: ReviewPoint[] = [];
  let start: number | undefined;
  for (const { machine, scale, volume } of shot.measurements ?? []) {
    if (!machine) continue;
    const timestamp = Date.parse(machine.timestamp ?? "");
    if (!Number.isFinite(timestamp)) continue;
    start ??= timestamp;
    const t = (timestamp - start) / 1000;
    const scaleAt = Date.parse(scale?.timestamp ?? "");
    const last = points.at(-1);
    if (t < 0 || (last && t < last.t)) continue;
    const point = {
      t, p: machine.pressure ?? null, f: machine.flow ?? null, w: scale?.weight ?? null,
      temp: machine.mixTemperature ?? null, tp: machine.targetPressure ?? null, tf: machine.targetFlow ?? null,
      targetTemp: machine.targetMixTemperature ?? null, groupTemp: machine.groupTemperature ?? null,
      targetGroupTemp: machine.targetGroupTemperature ?? null, frame: machine.profileFrame ?? null,
      substate: machine.state?.substate ?? null, weightFlow: scale?.weightFlow ?? null,
      countedVolumeMl: volume ?? null, scaleSampleS: Number.isFinite(scaleAt) ? (scaleAt - start) / 1000 : null,
      scaleAgeS: Number.isFinite(scaleAt) ? (timestamp - scaleAt) / 1000 : null,
    };
    if (last?.t === t) points[points.length - 1] = point;
    else points.push(point);
  }
  return points;
}

function bounded(value: unknown, min: number, max: number) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}

function sortedShape(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortedShape);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .filter(([k]) => k !== "target_weight").map(([k, v]) => [k, sortedShape(v)]));
  }
  return value;
}

function captured(shot: DecaidShot, points: ReviewPoint[]) {
  const { context, profile } = shot.workflow ?? {};
  const annotations = shot.annotations;
  const first = Number(profile?.steps?.[0]?.temperature);
  const steps = profile?.steps?.map((s) => ({ ...s, temperature: s.temperature == null ? null : Math.round((Number(s.temperature) - first) * 1e6) / 1e6 }));
  const shape = profile ? JSON.stringify(sortedShape({ ...profile, steps })) : null;
  const grind = context?.grinderSetting?.toString().trim();
  return {
    profileShape: shape && shape.length <= 20000 ? shape : null,
    batchId: context?.beanBatchId ?? null,
    targetWaterMl: bounded(context?.targetWaterVolume ?? profile?.target_volume, 0, 5000),
    grinderSetting: grind && grind.length <= 120 ? grind : null,
    tempC: bounded(profile?.steps?.[0]?.temperature, 0, 150),
    doseG: bounded(annotations?.actualDoseWeight ?? context?.targetDoseWeight, 0, 60),
    yieldG: bounded(annotations?.actualYield ?? points.at(-1)?.w, 0, 500),
    targetYieldG: bounded(context?.targetYield ?? profile?.target_weight, 0, 500),
    stopReason: shot.stopReason ?? annotations?.stopReason ?? context?.stopReason ?? null,
  };
}

type SavedRecipe = Pick<Recipe, "profileTitle" | "doseG" | "yieldG" | "tempC" | "targetTimeS"> & { profileShape?: string | null };

function timeContext(shot: DecaidShot, observed: ReturnType<typeof captured>, recipe?: SavedRecipe): Pick<ReviewInput, "targetTimeS" | "timeBasis"> {
  const window = (value: unknown): [number, number] | null =>
    Array.isArray(value) && value.length === 2 && value.every(Number.isFinite) && value[0] > 0 && value[0] <= value[1] && value[1] <= 300 ? [value[0], value[1]] : null;
  const profile = shot.workflow?.profile;
  if (profile?.beverage_type === "manual") return { targetTimeS: null, timeBasis: null };
  const recorded = window(shot.annotations?.extras?.crema?.targetTimeS) ?? window(shot.workflow?.context?.targetTimeS);
  if (recorded) return { targetTimeS: recorded, timeBasis: "recorded" };

  const { doseG, tempC } = observed;
  const yieldG = observed.targetYieldG || observed.yieldG;
  const near = (a: number | null, b: number | null, tolerance: number) => a != null && b != null && a > 0 && b > 0 && Math.abs(a - b) <= tolerance;
  if (recipe && profile?.title && recipe.profileTitle === profile.title &&
      near(doseG, bounded(recipe.doseG, 0, 60), 0.5) &&
      near(yieldG, bounded(recipe.yieldG, 0, 500), Math.max(2, (yieldG ?? 0) * 0.05)) &&
      near(tempC, bounded(recipe.tempC, 0, 150), 0.5) &&
      (!recipe.profileShape || recipe.profileShape === observed.profileShape)) {
    const recipeTime = window(recipe.targetTimeS);
    if (recipeTime) return { targetTimeS: recipeTime, timeBasis: "recipe" };
  }
  const targetTimeS = window(profile?.title ? findProfile(profile.title)?.recipe?.timeS : null);
  return { targetTimeS, timeBasis: targetTimeS ? "guide" : null };
}

interface ReplayContext {
  recipe?: SavedRecipe;
  bean?: ReviewInput["bean"];
  installedProfiles?: ReviewInput["installedProfiles"];
}

function reviewInput(shot: DecaidShot, points: ReviewPoint[], history: ReviewInput["history"], options: ReplayContext) {
  const observed = captured(shot, points);
  const annotations = shot.annotations;
  const { sourBitter, body } = annotations?.extras?.crema ?? {};
  const profile = shot.workflow?.profile ?? null;
  const enjoyment = annotations?.enjoyment ?? null;
  const feedback = sourBitter != null || body != null || enjoyment != null ?
    { sourBitter: sourBitter ?? null, body: body ?? null, enjoyment, notes: null } : null;
  const input: ReviewInput = {
    timestamp: shot.timestamp ?? null, ...observed, points, profile, ...timeContext(shot, observed, options.recipe),
    annotatedYieldG: bounded(annotations?.actualYield, 0, 500), volumeCountStartFrame: profile?.target_volume_count_start ?? null,
    feedback, notes: annotations?.espressoNotes?.slice(0, 1000) ?? null, bean: options.bean ?? null,
    installedProfiles: options.installedProfiles ?? [], history,
  };
  if (points.length <= REVIEW_POINT_LIMIT) return input;
  const fullTrace = fullReviewTrace({ ...input, points: input.points.map(p => PointSchema.parse(p)) });
  const boundedPoints = Array.from({ length: REVIEW_POINT_LIMIT }, (_, i) => points[Math.round(i * (points.length - 1) / (REVIEW_POINT_LIMIT - 1))]);
  return { ...input, points: boundedPoints, fullTrace };
}

export function decaidReviewInput(recording: unknown, options: ReplayContext = {}): ReviewInput & { fullTrace?: ReturnType<typeof fullReviewTrace> } {
  const shot = DecaidShot.parse(recording);
  return reviewInput(shot, recordedPoints(shot), [], options);
}

function previousShots(shot: DecaidShot, recordings: { shot: DecaidShot; points: ReviewPoint[] }[]): ReviewInput["history"] {
  const before = Date.parse(shot.timestamp ?? "");
  const batch = shot.workflow?.context?.beanBatchId;
  if (!batch || !Number.isFinite(before)) return [];
  const earlier = recordings.flatMap((recording) => {
    const s = recording.shot;
    const time = Date.parse(s.timestamp ?? "");
    return s !== shot && s.workflow?.context?.beanBatchId === batch && time < before ? [{ ...recording, time }] : [];
  }).sort((a, b) => b.time - a.time);
  const seen = new Set<string>();
  return earlier.filter(({ shot: s }) => {
    if (!s.id) return true;
    if (seen.has(s.id) || s.id === shot.id) return false;
    seen.add(s.id);
    return true;
  }).slice(0, 10).map(({ shot: s, points }) => {
    const profile = s.workflow?.profile ?? null;
    const observed = captured(s, points);
    const normalized = points.map(p => PointSchema.parse(p));
    const { durationS, phaseEvidence } = shotFacts({ points: normalized, profile, ...observed, targetTimeS: null,
      feedback: null, bean: null, installedProfiles: [], history: [] });
    const saved = s.annotations?.extras?.crema?.review;
    return {
      ...observed, timestamp: s.timestamp!, profileTitle: profile?.title ?? null, durationS: bounded(durationS, 0, 600),
      trace: summarizeReviewTrace(normalized, phaseEvidence),
      enjoyment: s.annotations?.enjoyment ?? null, notes: s.annotations?.espressoNotes?.slice(0, 500) ?? null,
      review: (saved?.review?.summary ?? saved?.summary)?.slice(0, 1000) ?? null,
    };
  });
}

const LABEL_SUFFIX = ".local-review-labels.json";
const LocalLabels = z.strictObject({ labels: z.unknown(), profileFamily: z.string().min(1), pumpMode: PumpMode });

export function loadLocalReviewShots(directory = process.env.CREMA_LOCAL_SHOTS_DIR): ReviewEvalCase[] {
  if (!directory || !path.isAbsolute(directory)) throw new Error("CREMA_LOCAL_SHOTS_DIR must name an absolute directory outside the repository");
  const root = realpathSync(directory);
  for (let parent = root;; parent = path.dirname(parent)) {
    if (existsSync(path.join(parent, ".git"))) throw new Error("Local replay requires a directory outside any Git worktree");
    if (parent === path.dirname(parent)) break;
  }
  const files = new Set(readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => entry.name).sort());
  const read = (file: string): unknown => JSON.parse(readFileSync(path.join(root, file), "utf8"));
  const recordings = [...files].filter((file) => file.endsWith(".json") && !file.endsWith(LABEL_SUFFIX)).map((file, index) => {
    try {
      const shot = DecaidShot.parse(read(file));
      return { shot, points: recordedPoints(shot), file, index };
    } catch {
      throw new Error(`Invalid Decaid recording at sorted replay entry ${index + 1}`);
    }
  });
  return recordings.map(({ shot, points, file, index }) => {
    const id = `local-${index + 1}`;
    try {
      const sidecar = file.slice(0, -5) + LABEL_SUFFIX;
      const meta = files.has(sidecar) ? LocalLabels.parse(read(sidecar)) : undefined;
      const { fullTrace, ...input } = ReviewBody.parse(reviewInput(shot, points, previousShots(shot, recordings), {}));
      return {
        id, input, fullTrace,
        sampleTimes: points.map((p) => p.t),
        profileFamily: meta?.profileFamily ?? "unlabelled", pumpMode: meta?.pumpMode ?? "unknown",
        labels: meta ? validateReviewLabels(meta.labels, "local", points.map(p => p.t)) : undefined,
      };
    } catch {
      throw new Error(`Invalid review input or labels for ${id}`);
    }
  });
}
