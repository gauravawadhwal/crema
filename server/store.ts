import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Preferences } from "./profiles/match.js";
import type { BeanInfo, Recipe } from "./schema.js";

/**
 * Crema keeps the full identification record (sources, provenance, tasting
 * notes, the recipe it chose) next to Decaid's own bean entities, which hold
 * only the core fields. Keyed by Decaid bean id.
 */
export interface CremaBeanRecord {
  decaidBeanId: string;
  decaidBatchId: string | null;
  info: BeanInfo;
  recipe: Recipe | null;
  photo: string | null; // data: URL thumbnail of your own bag photo
  productImage?: string | null; // cached roaster packshot, served at /api/images/…
  art?: "product" | "photo"; // which picture to show
  bestShotId?: string | null; // pinned reference shot, drawn as a ghost on the live chart
  finished?: boolean; // bag used up; hidden from the shelf
  addedAt: string;
}

/** A one-tap favourite: profile, recipe and optionally the coffee. */
export interface Favourite {
  name: string;
  profileTitle: string;
  doseG: number;
  yieldG: number;
  tempC: number;
  beanId: string | null;
  grinderSetting: string | null;
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

interface StoreShape {
  beans: Record<string, CremaBeanRecord>;
  preferences?: Preferences;
  favourites?: (Favourite | null)[];
  maintenance?: Maintenance;
  presets?: Presets;
}

export class Store {
  private data: StoreShape = { beans: {} };
  private loaded = false;

  constructor(private readonly file = process.env.CREMA_DATA ?? path.resolve("data/crema.json")) {}

  private async load() {
    if (this.loaded) return;
    try {
      this.data = JSON.parse(await readFile(this.file, "utf8"));
    } catch {
      this.data = { beans: {} };
    }
    this.loaded = true;
  }

  private queue: Promise<void> = Promise.resolve();

  /** Writes are serialized and atomic (write a temp file, then rename). */
  private save() {
    const snapshot = JSON.stringify(this.data, null, 2);
    this.queue = this.queue.catch(() => {}).then(async () => {
      await mkdir(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.${process.pid}.${Date.now()}.tmp`;
      await writeFile(tmp, snapshot);
      await rename(tmp, this.file);
    });
    return this.queue;
  }

  async get(beanId: string) {
    await this.load();
    return this.data.beans[beanId] ?? null;
  }

  async all() {
    await this.load();
    return Object.values(this.data.beans);
  }

  async put(rec: CremaBeanRecord) {
    await this.load();
    this.data.beans[rec.decaidBeanId] = rec;
    await this.save();
  }

  async getPreferences(): Promise<Preferences> {
    await this.load();
    return this.data.preferences ?? {};
  }

  async setPreferences(p: Preferences) {
    await this.load();
    this.data.preferences = { ...(this.data.preferences ?? {}), ...p };
    await this.save();
    return this.data.preferences;
  }

  async getFavourites(): Promise<(Favourite | null)[]> {
    await this.load();
    const f = this.data.favourites ?? [];
    return Array.from({ length: 5 }, (_, i) => f[i] ?? null);
  }

  async setFavourite(slot: number, fav: Favourite | null) {
    const all = await this.getFavourites();
    all[slot] = fav;
    this.data.favourites = all;
    await this.save();
    return all;
  }

  async getPresets(): Promise<Presets> {
    await this.load();
    return this.data.presets ?? DEFAULT_PRESETS;
  }

  async setPresets(p: Presets) {
    await this.load();
    this.data.presets = p;
    await this.save();
    return p;
  }

  async getMaintenance(): Promise<Maintenance> {
    await this.load();
    return { ...DEFAULT_MAINTENANCE, ...(this.data.maintenance ?? {}) };
  }

  async setMaintenance(patch: Partial<Maintenance>) {
    this.data.maintenance = { ...(await this.getMaintenance()), ...patch };
    await this.save();
    return this.data.maintenance;
  }

  async patch(beanId: string, patch: Partial<CremaBeanRecord>) {
    await this.load();
    const cur = this.data.beans[beanId];
    if (!cur) throw new Error(`unknown bean ${beanId}`);
    this.data.beans[beanId] = { ...cur, ...patch };
    await this.save();
    return this.data.beans[beanId];
  }
}
