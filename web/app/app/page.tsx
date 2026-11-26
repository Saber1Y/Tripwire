"use client";

import { useState } from "react";
import { useConnection } from "wagmi";
import { ActivityFeed } from "@/components/ActivityFeed";
import { OrderForm, type DraftWire } from "@/components/OrderForm";
import { OrdersPanel } from "@/components/OrdersPanel";
import { PriceWire } from "@/components/PriceWire";
import { Sandbox } from "@/components/Sandbox";
import { StatusBar } from "@/components/StatusBar";
import { SystemPanel } from "@/components/SystemPanel";
import { TopBar } from "@/components/TopBar";
import { cx } from "@/components/ui";
import { INDEXER_URL, useOrders, usePool, useSwaps } from "@/lib/indexer";

type Tab = "orders" | "activity" | "system";

/**
 * Trading-terminal layout: the market on the left with what happened to it underneath, the order ticket pinned on
 * the right, system health along the bottom. Phones get chart, ticket, then tabs.
 */
export default function Dashboard() {
  const connection = useConnection();
  const owner = connection.status === "connected" ? connection.address : undefined;
  const pool = usePool();
  const swaps = useSwaps();
  const orders = useOrders();
  const [draft, setDraft] = useState<DraftWire | null>(null);
  const [tab, setTab] = useState<Tab>("orders");

  const mine = owner === undefined ? [] : (orders.data ?? []).filter((o) => o.owner === owner.toLowerCase());
  const openCount = (owner === undefined ? (orders.data ?? []) : mine).filter((o) => o.status === "open").length;
  const tabs: { id: Tab; label: string; badge?: number }[] = [
    { id: "orders", label: "Orders", badge: openCount || undefined },
    { id: "activity", label: "Activity" },
    { id: "system", label: "System" },
  ];

  return (
    <div className="flex min-h-dvh flex-col">
      <TopBar />

      {pool.isError && (
        <div role="alert" className="border-b border-bad/40 bg-bad/10 px-4 py-2.5 text-sm">
          The indexer at <span className="font-mono">{INDEXER_URL}</span> isn&apos;t answering. Start it with{" "}
          <span className="font-mono">node indexer/src/main.ts</span> to see live prices and orders.
        </div>
      )}

      <div className="grid flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_400px] lg:grid-rows-[auto_1fr]">
        <section className="min-w-0 border-b border-line p-4 md:p-6">
          <PriceWire swaps={swaps.data ?? []} pool={pool.data} orders={orders.data ?? []} owner={owner} draft={draft} />
        </section>

        <aside
          aria-label="Order ticket"
          className="min-w-0 border-b border-line bg-panel lg:sticky lg:top-12 lg:row-span-2 lg:h-[calc(100dvh-5rem)] lg:overflow-y-auto lg:border-b-0 lg:border-l"
        >
          <OrderForm pool={pool.data} onDraftChange={setDraft} />
          <Sandbox />
        </aside>

        <section className="min-w-0">
          <div role="tablist" aria-label="Details" className="flex h-11 items-stretch gap-1 border-b border-line px-2">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                id={`tab-${t.id}`}
                aria-selected={tab === t.id}
                aria-controls={`panel-${t.id}`}
                onClick={() => setTab(t.id)}
                className={cx(
                  "relative flex items-center gap-2 px-3 text-sm transition-colors",
                  tab === t.id ? "text-ink" : "text-ink-3 hover:text-ink-2",
                )}
              >
                {t.label}
                {t.badge !== undefined && (
                  <span className="rounded-full bg-raised px-1.5 font-mono text-[11px] text-ink-2">{t.badge}</span>
                )}
                <span
                  aria-hidden
                  className={cx(
                    "absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-wire transition-opacity duration-150",
                    tab === t.id ? "opacity-100" : "opacity-0",
                  )}
                />
              </button>
            ))}
          </div>
          <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
            {tab === "orders" && <OrdersPanel orders={orders.data ?? []} loading={orders.isPending} error={orders.isError} />}
            {tab === "activity" && <ActivityFeed />}
            {tab === "system" && <SystemPanel />}
          </div>
        </section>
      </div>

      <StatusBar />
    </div>
  );
}
