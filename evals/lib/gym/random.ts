import { createHash } from "node:crypto";

export const GYM_GENERATOR_VERSION = 1;

/** SHA-256 derives independent 32-bit keys. Mulberry32 advances each key with uint32 arithmetic. */
type Stream = "scenario" | "controller" | `${"sampling" | "sensors"}:${"machine" | "scale"}`;

export function gymRandom(session: string, seed: number, stream: Stream) {
  let state = createHash("sha256").update(JSON.stringify([GYM_GENERATOR_VERSION, session, seed, stream])).digest().readUInt32LE();
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), state | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
