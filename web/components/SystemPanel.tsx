"use client";

import { formatEther } from "viem";
import { deployment, callbackProxy } from "@/lib/contracts";
import { explorer } from "@/lib/chains";
import { useBalances, useLatency, type Distribution } from "@/lib/indexer";
import { ExternalLink, Eyebrow, Panel, StatusChip, shortHash } from "./ui";

/** Below these, a few more loops could push a contract into debt, which stops it until topped up. */
const LOW = { vault: 0.0005, reactive: 0.2 };

function Stat({ label, value, unit, hint }: { label: string; value: string; unit?: string; hint?: string }) {
  return (
    <div className="border-t border-line pt-3">
      <Eyebrow>{label}</Eyebrow>
      <p className="mt-2 font-mono text-2xl font-medium tracking-[-0.03em] tabular-nums">
        {value}
        {unit && <span className="ml-1 text-sm text-ink-3">{unit}</span>}
      </p>
      {hint && <p className="mt-1 text-xs text-ink-3">{hint}</p>}
    </div>
  );
}

const fmt = (d: Distribution, key: "median" | "p95" | "max", digits = 0) =>
  d[key] === null ? "—" : (d[key] as number).toFixed(digits);

function Budget({
  label,
  reserves,
  debt,
  unit,
  low,
  href,
}: {
  label: string;
  reserves: string | undefined;
  debt: string | undefined;
  unit: string;
  low: number;
  href: string;
}) {
  const r = reserves === undefined ? undefined : Number(formatEther(BigInt(reserves)));
  const inDebt = debt !== undefined && BigInt(debt) > 0n;
  const isLow = r !== undefined && r < low;
  return (
    <div className="flex items-center justify-between gap-3 border-t border-line py-3">
      <div className="min-w-0">
        <p className="text-sm text-ink">{label}</p>
        <ExternalLink href={href} className="font-mono text-[11px] text-ink-3">
          prepaid reserve
        </ExternalLink>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <p className="font-mono text-sm tabular-nums">
          {r === undefined ? "—" : r.toFixed(unit === "ETH" ? 5 : 3)} <span className="text-ink-3">{unit}</span>
        </p>
        {inDebt ? (
          <StatusChip label="In debt · paused" tone="bad" />
        ) : isLow ? (
          <StatusChip label="Running low" tone="pending" />
        ) : r !== undefined ? (
          <StatusChip label="Funded" tone="good" />
        ) : null}
      </div>
    </div>
  );
}

export function SystemPanel() {
  const latency = useLatency();
  const balances = useBalances();
  const l = latency.data;

  return (
    <Panel
      title="Loop latency"
      aside={l ? <span className="font-mono text-[10.5px] text-ink-3">{l.loops} loops measured</span> : undefined}
    >
      {latency.isError ? (
        <p className="text-sm text-bad">Can&apos;t reach the indexer. Latency appears once it is running.</p>
      ) : l === undefined ? (
        <p className="text-sm text-ink-3">Loading…</p>
      ) : l.loops === 0 ? (
        <p className="text-sm text-ink-3">No orders have fired yet. Arm one and move the price to measure a loop.</p>
      ) : (
        <>
          <p className="text-xs leading-relaxed text-ink-2">
            From the swap that crosses a trigger to the vault executing it, measured on Unichain&apos;s own blocks.
          </p>
          <div className="mt-4 grid grid-cols-2 gap-x-5">
            <Stat label="Median" value={fmt(l.unichainBlocks, "median")} unit="blocks" hint={`${fmt(l.blockSeconds, "median")} s`} />
            <Stat label="p95" value={fmt(l.unichainBlocks, "p95")} unit="blocks" hint={`${fmt(l.blockSeconds, "p95")} s`} />
          </div>
          <p className="mt-4 text-xs leading-relaxed text-ink-3">
            Wall clock ≈{" "}
            <span className="font-mono text-ink-2">
              {l.wallMsApprox.median === null ? "—" : `${(l.wallMsApprox.median / 1000).toFixed(2)} s`}
            </span>{" "}
            median over {l.wallMsApprox.count} live {l.wallMsApprox.count === 1 ? "loop" : "loops"}, ± about half a second of RPC jitter. Lasna and Unichain stamp
            blocks differently, so the loop is not split into legs: those numbers would be noise.
          </p>
        </>
      )}

      <div className="mt-6">
        <Eyebrow>Who pays for the loop</Eyebrow>
        <div className="mt-2">
          <Budget
            label="Vault callbacks · Unichain"
            reserves={balances.data?.vault.reserves}
            debt={balances.data?.vault.debt}
            unit="ETH"
            low={LOW.vault}
            href={explorer.unichain("address", callbackProxy)}
          />
          <Budget
            label="Reactions · Lasna"
            reserves={balances.data?.reactive.reserves}
            debt={balances.data?.reactive.debt}
            unit="lREACT"
            low={LOW.reactive}
            href={explorer.lasna("address", deployment.reactive)}
          />
        </div>
        <p className="mt-2 font-mono text-[11px] text-ink-3">
          vault <ExternalLink href={explorer.unichain("address", deployment.vault)}>{shortHash(deployment.vault)}</ExternalLink>
          {" · "}reactive{" "}
          <ExternalLink href={explorer.lasna("address", deployment.reactive)}>{shortHash(deployment.reactive)}</ExternalLink>
        </p>
      </div>
    </Panel>
  );
}
