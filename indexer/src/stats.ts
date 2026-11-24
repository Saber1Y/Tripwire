import type { Attempt } from "./timeline.ts";

export interface Distribution {
  readonly count: number;
  readonly min: number | null;
  readonly median: number | null;
  readonly p95: number | null;
  readonly max: number | null;
}

/** Nearest-rank percentile on a sorted array (no interpolation, so every reported value was actually observed). */
export function percentile(sorted: readonly number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1] ?? null;
}

export function distribution(values: readonly number[]): Distribution {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    count: sorted.length,
    min: sorted[0] ?? null,
    median: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    max: sorted.at(-1) ?? null,
  };
}

/** Same-chain measures only; see Latency in timeline.ts for why. */
export interface LatencySummary {
  /** Attempts with an outcome on Unichain. */
  readonly loops: number;
  readonly unichainBlocks: Distribution;
  readonly blockSeconds: Distribution;
  readonly wallMsApprox: Distribution;
}

const values = (attempts: readonly Attempt[], pick: (a: Attempt) => number | null): number[] =>
  attempts.flatMap((a) => {
    const v = pick(a);
    return v === null ? [] : [v];
  });

export function summarise(attempts: readonly Attempt[]): LatencySummary {
  const done = attempts.filter((a) => a.outcome !== null);
  return {
    loops: done.length,
    unichainBlocks: distribution(values(done, (a) => a.latency.unichainBlocks)),
    blockSeconds: distribution(values(done, (a) => a.latency.blockSeconds)),
    wallMsApprox: distribution(values(done, (a) => a.latency.wallMsApprox)),
  };
}
