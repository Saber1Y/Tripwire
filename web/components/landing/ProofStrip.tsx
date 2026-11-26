"use client";

import { useLatency } from "@/lib/indexer";
import { Reveal } from "./Reveal";

function Figure({ value, unit, label }: { value: string; unit: string; label: string }) {
  return (
    <div className="border-t border-line-strong pt-5">
      <p className="font-mono text-5xl font-medium tracking-[-0.05em] md:text-7xl">
        {value}
        <span className="ml-2 text-xl tracking-normal text-ink-3 md:text-2xl">{unit}</span>
      </p>
      <p className="mt-3 max-w-[28ch] text-sm leading-relaxed text-ink-2">{label}</p>
    </div>
  );
}

/** Live numbers from the indexer. Same-chain measures only, see docs/latency-methodology.md. */
export function ProofStrip() {
  const latency = useLatency();
  const l = latency.data;
  const show = (v: number | null | undefined, digits = 0) => (v === null || v === undefined ? "-" : v.toFixed(digits));

  return (
    <section id="proof" className="scroll-mt-20 border-y border-line bg-panel">
      <div className="mx-auto max-w-[1240px] px-4 py-20 md:px-6 md:py-28">
        <h2 className="max-w-2xl text-3xl font-semibold tracking-[-0.035em] md:text-5xl">Measured on-chain, not promised.</h2>
        <p className="mt-5 max-w-[60ch] text-lg leading-relaxed text-ink-2">
          Counted in Unichain blocks from the crossing swap to the execution, so anyone can check them from the
          transaction hashes.
        </p>
        {latency.isError ? (
          <p className="mt-12 text-ink-3">The indexer is offline, so live figures are unavailable right now.</p>
        ) : (
          <div className="mt-14 grid gap-10 sm:grid-cols-2 lg:grid-cols-[1.3fr_1fr_1fr]">
            <Reveal>
              <Figure value={show(l?.unichainBlocks.median)} unit="blocks" label="Median from the crossing swap to the fill, on Unichain Sepolia." />
            </Reveal>
            <Reveal delay={0.08}>
              <Figure value={show(l?.unichainBlocks.p95)} unit="blocks" label="95th percentile. The slow end is still a couple of seconds." />
            </Reveal>
            <Reveal delay={0.16}>
              <Figure
                value={l === undefined ? "-" : String(l.loops)}
                unit={l?.loops === 1 ? "loop" : "loops"}
                label={
                  l?.wallMsApprox.median != null
                    ? `Measured so far. Live wall clock ≈ ${(l.wallMsApprox.median / 1000).toFixed(1)} s, within RPC jitter.`
                    : "Measured so far, all executed on-chain with no off-chain bot."
                }
              />
            </Reveal>
          </div>
        )}
      </div>
    </section>
  );
}
