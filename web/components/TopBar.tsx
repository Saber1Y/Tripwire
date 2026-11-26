"use client";

import { useConnection, useDisconnect, useSwitchChain } from "wagmi";
import { appChain } from "@/lib/chains";
import { useHealth } from "@/lib/indexer";
import { Wordmark } from "./Brand";
import { useOpenWalletPicker } from "./WalletPickerProvider";
import { cx, shortHash } from "./ui";

function ChainPulse({ name, head, lag }: { name: string; head: string | null; lag: number | null }) {
  const healthy = lag !== null && lag <= 3;
  return (
    <div className="flex items-center gap-2 font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-3">
      <span
        aria-hidden
        className={cx("size-1.5 rounded-full", healthy ? "bg-good breathe" : lag === null ? "bg-ink-3" : "bg-pending")}
      />
      <span className="text-ink-2">{name}</span>
      <span className="tabular-nums">{head === null ? "-" : `#${Number(head).toLocaleString("en-US")}`}</span>
      {lag !== null && lag > 3 && <span className="text-pending">{lag} behind</span>}
    </div>
  );
}

function WalletButton() {
  const connection = useConnection();
  const openPicker = useOpenWalletPicker();
  const disconnect = useDisconnect();
  const switchChain = useSwitchChain();

  if (connection.status !== "connected") {
    return (
      <button
        type="button"
        disabled={connection.status === "reconnecting" || connection.status === "connecting"}
        onClick={openPicker}
        className="h-9 rounded-lg bg-ink px-4 text-sm font-medium text-bg transition-[filter,transform] duration-150 hover:brightness-90 active:scale-[0.98] disabled:opacity-60"
      >
        {connection.status === "connecting" ? "Connecting…" : connection.status === "reconnecting" ? "Reconnecting…" : "Connect wallet"}
      </button>
    );
  }

  if (connection.chainId !== appChain.id) {
    return (
      <button
        type="button"
        disabled={switchChain.isPending}
        onClick={() => switchChain.mutate({ chainId: appChain.id })}
        className="h-9 rounded-lg border border-pending/60 px-4 text-sm font-medium text-ink transition-colors hover:bg-pending/10"
      >
        {switchChain.isPending ? "Switching…" : "Switch to Unichain Sepolia"}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => disconnect.mutate()}
      title="Disconnect"
      className="group flex h-9 items-center gap-2 rounded-lg border border-line px-3 font-mono text-xs text-ink-2 transition-colors hover:border-line-strong hover:text-ink"
    >
      <span aria-hidden className="size-1.5 rounded-full bg-good" />
      <span className="group-hover:hidden">{shortHash(connection.address, 6, 4)}</span>
      <span className="hidden group-hover:inline">Disconnect</span>
    </button>
  );
}

export function TopBar() {
  const health = useHealth();
  const chain = (name: string) => health.data?.chains.find((c) => c.chain === name);
  const uni = chain("unichain");
  const lasna = chain("lasna");

  return (
    <header className="sticky top-0 z-20 border-b border-line bg-bg/90 backdrop-blur-md">
      <div className="flex h-12 items-center justify-between gap-4 px-4">
        <div className="flex items-center gap-6">
          <Wordmark />
          <div className="hidden items-center gap-5 border-l border-line pl-6 md:flex">
            {health.isError ? (
              <span className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-bad">Indexer offline</span>
            ) : (
              <>
                <ChainPulse name="Unichain" head={uni?.head ?? null} lag={uni?.lagBlocks == null ? null : Number(uni.lagBlocks)} />
                <ChainPulse name="Lasna" head={lasna?.head ?? null} lag={lasna?.lagBlocks == null ? null : Number(lasna.lagBlocks)} />
              </>
            )}
          </div>
        </div>
        <WalletButton />
      </div>
    </header>
  );
}
