/**
 * Deterministic PRNG. The engine never calls `Math.random` — a game must be
 * reproducible from its seed and its action log, or a desync is unfixable and a
 * bug report is unusable.
 *
 * mulberry32: 32-bit state, good distribution, four lines.
 */

export function nextSeed(seed: number): number {
  return (seed + 0x6d2b79f5) | 0;
}

export function random(seed: number): number {
  let t = (seed + 0x6d2b79f5) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Fisher-Yates using the seeded stream. Returns the shuffled copy and the new seed. */
export function shuffle<T>(items: readonly T[], seed: number): [T[], number] {
  const out = [...items];
  let s = seed;
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random(s) * (i + 1));
    s = nextSeed(s);
    const a = out[i] as T;
    const b = out[j] as T;
    out[i] = b;
    out[j] = a;
  }
  return [out, s];
}
