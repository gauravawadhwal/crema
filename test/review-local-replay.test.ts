import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { decaidReviewInput, loadLocalReviewShots } from "../evals/lib/review-local-replay.js";
import { ROOT_DIR } from "../evals/lib/dataset.js";
import { findProfile } from "../server/profiles/catalog.js";

const start = Date.parse("2000-01-02T00:00:00Z");
const sample = (ms: number, pressure: number, weight: number) => ({
  machine: { timestamp: new Date(start + ms).toISOString(), pressure, flow: 1.8, mixTemperature: 94,
    targetPressure: 9, targetFlow: -1, groupTemperature: 90, targetGroupTemperature: 91, targetMixTemperature: 95,
    profileFrame: 0, state: { substate: "pouring" } },
  scale: { weight, weightFlow: 1.5 },
});
function recording() {
  return {
    id: "synthetic-main", timestamp: "2000-01-02T00:00:00Z", stopReason: "targetWeight",
    workflow: {
      profile: { title: "Synthetic recording", beverage_type: "espresso", target_weight: "36", steps: [
        { name: "Pour", pump: "pressure", temperature: "91" }, { name: "Finish", pump: "pressure", temperature: "90" },
      ], notes: "Synthetic profile metadata" },
      context: { beanBatchId: "synthetic-batch", targetTimeS: [22, 28], targetDoseWeight: "18.5", grinderSetting: "  S-4  ", stopReason: "apiStop" },
    },
    annotations: { actualDoseWeight: 18, actualYield: 35, stopReason: "machineEnded", enjoyment: 9, espressoNotes: "Sweet.",
      extras: { crema: { targetTimeS: [24, 32], sourBitter: 0, body: 1 } } },
    measurements: [
      { scale: { weight: -3 } }, { machine: { timestamp: "invalid" } },
      sample(0, 1, 0), sample(250, 2, 1),
      { ...sample(250, 3, 2), volume: 2, scale: { ...sample(250, 3, 2).scale, timestamp: new Date(start + 200).toISOString() } },
      sample(100, 9, 9), sample(1850, 8, 4),
    ],
  };
}

describe("Decaid replay mapping", () => {
  it("constructs the skin's ReviewInput from synthetic recorded measurements and annotations", () => {
    const shot = recording();
    const input = decaidReviewInput(shot, { installedProfiles: ["Synthetic recording"] });
    const point = { f: 1.8, temp: 94, tp: 9, tf: -1, targetTemp: 95, groupTemp: 90, targetGroupTemp: 91,
      frame: 0, substate: "pouring", weightFlow: 1.5, countedVolumeMl: null, scaleSampleS: null, scaleAgeS: null };
    expect(input).toEqual({
      timestamp: "2000-01-02T00:00:00Z",
      points: [{ ...point, t: 0, p: 1, w: 0 }, { ...point, t: 0.25, p: 3, w: 2, countedVolumeMl: 2, scaleSampleS: 0.2, scaleAgeS: 0.05 },
        { ...point, t: 1.85, p: 8, w: 4 }],
      profile: shot.workflow.profile,
      profileShape: JSON.stringify({ beverage_type: "espresso", notes: "Synthetic profile metadata", steps: [
        { name: "Pour", pump: "pressure", temperature: 0 }, { name: "Finish", pump: "pressure", temperature: -1 },
      ], title: "Synthetic recording" }),
      grinderSetting: "S-4", tempC: 91, stopReason: "targetWeight", doseG: 18, yieldG: 35, targetYieldG: 36,
      batchId: "synthetic-batch", targetWaterMl: null, annotatedYieldG: 35, volumeCountStartFrame: null,
      targetTimeS: [24, 32], timeBasis: "recorded", feedback: { sourBitter: 0, body: 1, enjoyment: 9, notes: null },
      notes: "Sweet.", bean: null, installedProfiles: ["Synthetic recording"], history: [],
    });
  });

  it("bounds context, prefers the matching recipe or guide only when a recorded window is missing, and handles manual", () => {
    const shot = recording();
    shot.annotations.extras.crema.targetTimeS = [80, 10];
    expect(decaidReviewInput(shot).targetTimeS).toEqual([22, 28]);
    shot.workflow.context.targetTimeS = [0, 20];
    const recipe = { profileTitle: "Synthetic recording", doseG: 18, yieldG: 36, tempC: 91, targetTimeS: [25, 31] as [number, number] };
    expect(decaidReviewInput(shot, { recipe })).toMatchObject({ targetTimeS: [25, 31], timeBasis: "recipe" });
    expect(decaidReviewInput(shot, { recipe: { ...recipe, doseG: 22 } })).toMatchObject({ targetTimeS: null, timeBasis: null });
    expect(decaidReviewInput(shot, { recipe: { ...recipe, profileShape: "{}" } })).toMatchObject({ targetTimeS: null, timeBasis: null });
    shot.workflow.profile.title = "Adaptive v2";
    expect(decaidReviewInput(shot)).toMatchObject({ targetTimeS: findProfile("Adaptive v2")!.recipe.timeS, timeBasis: "guide" });
    shot.workflow.profile.beverage_type = "manual";
    shot.annotations.actualYield = -1;
    expect(decaidReviewInput(shot)).toMatchObject({ yieldG: null, targetTimeS: null, timeBasis: null, feedback: null, notes: "Sweet." });
    const bare = { measurements: [sample(1000, 5, 3)] };
    expect(decaidReviewInput(bare)).toMatchObject({ yieldG: 3, points: [{ t: 0 }], profile: null, feedback: null });
  });

  it("uses the skin's 1800-point endpoint-preserving downsample", () => {
    const shot = { measurements: Array.from({ length: 2000 }, (_, i) => sample(20 * i, 8, i / 60)) };
    const { points, yieldG, fullTrace } = decaidReviewInput(shot);
    expect(points).toHaveLength(1800);
    expect(points[0].t).toBe(0);
    expect(points.at(-1)?.t).toBe(39.98);
    expect(yieldG).toBe(1999 / 60);
    expect(fullTrace?.analysis.metrics.recordedPoints).toBe(2000);
  });

  it("accepts captured metadata with no saved timing window", () => {
    const shot = recording();
    const { targetTimeS: _context, ...context } = shot.workflow.context;
    const { targetTimeS: _annotation, ...crema } = shot.annotations.extras.crema;
    expect(decaidReviewInput({
      ...shot, workflow: { ...shot.workflow, context }, annotations: { ...shot.annotations, extras: { crema } },
    })).toMatchObject({ targetTimeS: null, timeBasis: null, feedback: { sourBitter: 0, body: 1 } });
  });
});

describe("local replay loader", () => {
  it("reads real-reference sidecars separately and reconstructs only earlier same-batch history", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "crema-local-test-"));
    vi.stubEnv("CREMA_LOCAL_SHOTS_DIR", dir);
    const write = (file: string, value: unknown) => writeFileSync(path.join(dir, file), JSON.stringify(value));
    try {
      const current = recording();
      const prior = recording();
      prior.id = "synthetic-previous";
      prior.timestamp = "2000-01-01T00:00:00Z";
      prior.annotations.enjoyment = 4;
      prior.annotations.espressoNotes = "Previous " + "x".repeat(600);
      const unrelated = recording();
      unrelated.id = "synthetic-other";
      unrelated.timestamp = "2000-01-01T12:00:00Z";
      unrelated.workflow.context.beanBatchId = "synthetic-other-batch";
      write("a.decaid-shot.json", current);
      write("b.decaid-shot.json", prior);
      write("c.decaid-shot.json", unrelated);
      const labels = { source: "measured-reference", reference: "Synthetic surrogate reference", observations: [] };
      write("a.decaid-shot.local-review-labels.json", { labels, profileFamily: "flat-pressure", pumpMode: "pressure" });
      symlinkSync(path.join(dir, "a.decaid-shot.json"), path.join(dir, "d.decaid-shot.json"));
      const cases = loadLocalReviewShots();
      expect(cases).toHaveLength(3);
      expect(cases[0]).toMatchObject({ id: "local-1", labels, profileFamily: "flat-pressure", pumpMode: "pressure", sampleTimes: [0, 0.25, 1.85] });
      expect(cases[0].input.points[1].tf).toBeNull();
      expect(cases[0].input.history).toMatchObject([{ timestamp: prior.timestamp, enjoyment: 4, notes: prior.annotations.espressoNotes.slice(0, 500),
        profileTitle: "Synthetic recording", grinderSetting: "S-4", durationS: 1.9 }]);
      expect(cases[1].input.history).toEqual([]);
      write("a.decaid-shot.local-review-labels.json", { labels: { ...labels, taste: { enjoyment: 4 } }, profileFamily: "flat-pressure", pumpMode: "pressure" });
      expect(() => loadLocalReviewShots()).toThrow(/Invalid review input or labels for local-1/);
    } finally {
      vi.unstubAllEnvs();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("requires an external absolute path, including through symlinks", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "crema-local-test-"));
    try {
      const link = path.join(dir, "linked-repo");
      symlinkSync(ROOT_DIR, link);
      expect(() => loadLocalReviewShots("evals")).toThrow(/absolute directory/);
      expect(() => loadLocalReviewShots(ROOT_DIR)).toThrow(/outside any Git worktree/);
      expect(() => loadLocalReviewShots(link)).toThrow(/outside any Git worktree/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
