"use client";

import { useEffect, useState } from "react";
import { rejectReasons, retireReasons } from "../../indexer/src/abi.ts";
import { explorer } from "@/lib/chains";
import { useActivity, type ActivityEvent } from "@/lib/indexer";
import type { Tone } from "@/lib/orderStatus";
import { cx, shortHash, toneDot } from "./ui";

function describe(e: ActivityEvent): { label: string; tone: Tone } {
  const reason = (list: readonly string[]) => list[Number(e.args["reason"])] ?? String(e.args["reason"]);
  switch (e.name) {
    case "OrderCreated":
      return { label: "Order placed", tone: "muted" };
    case "OrderArmed":
      return { label: "Armed by Reactive", tone: "wire" };
    case "OrderTriggered":
      return { label: `Fired, attempt ${String(e.args["attempt"])}`, tone: "pending" };
    case "OrderRearmed":
      return { label: "Re-armed", tone: "wire" };
    case "OrderExecuted":
      return { label: "Executed", tone: "good" };
    case "OrderRejected":
      return { label: `Refused: ${reason(rejectReasons)}`, tone: "bad" };
    case "CallbackFailure":
      return { label: "Callback failed", tone: "bad" };
    case "OrderCancelled":
      return { label: "Cancelled", tone: "muted" };
    case "OrderRetired":
      return { label: `Retired: ${reason(retireReasons)}`, tone: "muted" };
    default:
      return { label: e.name, tone: "muted" };
  }
}

/**
 * Relative time only: the two chains stamp blocks about a second apart, which is invisible at this granularity but
 * would make exact clock times look out of order.
 */
function ago(seconds: number): string {
  if (seconds < 60) return "just now";
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.floor(h / 24)} days ago`;
}

export function ActivityFeed() {
  const activity = useActivity();
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 15_000);
    return () => clearInterval(id);
  }, []);

  if (activity.isError) return <p className="p-4 text-sm text-bad">The indexer is offline, so activity can&apos;t load.</p>;
  if (activity.isPending) {
    return (
      <ul className="grid gap-px p-4" aria-busy>
        {Array.from({ length: 6 }, (_, i) => (
          <li key={i} className="h-9 animate-pulse rounded bg-raised/60" />
        ))}
      </ul>
    );
  }
  if (activity.data.length === 0) {
    return <p className="p-4 text-sm text-ink-3">Nothing has happened yet. Arm an order and every step shows up here.</p>;
  }

  return (
    <ol aria-label="Activity on both chains, newest first">
      {activity.data.map((e) => {
        const d = describe(e);
        return (
          <li
            key={`${e.chain}-${e.tx}-${e.name}-${e.orderId}`}
            className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-0.5 border-b border-line px-4 py-2.5 text-sm sm:grid-cols-[110px_88px_minmax(0,1fr)_auto]"
          >
            <span className="font-mono text-xs text-ink-3 sm:order-none">{ago(now - e.blockTs)}</span>
            <span className="hidden font-mono text-xs text-ink-3 sm:inline">{e.chain === "lasna" ? "Lasna" : "Unichain"}</span>
            <span className="col-span-2 flex min-w-0 items-center gap-2 sm:col-span-1">
              <span aria-hidden className={cx("size-1.5 shrink-0 rounded-full", toneDot[d.tone])} />
              <span className="truncate text-ink">{d.label}</span>
              {e.orderId !== null && <span className="font-mono text-xs text-ink-3">#{e.orderId}</span>}
            </span>
            <a
              href={explorer[e.chain]("tx", e.tx)}
              target="_blank"
              rel="noreferrer"
              className="col-start-2 row-start-1 font-mono text-xs text-ink-2 underline decoration-line-strong underline-offset-4 hover:text-ink sm:col-start-auto sm:row-start-auto"
            >
              {shortHash(e.tx)}
            </a>
          </li>
        );
      })}
    </ol>
  );
}
