import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { MACHINE_GAP_S } from "../../server/profiles/phase-evidence.js";

export function digest(value: unknown): string {
  const json = JSON.stringify(value, (_, item: unknown) => {
    if (item === null || typeof item !== "object" || Array.isArray(item)) return item;
    return Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
  });
  return sha256(json ?? "undefined");
}

export const sha256 = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");

const hex = z.string().regex(/^[a-f0-9]{64}$/);
const manifestCase = z.strictObject({ caseId: z.string().min(1), caseDigest: hex, inputDigest: hex, labelDigest: hex, requiredChecks: z.array(z.string()).optional() });
const manifestSlot = z.strictObject({ caseId: z.string().min(1), repeat: z.number().int().nonnegative(), digest: hex });
export const EvalManifest = z.strictObject({
  version: z.literal(1), digest: hex, scorer: hex,
  cases: z.array(manifestCase).min(1), slots: z.array(manifestSlot).min(1),
});
export type EvalManifest = z.infer<typeof EvalManifest>;
export type ManifestCase = z.infer<typeof manifestCase>;
type Slot = Pick<z.infer<typeof manifestSlot>, "caseId" | "repeat">;

export function caseDigests(caseId: string, metadata: unknown, input: unknown, label: unknown, requiredChecks?: string[]): ManifestCase {
  return { caseId, caseDigest: digest(metadata), inputDigest: digest(input), labelDigest: digest(label), requiredChecks };
}

export function scorerFingerprint(kind: "legacy" | "ablation") {
  const files = kind === "legacy"
    ? ["../compare.ts", "graders.ts", "review-grader.ts", "judge.ts", "tasks.ts", "provenance.ts", "report.ts"]
    : ["review-metrics.ts", "review-labels.ts", "review-ablation.ts", "review-ablation-report.ts", "judge.ts", "provenance.ts"];
  const sources = ["manifest.ts", ...files].map(file => [file, sha256(readFileSync(new URL(file, import.meta.url)))]);
  return digest({ sources, maximumTelemetryGapS: kind === "ablation" ? MACHINE_GAP_S : undefined });
}

export const slotKey = ({ caseId, repeat }: Slot) => JSON.stringify([caseId, repeat]);

export function makeEvalManifest(cases: ManifestCase[], slots: Slot[], scorer: string): EvalManifest {
  const ordered = [...cases].sort((a, b) => a.caseId.localeCompare(b.caseId));
  const byId = new Map(ordered.map(c => [c.caseId, c]));
  const repeats = [...slots].sort((a, b) => a.caseId.localeCompare(b.caseId) || a.repeat - b.repeat).map(({ caseId, repeat }) => {
    const c = byId.get(caseId);
    if (!c) throw new Error(`Manifest slot has no case ${caseId}`);
    return { caseId, repeat, digest: digest([c, repeat]) };
  });
  if (ordered.length !== byId.size || repeats.length !== new Set(repeats.map(slotKey)).size) throw new Error("Duplicate manifest case or repeat slot");
  if (!ordered.length || new Set(repeats.map(s => s.caseId)).size !== ordered.length) throw new Error("Manifest requires cases and repeat slots");
  return { version: 1, scorer, cases: ordered, slots: repeats, digest: digest({ cases: ordered, slots: repeats }) };
}

export function verifyEvalManifest(value: unknown, records: Slot[], repeats: number): EvalManifest {
  const parsed = EvalManifest.safeParse(value);
  if (!parsed.success) throw new Error("Missing or invalid evaluation manifest");
  const m = parsed.data;
  if (!Number.isSafeInteger(repeats) || repeats < 1 || m.cases.length * repeats !== m.slots.length) throw new Error("Invalid manifest repeat count");
  const actual = makeEvalManifest(m.cases, m.cases.flatMap(({ caseId }) =>
    Array.from({ length: repeats }, (_, repeat) => ({ caseId, repeat }))), m.scorer);
  if (digest(m) !== digest(actual)) throw new Error("Invalid manifest case or repeat digests");
  const actualSlots = new Set(records.map(slotKey));
  const expectedSlots = new Set(m.slots.map(slotKey));
  const missing = m.slots.filter(s => !actualSlots.has(slotKey(s))).length;
  const extra = records.filter(s => !expectedSlots.has(slotKey(s))).length + records.length - actualSlots.size;
  if (missing || extra) throw new Error(`Unpaired repeat slots: ${missing} missing, ${extra} extra or duplicate`);
  return m;
}

export function manifestMarkdown(m: EvalManifest): string[] {
  const cell = (s: string) => s.replaceAll("|", "\\|").replace(/[\r\n]+/g, " ");
  return [
    "## Evaluation manifest", "", `Panel digest \`${m.digest}\``, `Scorer fingerprint \`${m.scorer}\``, "",
    "| Case | Case digest | Input digest | Label digest | Repeat digests | Required checks |",
    "|---|---|---|---|---|---|",
    ...m.cases.map(c => `| ${cell(c.caseId)} | ${c.caseDigest} | ${c.inputDigest} | ${c.labelDigest} | ${m.slots.filter(s => s.caseId === c.caseId).map(s => `${s.repeat}: ${s.digest}`).join("<br>")} | ${c.requiredChecks?.map(cell).join(", ") ?? "—"} |`),
    "",
  ];
}
