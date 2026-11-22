import { DEFAULT_SETTINGS, type AppSettings } from "./defaults.js";

export interface Grinder {
  name: string;
  start: number;
  step: number;
  finer: "lower" | "higher";
}

// Starting estimates. A user's zero point and adjustment size may vary.
export const BUILT_IN_GRINDERS: Readonly<Record<string, Readonly<Grinder>>> = {
  "niche-zero": { name: "Niche Zero", start: 10, step: 0.25, finer: "lower" },
  "lagom-p80": { name: "Lagom P80", start: 1, step: 0.05, finer: "lower" },
};

export const GRINDER_NAME_LIMIT = 60;
export const MIN_GRINDER_STEP = 0.000001;

function decimalPlaces(number: number): number {
  const [digits, exponent = "0"] = String(number).split("e");
  return Math.max(0, (digits.split(".")[1]?.length ?? 0) - Number(exponent));
}

export function validGrinder(grinder: Grinder | null | undefined): grinder is Grinder {
  return !!grinder && typeof grinder.name === "string" && grinder.name.trim().length > 0 &&
    grinder.name.length <= GRINDER_NAME_LIMIT && Number.isFinite(grinder.start) && decimalPlaces(grinder.start) <= 6 &&
    Number.isFinite(grinder.step) && grinder.step >= MIN_GRINDER_STEP && decimalPlaces(grinder.step) <= 6 &&
    (grinder.finer === "lower" || grinder.finer === "higher");
}

type GrindSettings = Pick<AppSettings, "grindStart" | "grindStep" | "grinderId" | "grinders">;

export function grinderList(settings?: Partial<GrindSettings> | null): Record<string, Readonly<Grinder>> {
  const overrides = Object.entries(settings?.grinders ?? {}).filter(([id, grinder]) =>
    /^[a-z0-9-]+$/.test(id) && validGrinder(grinder));
  return { ...BUILT_IN_GRINDERS, ...Object.fromEntries(overrides) };
}

export function resolveGrinder(settings?: Partial<GrindSettings> | null): Grinder & { id: string | null } {
  const id = settings?.grinderId;
  const grinders = grinderList(settings);
  if (id && Object.hasOwn(grinders, id)) return { ...grinders[id], id };
  const { grindStart = DEFAULT_SETTINGS.grindStart, grindStep = DEFAULT_SETTINGS.grindStep } = settings ?? {};
  const start = Number(grindStart);
  const step = Number(grindStep);
  return {
    id: null, name: "", finer: "lower",
    start: Number.isFinite(start) ? start : DEFAULT_SETTINGS.grindStart,
    step: Number.isFinite(step) && step > 0 ? step : DEFAULT_SETTINGS.grindStep,
  };
}

/** Increase or decrease the dial number by one increment. */
export function stepGrind(setting: string, direction: -1 | 1, grinder: ReturnType<typeof resolveGrinder>): string {
  const value = grinder.id ? (setting.trim() ? Number(setting) : NaN) : parseFloat(setting);
  if (!Number.isFinite(value)) return String(grinder.start);
  const decimals = grinder.id ? Math.min(100, Math.max(decimalPlaces(value), decimalPlaces(grinder.step))) : 3;
  return String(+(value + direction * grinder.step).toFixed(decimals));
}
