/** Defaults and shapes for Crema's own settings, shared by the server and the web app. */

/** A one-tap favourite: profile, recipe and optionally the coffee. */
export interface Favourite {
  name: string;
  profileTitle: string;
  doseG: number;
  yieldG: number;
  tempC: number;
  beanId: string | null;
  grinderSetting: string | null;
  /** Explicitly bagless; absent on older favourites, which retain their behavior. */
  noBag?: boolean;
  profileId?: string | null;
  profileShape?: string | null;
  manual?: "flow" | "pressure" | null;
  direct?: boolean;
  targetTimeS?: number[] | null;
}

export interface Maintenance {
  backflushEveryShots: number;
  descaleEveryDays: number;
  lastBackflush: string | null; // ISO date
  lastDescale: string | null;
}

/** Steam, hot water and flush presets, shared by the tablet and the phone. */
export interface Presets {
  steam: { label: string; seconds: number }[]; // 0 seconds = run until stopped
  water: { label: string; ml: number }[];
  flush: { label: string; seconds: number }[];
  selected: { steam: number; water: number; flush: number };
}

/** App-wide switches. */
export interface AppSettings {
  /** Master switch for AI features (identification, AI profile choice, AI dial-in). */
  aiEnabled: boolean;
  /** Grinder setting a coffee starts at before one is saved for it. */
  grindStart: number;
  /** How far one tap of the grind stepper moves the setting. */
  grindStep: number;
}

export const DEFAULT_SETTINGS: AppSettings = { aiEnabled: true, grindStart: 10, grindStep: 0.25 };
/** Steps offered in Settings; the stepper accepts any positive step. */
export const GRIND_STEPS = [0.1, 0.25, 0.5, 1];

export const DEFAULT_PRESETS: Presets = {
  steam: [
    { label: "Cortado", seconds: 15 },
    { label: "Flat white", seconds: 25 },
    { label: "Latte", seconds: 35 },
    { label: "Manual", seconds: 0 },
  ],
  water: [
    { label: "Rinse", ml: 60 },
    { label: "Long black", ml: 120 },
    { label: "Tea", ml: 250 },
  ],
  flush: [
    { label: "3 s", seconds: 3 },
    { label: "5 s", seconds: 5 },
    { label: "8 s", seconds: 8 },
  ],
  selected: { steam: 1, water: 1, flush: 1 },
};

export const DEFAULT_MAINTENANCE: Maintenance = { backflushEveryShots: 100, descaleEveryDays: 90, lastBackflush: null, lastDescale: null };
