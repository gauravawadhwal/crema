import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
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
  addedAt: string;
}

interface StoreShape {
  beans: Record<string, CremaBeanRecord>;
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

  async patch(beanId: string, patch: Partial<CremaBeanRecord>) {
    await this.load();
    const cur = this.data.beans[beanId];
    if (!cur) throw new Error(`unknown bean ${beanId}`);
    this.data.beans[beanId] = { ...cur, ...patch };
    await this.save();
    return this.data.beans[beanId];
  }
}
