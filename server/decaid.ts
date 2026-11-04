/**
 * Minimal client for the Decaid (formerly REA / Streamline Bridge) REST API.
 * Decaid runs on the DE1's tablet and talks to the machine over BLE/USB.
 * Docs: https://github.com/tadelv/reaprime/blob/main/doc/Skins.md
 */

export interface DecaidProfile {
  id: string;
  profile: { title: string; author?: string; notes?: string; beverage_type?: string; target_weight?: number; [k: string]: unknown };
  visibility?: string;
  isDefault?: boolean;
}

export interface DecaidBean {
  id: string;
  roaster: string;
  name: string;
  country?: string | null;
  region?: string | null;
  producer?: string | null;
  processing?: string | null;
  variety?: string[] | null;
  altitude?: number[] | null;
  notes?: string | null;
  archived?: boolean;
  [k: string]: unknown;
}

export interface DecaidBatch {
  id: string;
  beanId?: string;
  roastDate?: string | null;
  roastLevel?: string | null;
  weight?: number | null;
  weightRemaining?: number | null;
  frozen?: boolean;
  [k: string]: unknown;
}

export interface WorkflowContext {
  targetDoseWeight?: number;
  targetYield: number;
  grinderId?: string;
  grinderModel?: string;
  grinderSetting?: string;
  beanBatchId?: string;
  coffeeName?: string;
  coffeeRoaster?: string;
}

export interface ShotSummary {
  id: string;
  timestamp: string;
  workflow?: { name?: string; profile?: { title?: string }; context?: WorkflowContext };
  annotations?: { actualDoseWeight?: number; actualYield?: number; enjoyment?: number; espressoNotes?: string };
  measurements?: unknown[];
}

export class DecaidClient {
  constructor(readonly baseUrl = process.env.DECAID_URL ?? "http://localhost:8080") {}

  private async req<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(new URL(path, this.baseUrl), {
      method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`Decaid ${method} ${path} → ${res.status}: ${(await res.text()).slice(0, 500)}`);
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  listProfiles = () => this.req<DecaidProfile[]>("GET", "/api/v1/profiles?visibility=visible");
  listBeans = () => this.req<DecaidBean[]>("GET", "/api/v1/beans?includeArchived=false");
  getBean = (id: string) => this.req<DecaidBean>("GET", `/api/v1/beans/${id}`);
  createBean = (bean: Omit<DecaidBean, "id">) => this.req<DecaidBean>("POST", "/api/v1/beans", bean);
  updateBean = (id: string, patch: Partial<DecaidBean>) => this.req<DecaidBean>("PUT", `/api/v1/beans/${id}`, patch);
  listBatches = (beanId: string) => this.req<DecaidBatch[]>("GET", `/api/v1/beans/${beanId}/batches?includeArchived=false`);
  createBatch = (beanId: string, batch: Omit<DecaidBatch, "id">) =>
    this.req<DecaidBatch>("POST", `/api/v1/beans/${beanId}/batches`, batch);
  getWorkflow = () => this.req<Record<string, unknown>>("GET", "/api/v1/workflow");
  putWorkflow = (patch: Record<string, unknown>) => this.req<Record<string, unknown>>("PUT", "/api/v1/workflow", patch);
  machineState = () => this.req<Record<string, unknown>>("GET", "/api/v1/machine/state");
  shots = (q: { limit?: number; beanBatchId?: string } = {}) => {
    const params = new URLSearchParams({ limit: String(q.limit ?? 20) });
    if (q.beanBatchId) params.set("beanBatchId", q.beanBatchId);
    return this.req<{ items: ShotSummary[]; total: number }>("GET", `/api/v1/shots?${params}`);
  };
  shot = (id: string) => this.req<ShotSummary>("GET", `/api/v1/shots/${id}`);
  annotateShot = (id: string, annotations: Record<string, unknown>) =>
    this.req<ShotSummary>("PUT", `/api/v1/shots/${id}`, { annotations });
}
