import { spawn } from "node:child_process";
import { existsSync, lstatSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { digest } from "./candidate.js";

export function readJson(file: string): unknown {
  return JSON.parse(readFileSync(file, "utf8"));
}

export function saveJson(file: string, value: unknown) {
  const temporary = `${file}.tmp`;
  writeFileSync(temporary, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
  renameSync(temporary, file);
}

export class TransportFailure extends Error {}

export function stopCheck(stop: string) {
  if (existsSync(stop)) throw new Error("Iteration stopped by stop file");
}

export function processOutput(command: string, args: string[], options: {
  cwd: string; env: NodeJS.ProcessEnv; timeoutMs: number; stop?: string; stdin?: string;
  check?: (code: number | null, stdout: string, stderr: string) => void;
}): Promise<string> {
  if (options.stop) stopCheck(options.stop);
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd, env: options.env, detached: true,
      stdio: [options.stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    });
    let stdout = "", stderr = "", aborted: Error | undefined;
    const abort = (error: Error) => {
      aborted ??= error;
      if (child.pid) {
        try { process.kill(-child.pid, "SIGKILL"); }
        catch (e) { if ((e as NodeJS.ErrnoException).code !== "ESRCH") reject(e); }
      }
    };
    const timeout = setTimeout(() => abort(new Error("Subprocess timed out")), options.timeoutMs);
    const poll = setInterval(() => {
      if (options.stop && existsSync(options.stop)) abort(new Error("Iteration stopped during subprocess"));
    }, 100);
    const clear = () => { clearInterval(poll); clearTimeout(timeout); };
    child.stdout?.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk;
      if (stdout.length > 4_000_000) abort(new Error("Subprocess output exceeded its limit"));
    });
    child.stderr?.setEncoding("utf8").on("data", (chunk: string) => {
      stderr = (stderr + chunk).slice(-16_384);
    });
    child.stdin?.on("error", () => {}); // close handles an early exit
    child.once("error", (error: NodeJS.ErrnoException) => {
      clear();
      reject(error.code === "EAGAIN" ? new TransportFailure("Process could not start") : new Error(`Subprocess could not start (${error.code})`));
    });
    child.once("close", (code) => {
      clear();
      if (aborted) reject(aborted);
      else if (code !== 0 && /^(?:connection reset by peer|temporary transport failure)$/im.test(stderr.trim())) {
        reject(new TransportFailure("Temporary transport failure"));
      } else if (options.check) {
        try { options.check(code, stdout, stderr); resolve(stdout); }
        catch (error) { reject(error); }
      } else if (code === 0) resolve(stdout);
      else reject(new Error(`Subprocess exited with code ${code}`));
    });
    child.stdin?.end(options.stdin);
  });
}

const pp = z.number().min(0).max(100);
export const QuotaLimit = z.strictObject({
  maxShortPp: pp.positive(), maxWeeklyPp: pp.positive(),
  reserveShortPp: pp, reserveWeeklyPp: pp, shortPpPerCall: pp.positive(), weeklyPpPerCall: pp.positive(),
});
const Vendors = z.enum(["codex", "claude", "agy"]);
export type Vendor = z.infer<typeof Vendors>;
export const Budget = z.strictObject({
  maxTokens: z.number().int().positive(), quota: z.partialRecord(Vendors, QuotaLimit),
});

const QuotaWindow = z.object({ id: z.string(), kind: z.string(), percentRemaining: pp, resetsAt: z.string().nullish() });
const Quota = z.object({ schemaVersion: z.literal(5), providers: z.array(z.object({
  provider: z.enum(["codex", "claude"]), source: z.literal("oauth"),
  state: z.object({ status: z.literal("fresh"), stale: z.literal(false), refreshedAt: z.string() }),
  windows: z.array(QuotaWindow),
})) });

const AgyQuota = z.object({
  schemaVersion: z.literal(5), generatedAt: z.string(),
  providers: z.array(z.object({ provider: z.string() }).passthrough()),
});
const AgyAccount = z.object({
  state: z.object({ status: z.literal("fresh"), stale: z.literal(false), reused: z.literal(false).optional() }),
  accountKeys: z.tuple([z.string().min(1)]),
  windows: z.array(z.object({ id: z.string() }).passthrough()),
});

export function agyQuotaWindows(raw: unknown, required: ReadonlySet<string>, now = Date.now()) {
  const reading = AgyQuota.parse(raw);
  const matching = reading.providers.filter(p => p.provider === "agy");
  if (matching.length !== 1) throw new Error("Antigravity quota requires a single subscription account");
  const account = AgyAccount.parse(matching[0]);
  const windows = z.array(QuotaWindow).parse(account.windows.filter(w => required.has(w.id)));
  if (!required.size || windows.length !== required.size ||
      windows.some(w => w.kind !== (w.id.endsWith("_5h") ? "session" : "weekly"))) {
    throw new Error("Missing or unsupported Antigravity quota windows");
  }
  return freshWindows(windows, reading.generatedAt, now);
}

export function quotaWindows(raw: unknown, vendor: Exclude<Vendor, "agy">, now = Date.now()) {
  const matching = Quota.parse(raw).providers.filter(p => p.provider === vendor);
  if (matching.length !== 1) throw new Error("Quota requires a single subscription account");
  const { state, windows } = matching[0];
  return freshWindows(windows, state.refreshedAt, now);
}

function freshWindows(windows: z.infer<typeof QuotaWindow>[], observedAt: string, now: number) {
  const age = now - Date.parse(observedAt);
  if (!(age >= -1000 && age <= 60_000)) throw new Error("Stale quota reading");
  if (new Set(windows.map(w => w.id)).size !== windows.length ||
      !windows.some(w => w.kind === "session") || !windows.some(w => w.kind === "weekly") ||
      windows.some(w => !["session", "weekly", "model"].includes(w.kind) ||
        (w.resetsAt == null ? w.percentRemaining !== 100 : !(Date.parse(w.resetsAt) > now)))) {
    throw new Error("Unsupported or expired quota windows");
  }
  return windows
    .map(w => ({ id: w.id, kind: w.kind, percentRemaining: w.percentRemaining, resetsAt: w.resetsAt ?? null }))
    .sort((a, b) => a.id.localeCompare(b.id));
}
type Windows = ReturnType<typeof quotaWindows>;

export const DEFAULT_QUOTA_POLL_INTERVAL_MS = 5 * 60_000;
const RESET_JITTER_MS = 1000;

function sameReset(previous: string | null, next: string | null, previousRemaining: number) {
  if (previous === null) return next === null || previousRemaining === 100;
  if (next === null) return false;
  if (previous === next) return true;
  const a = Date.parse(previous), b = Date.parse(next);
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < RESET_JITTER_MS;
}

const State = z.strictObject({
  binding: z.string(), tokens: z.number().nonnegative(), attempts: z.number().int().nonnegative(),
  uncertain: z.boolean(),
  polledAt: z.partialRecord(Vendors, z.number().nonnegative()).default({}),
  windows: z.partialRecord(Vendors, z.array(z.object({
    id: z.string(), kind: z.string(), remaining: pp, reset: z.string().nullable(),
    observed: z.number().nonnegative(), reserved: z.number().nonnegative(),
    polledReserved: z.number().nonnegative().default(0),
  }))),
});

export interface MeterOptions {
  pollIntervalMs?: number | Partial<Record<Vendor, number>>;
  now?: () => number;
}

export class Meter {
  private readonly file: string;
  private readonly state: z.infer<typeof State>;
  private readonly pollIntervalMs: number | Partial<Record<Vendor, number>>;
  private readonly now: () => number;
  constructor(dir: string, private readonly stop: string, private readonly limit: z.infer<typeof Budget>,
    binding: unknown, private readonly quota: (vendor: Vendor) => Promise<Windows>, options: MeterOptions = {}) {
    this.file = join(dir, "meter.json");
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_QUOTA_POLL_INTERVAL_MS;
    this.now = options.now ?? (() => Date.now());
    const hash = digest([limit, binding]);
    this.state = existsSync(this.file) ? State.parse(readJson(this.file)) : {
      binding: hash, tokens: 0, attempts: 0, uncertain: false, polledAt: {}, windows: {},
    };
    if (this.state.binding !== hash || this.state.uncertain) throw new Error("Budget changed or an interrupted call left usage uncertain");
  }

  get usage() { return { tokens: this.state.tokens, attempts: this.state.attempts, windows: this.state.windows }; }

  private intervalFor(vendor: Vendor) {
    return typeof this.pollIntervalMs === "number" ? this.pollIntervalMs : (this.pollIntervalMs[vendor] ?? DEFAULT_QUOTA_POLL_INTERVAL_MS);
  }

  private needsPoll(vendor: Vendor) {
    const windows = this.state.windows[vendor];
    const last = this.state.polledAt[vendor];
    if (!windows || last === undefined) return true;
    const interval = this.intervalFor(vendor);
    return interval <= 0 || this.now() - last >= interval;
  }

  private effectiveRemaining(w: NonNullable<z.infer<typeof State>["windows"][Vendor]>[number]) {
    return w.remaining - Math.max(0, w.reserved - w.polledReserved);
  }

  private observe(vendor: Vendor, observed: Windows) {
    const previous = this.state.windows[vendor];
    if (previous && (previous.length !== observed.length || observed.some((w, i) =>
      w.id !== previous[i].id || !sameReset(previous[i].reset, w.resetsAt, previous[i].remaining)))) {
      throw new Error("Quota window reset or changed during the round");
    }
    return observed.map((w, i) => {
      const reserved = previous?.[i].reserved ?? 0;
      return {
        id: w.id, kind: w.kind, remaining: w.percentRemaining, reset: previous?.[i].reset ?? w.resetsAt,
        reserved, polledReserved: reserved,
        observed: (previous?.[i].observed ?? 0) + Math.max(0, (previous?.[i].remaining ?? w.percentRemaining) - w.percentRemaining),
      };
    });
  }

  private async refresh(vendor: Vendor) {
    if (!this.needsPoll(vendor)) return this.state.windows[vendor]!;
    const observed = await this.quota(vendor);
    const windows = this.observe(vendor, observed);
    this.state.windows[vendor] = windows;
    this.state.polledAt[vendor] = this.now();
    saveJson(this.file, this.state);
    return windows;
  }

  async reserve(vendor: Vendor, calls: number, tokensPerCall: number) {
    if (!Number.isSafeInteger(calls) || calls < 1 || this.state.tokens + calls * tokensPerCall > this.limit.maxTokens) throw new Error("Hard token cap would be exceeded");
    const limits = this.limit.quota[vendor];
    if (!limits) throw new Error("Missing allowance budget for provider");
    const windows = await this.refresh(vendor);
    for (const w of windows) {
      const short = w.kind === "session";
      const debit = calls * (short ? limits.shortPpPerCall : limits.weeklyPpPerCall);
      if (this.effectiveRemaining(w) - debit < (short ? limits.reserveShortPp : limits.reserveWeeklyPp) ||
          Math.max(w.observed, w.reserved) + debit > (short ? limits.maxShortPp : limits.maxWeeklyPp)) throw new Error("Quota cap or reserve would be exceeded");
    }
  }

  async call<T>(vendor: Vendor, tokenReservation: number, run: () => Promise<{ value: T; tokens: number }>): Promise<T> {
    for (let attempt = 0; attempt <= 1; attempt++) {
      stopCheck(this.stop);
      await this.reserve(vendor, 1, tokenReservation);
      stopCheck(this.stop);
      const limits = this.limit.quota[vendor]!;
      for (const w of this.state.windows[vendor]!) {
        const short = w.kind === "session";
        w.reserved += short ? limits.shortPpPerCall : limits.weeklyPpPerCall;
      }
      this.state.attempts++;
      this.state.tokens += tokenReservation;
      this.state.uncertain = true;
      saveJson(this.file, this.state);
      let answer: { value: T; tokens: number } | undefined;
      let failure: unknown;
      try { answer = await run(); }
      catch (error) { failure = error; }
      // Poll again once the throttle interval has elapsed; otherwise check conservative reserves.
      const windows = await this.refresh(vendor);
      for (const w of windows) {
        const short = w.kind === "session";
        if (this.effectiveRemaining(w) < (short ? limits.reserveShortPp : limits.reserveWeeklyPp) ||
            Math.max(w.observed, w.reserved) > (short ? limits.maxShortPp : limits.maxWeeklyPp)) {
          saveJson(this.file, this.state);
          throw new Error("Observed quota cap or reserve breached");
        }
      }
      if (answer) {
        if (!Number.isSafeInteger(answer.tokens) || answer.tokens < 0 || answer.tokens > tokenReservation) throw new Error("Usage exceeded the call reservation");
        this.state.tokens += answer.tokens - tokenReservation;
        this.state.uncertain = false;
        saveJson(this.file, this.state);
        return answer.value;
      }
      if (!(failure instanceof TransportFailure) || attempt === 1) throw failure;
      // Keep the failed attempt's entire reservation charged.
      this.state.uncertain = false;
      saveJson(this.file, this.state);
    }
    throw new Error("Retry limit reached");
  }
}

export function assertPrivateDirectory(path: string) {
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0) {
    throw new Error("Use an owned private directory with mode 0700");
  }
}
