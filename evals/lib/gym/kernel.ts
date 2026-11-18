import { gymSteps, recordedProfile, type GymScenario } from "./scenario.js";
import { gymRandom } from "./random.js";

export const TICK_MS = 10;
export const CUP_G_PER_ML = 0.98;
const DT = TICK_MS / 1000;
const PUMP_MAX_ML_S = 8;
const PRESSURE_MAX_BAR = 12;
const tickAt = (s: number) => Math.ceil(s * 1000 / TICK_MS - 1e-9);

/** Quadratic knee. The slope matches the unconstrained and capped regimes at either edge. */
function softCap(demand: number, cap: number, width: number) {
  if (demand <= cap - width) return demand;
  if (demand >= cap + width) return cap;
  return cap - (cap + width - demand) ** 2 / (4 * width);
}

interface Tick {
  frame: number;
  command: number;
  pressure: number;
  flow: number;
  inletMl: number;
  storedMl: number;
  cupG: number;
  cupRate: number;
  mixC: number;
  groupC: number;
  targetMixC: number;
  targetGroupC: number;
}

function temperatures(sensor: "coffee" | "water", target: number) {
  return sensor === "coffee" ? { targetMixC: target + 4, targetGroupC: target } :
    { targetMixC: target, targetGroupC: target - 3 };
}

function findEffect<K extends GymScenario["interventions"][number]["kind"]>(scenario: GymScenario, kind: K) {
  return scenario.interventions.find((item): item is Extract<GymScenario["interventions"][number], { kind: K }> => item.kind === kind);
}

/** Hidden state on a fixed clock. Only the recording layer can export reviewer observations. */
export function simulateGymShot(scenario: GymScenario, seed: number) {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error("Expected a uint32 seed");
  const steps = gymSteps(scenario);
  const profile = recordedProfile(scenario, steps);
  const variation = gymRandom(scenario.session, seed, "scenario");
  const noise = gymRandom(scenario.session, seed, "controller");
  const wetting = findEffect(scenario, "onset-dynamics");
  const fillMl = (wetting?.fillMl ?? 20) * (0.96 + 0.08 * variation());
  const delayMl = (wetting?.delayMl ?? 3) * (0.9 + 0.2 * variation());
  const wetResistance = scenario.puck.resistance * (0.96 + 0.08 * variation());
  const low = findEffect(scenario, "low-resistance");
  const high = findEffect(scenario, "restriction");
  const capacity = findEffect(scenario, "flow-cap");
  const thermal = findEffect(scenario, "thermal-recovery");

  let frame = 0, frameStart = 0, from = 0;
  let inletMl = 0, storedMl = 0, cupMl = 0, flow = 0, pressure = 0, cupRate = 0;
  let dropMix = 0, dropGroup = 0;
  const initial = temperatures(steps[0].sensor, steps[0].temperatureC ?? scenario.profile.temperatureC);
  let mixC = initial.targetMixC - 1, groupC = initial.targetGroupC - 4;
  const ticks: Tick[] = [{ frame: 0, command: steps[0].transition === "smooth" ? 0 : steps[0].target,
    pressure, flow, inletMl, storedMl, cupG: 0, cupRate, mixC, groupC, ...initial }];
  let stopReason: "machineEnded" | "targetWeight" | "apiStop" = "machineEnded";

  for (let tick = 0; ; tick++) {
    const step = steps[frame];
    const intoS = (tick - frameStart) * DT;
    const ramp = Math.min(1, intoS / step.seconds);
    const command = step.transition === "smooth" ? from + (step.target - from) * ramp : step.target;
    const targets = temperatures(step.sensor, step.temperatureC ?? scenario.profile.temperatureC);
    const t = tick * TICK_MS / 1000;
    const change = (low && t >= low.atS ? low.factor : 1) * (high && t >= high.atS ? high.factor : 1);
    // The headspace loads up during the last third of fill. The wet bed then opens
    // gradually with throughput. The load relates inlet flow to group pressure.
    const saturation = Math.min(1, Math.max(0, (storedMl / fillMl - 0.65) / 0.35));
    const erosion = 1 - 0.23 * Math.min(1, cupMl / 55);
    const load = 0.12 * (1 - saturation) + saturation * wetResistance * erosion * change;
    const pumpCapacity = capacity && t >= capacity.atS ? capacity.maxMlS : PUMP_MAX_ML_S;
    const pressureMode = step.pump === "pressure";
    const limiter = step.limiter;
    const flowLimit = pressureMode && limiter ? limiter.value : pumpCapacity;
    const pressureLimit = !pressureMode && limiter ? limiter.value : PRESSURE_MAX_BAR;
    const request = command * (1 + (noise() - 0.5) * 0.014);
    const demand = pressureMode
      ? softCap(request / load, flowLimit, limiter?.range ?? 0)
      : softCap(request * load, pressureLimit, limiter?.range ?? 0) / load;
    // First-order actuator response plus a hard ceiling when a limiter engages or
    // when the profile changes. A cap always takes precedence over pump lag.
    flow = Math.min(flow + DT / 0.35 * (demand - flow), pumpCapacity, flowLimit, pressureLimit / load);
    pressure = flow * load;

    const supplied = flow * DT;
    storedMl += supplied;
    inletMl += supplied;
    // The first water fills/wets the path and then charges the outlet reservoir.
    // During a pause the reservoir can drain above that retained volume.
    const delivered = Math.max(0, storedMl - fillMl - delayMl) * DT / 0.55;
    storedMl -= delivered;
    cupMl += delivered;
    cupRate = delivered * CUP_G_PER_ML / DT;

    mixC += (targets.targetMixC - mixC) * DT / 0.8;
    groupC += (targets.targetGroupC - groupC) * DT / 2.6;
    if (thermal) {
      if (tick === tickAt(thermal.atS)) {
        if (step.sensor === "coffee") dropGroup = thermal.dropC;
        else dropMix = thermal.dropC;
      } else {
        const recovery = Math.min(1, DT / thermal.recoveryS);
        dropGroup *= 1 - recovery;
        dropMix *= 1 - recovery;
      }
    }

    const next = tick + 1;
    // The sample belongs to the frame that produced it, even on an exit tick.
    ticks.push({ frame, command, pressure, flow, inletMl, storedMl, cupG: cupMl * CUP_G_PER_ML, cupRate,
      mixC: mixC - dropMix, groupC: groupC - dropGroup, ...targets });
    const e = step.exit;
    const reading = e?.type === "pressure" ? pressure : flow;
    const threshold = e && (e.condition === "over" ? reading > e.value : reading < e.value);
    const stepWeight = step.weightG != null && cupMl * CUP_G_PER_ML >= step.weightG;
    const advance = next - frameStart >= tickAt(step.seconds) || ((next - frameStart) * DT > 0.5 && (threshold || stepWeight));
    if (scenario.stop.weightG != null && cupMl * CUP_G_PER_ML >= scenario.stop.weightG) {
      stopReason = "targetWeight";
      break;
    }
    if (advance && frame === steps.length - 1) break;
    if (next >= tickAt(scenario.stop.timeS)) {
      stopReason = "apiStop";
      break;
    }
    if (advance) {
      const nextPump = steps[frame + 1].pump;
      from = nextPump === step.pump ? (step.transition === "smooth" && next - frameStart >= tickAt(step.seconds) ? step.target : command)
        : nextPump === "pressure" ? pressure : flow;
      frame++;
      frameStart = next;
    }
  }

  return { steps, profile, ticks, stopReason };
}
