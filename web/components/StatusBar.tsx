"use client";

import { formatEther } from "viem";
import { useBalances, useHealth, useLatency } from "@/lib/indexer";
import { cx } from "./ui";

const LOW = { vault: 0.0005, reactive: 0.2 };

function Item({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <span className="flex items-center gap-1.5 whitespace-nowrap">
      <span className="text-ink-3">{label}</span>
      <span className={cx(warn ? "text-pending" : "text-ink-2")}>{value}</span>
    </span>
  );
}

/** The terminal's bottom rail: is the system healthy, how fast is it, can it keep paying for loops. */
export function StatusBar() {
  const health = useHealth();
  const latency = useLatency();
  const balances = useBalances();

  const lagging = health.data?.chains.some((c) => c.lagBlocks !== null && Number(c.lagBlocks) > 3) ?? false;
  const vault = balances.data ? Number(formatEther(BigInt(balances.data.vault.reserves))) : undefined;
  const reactive = balances.data ? Number(formatEther(BigInt(balances.data.reactive.reserves))) : undefined;
  const median = latency.data?.unichainBlocks.median;

  return (
    <footer className="sticky bottom-0 z-20 border-t border-line bg-bg/95 backdrop-blur-md">
      <div className="flex h-8 items-center gap-5 overflow-x-auto px-4 font-mono text-[11px]">
        <span className="flex items-center gap-1.5 whitespace-nowrap">
          <span
            aria-hidden
            className={cx("size-1.5 rounded-full", health.isError ? "bg-bad" : lagging ? "bg-pending" : "bg-good")}
          />
          <span className="text-ink-2">{health.isError ? "Indexer offline" : lagging ? "Indexer catching up" : "Indexer in sync"}</span>
        </span>
        <Item label="median loop" value={median == null ? "-" : `${median} blocks`} />
        <Item label="loops" value={latency.data ? String(latency.data.loops) : "-"} />
        <Item
          label="vault reserve"
          value={vault === undefined ? "-" : `${vault.toFixed(5)} ETH`}
          warn={vault !== undefined && vault < LOW.vault}
        />
        <Item
          label="reactive reserve"
          value={reactive === undefined ? "-" : `${reactive.toFixed(3)} lREACT`}
          warn={reactive !== undefined && reactive < LOW.reactive}
        />
        <span className="ml-auto hidden whitespace-nowrap text-ink-3 sm:inline">Testnet only</span>
      </div>
    </footer>
  );
}
