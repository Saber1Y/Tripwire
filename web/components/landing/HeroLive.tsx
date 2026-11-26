"use client";

import { PriceWire } from "@/components/PriceWire";
import { tokenLabel } from "@/lib/contracts";
import { useOrders, usePool, useSwaps } from "@/lib/indexer";
import { formatPrice } from "@/lib/price";

/** The hero's visual is the real product: the live demo pool and every open wire on it. */
export function HeroLive() {
  const pool = usePool();
  const swaps = useSwaps();
  const orders = useOrders();
  const open = (orders.data ?? []).filter((o) => o.status === "open").length;

  return (
    <figure className="rounded-2xl border border-line bg-panel p-5 shadow-[0_30px_80px_-40px_rgb(236_131_90/0.25)] md:p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm text-ink-2">
            {tokenLabel[1]} per {tokenLabel[0]}, Uniswap V4
          </p>
          <p className="mt-1 font-mono text-4xl font-medium tracking-[-0.03em] md:text-5xl">
            {pool.data ? formatPrice(pool.data.price) : <span className="text-ink-3">loading</span>}
          </p>
        </div>
        <p className="flex items-center gap-2 rounded-full border border-line px-3 py-1 text-xs text-ink-2">
          <span
            aria-hidden
            className={pool.isError ? "size-1.5 rounded-full bg-bad" : "breathe size-1.5 rounded-full bg-good"}
          />
          {pool.isError ? "Indexer offline" : "Live on Unichain Sepolia"}
        </p>
      </div>
      <div className="mt-6">
        {pool.isError ? (
          <p className="flex h-[220px] items-center justify-center text-center text-sm text-ink-3">
            Start the indexer to see the live pool here.
          </p>
        ) : (
          <PriceWire
            swaps={swaps.data ?? []}
            pool={pool.data}
            orders={orders.data ?? []}
            owner={undefined}
            showHeader={false}
            fixedHeight={220}
          />
        )}
      </div>
      <figcaption className="mt-4 text-sm text-ink-3">
        {open === 0
          ? "No wires armed right now. Fills are marked in green where they happened."
          : `${open} ${open === 1 ? "wire is" : "wires are"} armed on this pool right now.`}
      </figcaption>
    </figure>
  );
}
