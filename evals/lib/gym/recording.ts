import { decaidReviewInput } from "../review-local-replay.js";
import { simulateGymShot, TICK_MS } from "./kernel.js";
import { gymRandom } from "./random.js";
import type { GymScenario } from "./scenario.js";

// A fixed fictional epoch lets the replay adapter do actual clock reconciliation.
const EPOCH_MS = Date.UTC(2000, 0, 1);
const timestamp = (tick: number) => new Date(EPOCH_MS + tick * TICK_MS).toISOString();
const round = (n: number) => Math.round(n * 1000) / 1000;

export function recordGymShot(scenario: GymScenario, seed: number) {
  const shot = simulateGymShot(scenario, seed);
  const scaleClock = gymRandom(scenario.session, seed, "sampling:scale");
  const machineClock = gymRandom(scenario.session, seed, "sampling:machine");
  const scaleFaults = gymRandom(scenario.session, seed, "sensors:scale");
  const machineFaults = gymRandom(scenario.session, seed, "sensors:machine");
  const tare = scenario.interventions.find((i) => i.kind === "tare-jump");
  const loss = scenario.interventions.find((i) => i.kind === "scale-loss");
  const delay = (channel: "pressure" | "flow" | "temperature") => {
    const effect = scenario.interventions.find((i) => i.kind === "sensor-lag" && i.channel === channel);
    return effect?.kind === "sensor-lag" ? Math.round(effect.delayS * 1000 / TICK_MS) : 0;
  };
  const pressureDelay = delay("pressure"), flowDelay = delay("flow"), tempDelay = delay("temperature");

  // Independent scale cadence and phase; pair the most recent scale snapshot.
  const scales = [];
  for (let tick = 1 + Math.floor(scaleClock() * 9); tick < shot.ticks.length; tick += 8 + Math.floor(scaleClock() * 5)) {
    const s = shot.ticks[tick];
    const t = tick * TICK_MS / 1000;
    const noise = (scaleFaults() - 0.5) * 0.05;
    const missing = scaleFaults() < 0.003 || (loss && t >= loss.atS && (loss.untilS == null || t < loss.untilS));
    const weight = Math.max(0, s.cupG + noise) + (tare && t >= tare.atS ? tare.deltaG : 0);
    scales.push({ tick, snapshot: missing ? null : { timestamp: timestamp(tick), weight: round(weight), weightFlow: round(s.cupRate) } });
  }

  const measurements = [];
  let scaleIndex = -1;
  const read = (value: number) => machineFaults() < 0.004 ? null : round(value);
  for (let tick = 0; tick < shot.ticks.length; tick += 19 + Math.floor(machineClock() * 12)) {
    while (scales[scaleIndex + 1]?.tick <= tick) scaleIndex++;
    const s = shot.ticks[tick];
    const step = shot.steps[s.frame];
    const mix = shot.ticks[Math.max(0, tick - tempDelay)];
    measurements.push({
      machine: {
        timestamp: timestamp(tick),
        pressure: read(shot.ticks[Math.max(0, tick - pressureDelay)].pressure),
        flow: read(shot.ticks[Math.max(0, tick - flowDelay)].flow),
        mixTemperature: read(mix.mixC),
        groupTemperature: read(mix.groupC),
        targetPressure: step.pump === "pressure" ? round(s.command) : null,
        targetFlow: step.pump === "flow" ? round(s.command) : null,
        targetMixTemperature: s.targetMixC, targetGroupTemperature: s.targetGroupC,
        profileFrame: s.frame,
        state: { substate: step.substate },
      },
      scale: scales[scaleIndex]?.snapshot ?? null,
      volume: round(s.inletMl),
    });
  }

  return decaidReviewInput({
    timestamp: timestamp(0),
    stopReason: shot.stopReason,
    workflow: { profile: shot.profile, context: { targetDoseWeight: scenario.doseG } },
    measurements,
  });
}
