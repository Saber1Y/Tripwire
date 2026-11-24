"use client";

import { useState } from "react";
import { useConnection } from "wagmi";
import { OrderForm, type DraftWire } from "@/components/OrderForm";
import { OrdersPanel } from "@/components/OrdersPanel";
import { PriceWire } from "@/components/PriceWire";
import { Sandbox } from "@/components/Sandbox";
import { SystemPanel } from "@/components/SystemPanel";
import { TopBar } from "@/components/TopBar";
import { INDEXER_URL, useOrders, usePool, useSwaps } from "@/lib/indexer";

export default function Page() {
  const connection = useConnection();
  const owner = connection.status === "connected" ? connection.address : undefined;
  const pool = usePool();
  const swaps = useSwaps();
  const orders = useOrders();
  const [draft, setDraft] = useState<DraftWire | null>(null);

  return (
    <>
      <TopBar />
      <main className="mx-auto grid max-w-[1240px] gap-5 px-4 pt-6 pb-16 md:px-6 md:pt-8">
        <div className="max-w-2xl">
          <h1 className="text-2xl font-semibold tracking-[-0.02em] text-balance md:text-[28px]">
            Stop-loss for Uniswap V4 that fires on-chain in about two blocks.
          </h1>
          <p className="mt-2 text-[15px] leading-relaxed text-pretty text-ink-2">
            Set a price wire. Reactive Network watches every swap in the pool and calls the vault the moment one crosses
            it. No bot of yours has to stay online, and the vault re-checks the price before it trades.
          </p>
        </div>

        {pool.isError && (
          <div role="alert" className="rounded-lg border border-bad/50 bg-bad/10 px-4 py-3 text-sm">
            The indexer at <span className="font-mono">{INDEXER_URL}</span> isn&apos;t answering. Start it with{" "}
            <span className="font-mono">node indexer/src/main.ts</span> to see live prices and orders.
          </div>
        )}

        <section className="rounded-xl border border-line bg-panel p-4 md:p-6">
          <PriceWire swaps={swaps.data ?? []} pool={pool.data} orders={orders.data ?? []} owner={owner} draft={draft} />
        </section>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <div className="grid content-start gap-5">
            <OrderForm pool={pool.data} onDraftChange={setDraft} />
            <Sandbox />
          </div>
          <div className="grid content-start gap-5">
            <OrdersPanel orders={orders.data ?? []} loading={orders.isPending} error={orders.isError} />
            <SystemPanel />
          </div>
        </div>
      </main>
    </>
  );
}
