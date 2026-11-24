"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { formatUnits } from "viem";
import { useConnection, useWriteContract } from "wagmi";
import { appChain, explorer } from "@/lib/chains";
import { deployment, tokenLabel, vaultAbi } from "@/lib/contracts";
import type { Attempt, Leg, OrderView } from "@/lib/indexer";
import { displayStatus } from "@/lib/orderStatus";
import { formatPrice, sqrtX96ToPrice } from "@/lib/price";
import { useTx } from "@/lib/useTx";
import { TxNotice } from "./TxNotice";
import { Button, ExternalLink, Eyebrow, Panel, StatusChip, cx, shortHash, toneDot } from "./ui";

const amountFmt = (wei: string) =>
  Number(formatUnits(BigInt(wei), 18)).toLocaleString("en-US", { maximumFractionDigits: 6 });

const clock = new Intl.DateTimeFormat("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

function Node({ title, leg, tone, note }: { title: string; leg: Leg | null; tone: "wire" | "good" | "bad" | "muted" | "pending"; note?: string }) {
  return (
    <li className="relative min-w-0 flex-1">
      <span aria-hidden className={cx("block size-2.5 rounded-full ring-4 ring-panel", leg ? toneDot[tone] : "bg-ink-3/40")} />
      <p className="mt-2 text-[13px] text-ink">{title}</p>
      {leg ? (
        <>
          <p className="mt-0.5 truncate font-mono text-[11px] text-ink-3">
            {leg.chain === "lasna" ? "Lasna" : "Unichain"} #{leg.block.toLocaleString("en-US")}
          </p>
          <ExternalLink href={explorer[leg.chain]("tx", leg.tx)} className="block font-mono text-[11px] text-ink-2">
            {shortHash(leg.tx)}
          </ExternalLink>
          {leg.chain === "unichain" ? (
            <p className="font-mono text-[11px] text-ink-3">{clock.format(leg.blockTs * 1000)}</p>
          ) : (
            <p className="font-mono text-[11px] text-ink-3" title="Lasna stamps blocks on its own clock, so its time isn't comparable with Unichain's">
              Lasna clock
            </p>
          )}
        </>
      ) : (
        <p className="mt-0.5 font-mono text-[11px] text-ink-3">{note ?? "waiting…"}</p>
      )}
    </li>
  );
}

function AttemptRow({ a, amountIn, outLabel }: { a: Attempt; amountIn: string; outLabel: string }) {
  const outcome = a.outcome;
  const outcomeTitle =
    outcome === null
      ? "Callback in flight"
      : outcome.kind === "executed"
        ? "Executed"
        : outcome.kind === "rejected"
          ? `Refused: ${outcome.reason === "PriceNotCrossed" ? "price moved back" : outcome.reason === "SwapFailed" ? "below minimum" : "order closed"}`
          : "Callback failed";
  const outcomeTone = outcome === null ? "pending" : outcome.kind === "executed" ? "good" : "bad";

  return (
    <div className="min-w-0 rounded-lg border border-line bg-bg p-3">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <Eyebrow>Attempt {a.attempt}</Eyebrow>
        {a.latency.unichainBlocks !== null && (
          <span className="font-mono text-[11px] text-ink-2 tabular-nums">
            {a.latency.unichainBlocks} blocks · {a.latency.blockSeconds} s
            {a.latency.wallMsApprox !== null && (
              <span className="text-ink-3"> · ≈{(a.latency.wallMsApprox / 1000).toFixed(2)} s wall</span>
            )}
          </span>
        )}
      </div>
      <div className="relative">
        <span aria-hidden className="absolute top-[4px] right-4 left-1 h-px bg-line-strong" />
        <ol className="relative flex gap-3">
          <Node title={`Crossed at ${formatPrice(sqrtX96ToPrice(a.observedSqrtPriceX96))}`} leg={a.origin} tone="wire" note="swap not indexed" />
          <Node title="Reactive fired" leg={a.reactive} tone="pending" />
          <Node title={outcomeTitle} leg={outcome?.leg ?? null} tone={outcomeTone} />
        </ol>
      </div>
      {outcome?.kind === "executed" && (
        <p className="mt-3 text-sm text-ink-2">
          Received <span className="font-mono text-ink">{amountFmt(outcome.amountOut)} {outLabel}</span>, an average
          price of{" "}
          <span className="font-mono text-ink">
            {formatPrice(Number(BigInt(outcome.amountOut)) / Number(BigInt(amountIn)))}
          </span>
          . Pool price after the fill: {formatPrice(sqrtX96ToPrice(outcome.executionSqrtPriceX96))}.
        </p>
      )}
    </div>
  );
}

function OrderRow({ o, mine, onCancel, cancelling }: { o: OrderView; mine: boolean; onCancel: () => void; cancelling: boolean }) {
  const [open, setOpen] = useState(false);
  const s = displayStatus(o);
  const inLabel = tokenLabel[o.zeroForOne ? 0 : 1];
  const cancellable = mine && o.status === "open";

  return (
    <li className="border-t border-line first:border-t-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="grid w-full grid-cols-[auto_1fr_auto] items-center gap-x-3 py-3 text-left transition-colors hover:bg-raised/40"
      >
        <span className="font-mono text-xs text-ink-3 tabular-nums">#{o.id}</span>
        <span className="min-w-0">
          <span className="block truncate text-sm text-ink">
            {o.isStopLoss ? "Stop-loss" : "Take-profit"} · sell {amountFmt(o.amountIn)} {inLabel}
          </span>
          <span className="block font-mono text-[11px] text-ink-3">
            {o.firesBelow ? "≤" : "≥"} {formatPrice(sqrtX96ToPrice(o.triggerSqrtPriceX96))}
            {o.attempts.length > 0 && ` · ${o.attempts.length}/${o.maxAttempts} attempts`}
          </span>
        </span>
        <StatusChip label={s.label} tone={s.tone} live={s.live} />
      </button>

      {open && (
        <div className="grid min-w-0 gap-3 pb-4">
          <p className="text-sm text-ink-2">{s.detail}</p>
          {o.attempts.length === 0 ? (
            <p className="font-mono text-[11px] text-ink-3">
              created{" "}
              <ExternalLink href={explorer.unichain("tx", o.created.tx)}>{shortHash(o.created.tx)}</ExternalLink>
              {o.armed && (
                <>
                  {" · armed on Lasna "}
                  <ExternalLink href={explorer.lasna("tx", o.armed.tx)}>{shortHash(o.armed.tx)}</ExternalLink>
                </>
              )}
            </p>
          ) : (
            o.attempts.map((a) => (
              <AttemptRow
                key={`${a.attempt}-${a.reactive.tx}`}
                a={a}
                amountIn={o.amountIn}
                outLabel={tokenLabel[o.zeroForOne ? 1 : 0]}
              />
            ))
          )}
          {cancellable && (
            <Button variant="danger" onClick={onCancel} disabled={cancelling} className="justify-self-start">
              {cancelling ? "Cancelling…" : "Cancel & refund"}
            </Button>
          )}
        </div>
      )}
    </li>
  );
}

export function OrdersPanel({ orders, loading, error }: { orders: readonly OrderView[]; loading: boolean; error: boolean }) {
  const connection = useConnection();
  const owner = connection.status === "connected" ? connection.address.toLowerCase() : undefined;
  const onChain = connection.status === "connected" && connection.chainId === appChain.id;
  const [scope, setScope] = useState<"mine" | "all">("mine");
  const write = useWriteContract();
  const tx = useTx();
  const [cancelling, setCancelling] = useState<number | null>(null);
  const queryClient = useQueryClient();

  const showMine = owner !== undefined && scope === "mine";
  const visible = showMine ? orders.filter((o) => o.owner === owner) : orders;

  async function cancel(id: number) {
    setCancelling(id);
    const ok = await tx.run(`Cancel #${id}`, () =>
      write.mutateAsync({ address: deployment.vault, abi: vaultAbi, functionName: "cancelOrder", args: [BigInt(id)] }),
    );
    setCancelling(null);
    if (ok) void queryClient.invalidateQueries({ queryKey: ["orders"] });
  }

  return (
    <Panel
      title="Tripwires"
      aside={
        owner !== undefined ? (
          <div className="flex gap-1 font-mono text-[10.5px] uppercase tracking-[0.12em]">
            {(["mine", "all"] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setScope(v)}
                aria-pressed={scope === v}
                className={cx("rounded px-2 py-1 transition-colors", scope === v ? "bg-raised text-ink" : "text-ink-3 hover:text-ink-2")}
              >
                {v === "mine" ? "Mine" : "Everyone"}
              </button>
            ))}
          </div>
        ) : (
          <span className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-3">Everyone</span>
        )
      }
    >
      {error ? (
        <p className="text-sm text-bad">Can&apos;t reach the indexer, so orders can&apos;t be listed right now.</p>
      ) : loading ? (
        <p className="text-sm text-ink-3">Loading orders…</p>
      ) : visible.length === 0 ? (
        <p className="text-sm text-ink-3">
          {showMine ? "You have no tripwires yet. Set one on the left." : "No tripwires have been set yet."}
        </p>
      ) : (
        <ul>
          {visible.map((o) => (
            <OrderRow
              key={o.id}
              o={o}
              mine={o.owner === owner && onChain}
              onCancel={() => void cancel(o.id)}
              cancelling={cancelling === o.id}
            />
          ))}
        </ul>
      )}
      <TxNotice state={tx.state} onDismiss={tx.reset} />
    </Panel>
  );
}
