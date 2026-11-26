"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useMemo, useState } from "react";
import { formatUnits, parseUnits } from "viem";
import { useConnection, useReadContracts, useWriteContract } from "wagmi";
import { appChain } from "@/lib/chains";
import { deployment, erc20Abi, tokenLabel, vaultAbi } from "@/lib/contracts";
import type { PoolState } from "@/lib/indexer";
import {
  applySlippage,
  firesBelow,
  formatPrice,
  outAtTrigger,
  priceToSqrtX96,
  sqrtX96ToPrice,
  triggerProblem,
} from "@/lib/price";
import { useTx } from "@/lib/useTx";
import { TxNotice } from "./TxNotice";
import { Button, Eyebrow, Panel, Segmented, cx } from "./ui";

type Side = "sl" | "tp";
type Sell = "0" | "1";

const SLIPPAGE = [50, 100, 200] as const;
const PRESET_PCT = [0.5, 1, 2] as const;

function parseAmount(v: string): bigint | null {
  try {
    const n = parseUnits(v.trim() === "" ? "0" : v.trim(), 18);
    return n > 0n ? n : null;
  } catch {
    return null;
  }
}

function parseTrigger(v: string): bigint | null {
  try {
    return v.trim() === "" ? null : priceToSqrtX96(v);
  } catch {
    return null;
  }
}

const fmtToken = (n: bigint, digits = 4) =>
  Number(formatUnits(n, 18)).toLocaleString("en-US", { maximumFractionDigits: digits });

export interface DraftWire {
  price: number;
  firesBelow: boolean;
  valid: boolean;
}

export function OrderForm({
  pool,
  onDraftChange,
}: {
  pool: PoolState | undefined;
  onDraftChange?: (draft: DraftWire | null) => void;
}) {
  const ids = { trigger: useId(), amount: useId() };
  const connection = useConnection();
  const owner = connection.status === "connected" ? connection.address : undefined;
  const onChain = connection.status === "connected" && connection.chainId === appChain.id;

  const [side, setSide] = useState<Side>("sl");
  const [sell, setSell] = useState<Sell>("0");
  const [trigger, setTrigger] = useState("");
  const [amount, setAmount] = useState("1");
  const [slippageBps, setSlippageBps] = useState<number>(100);
  const [attempts, setAttempts] = useState(3);

  const zeroForOne = sell === "0";
  const isStopLoss = side === "sl";
  const below = firesBelow(zeroForOne, isStopLoss);
  const tokenIn = zeroForOne ? deployment.token0 : deployment.token1;
  const inLabel = tokenLabel[zeroForOne ? 0 : 1];
  const outLabel = tokenLabel[zeroForOne ? 1 : 0];

  const reads = useReadContracts({
    contracts: owner
      ? [
          { address: tokenIn, abi: erc20Abi, functionName: "balanceOf", args: [owner] },
          { address: tokenIn, abi: erc20Abi, functionName: "allowance", args: [owner, deployment.vault] },
        ]
      : [],
    query: { enabled: owner !== undefined, refetchInterval: 4_000 },
  });
  const balance = reads.data?.[0]?.result;
  const allowance = reads.data?.[1]?.result;

  const amountIn = parseAmount(amount);
  const triggerSqrt = parseTrigger(trigger);
  const current = pool === undefined ? undefined : BigInt(pool.sqrtPriceX96);

  const minOut = useMemo(() => {
    if (amountIn === null || triggerSqrt === null) return null;
    return applySlippage(outAtTrigger(amountIn, triggerSqrt, zeroForOne, deployment.fee), slippageBps);
  }, [amountIn, triggerSqrt, zeroForOne, slippageBps]);

  const problem: string | null = (() => {
    if (pool === undefined) return "Waiting for the pool price…";
    if (trigger.trim() !== "" && triggerSqrt === null) return "Enter the trigger as a positive number, e.g. 0.9850.";
    if (triggerSqrt !== null && current !== undefined) {
      const p = triggerProblem(below, triggerSqrt, current);
      if (p !== null) return p;
    }
    if (amount.trim() !== "" && amountIn === null) return "Enter an amount greater than zero.";
    if (amountIn !== null && balance !== undefined && amountIn > balance)
      return `You have ${fmtToken(balance)} ${inLabel}. Mint test tokens from the sandbox below.`;
    if (minOut !== null && minOut === 0n) return "That order is too small to have a minimum output.";
    return null;
  })();

  // Show the wire on the chart while it is being set, so the trigger's position is obvious before signing.
  const draftPrice = triggerSqrt === null ? null : sqrtX96ToPrice(triggerSqrt);
  const draftValid = triggerSqrt !== null && current !== undefined && triggerProblem(below, triggerSqrt, current) === null;
  useEffect(() => {
    onDraftChange?.(draftPrice === null ? null : { price: draftPrice, firesBelow: below, valid: draftValid });
  }, [draftPrice, below, draftValid, onDraftChange]);
  useEffect(() => () => onDraftChange?.(null), [onDraftChange]);

  const complete = triggerSqrt !== null && amountIn !== null && minOut !== null && minOut > 0n;
  const needsApproval = amountIn !== null && allowance !== undefined && allowance < amountIn;

  const queryClient = useQueryClient();
  const write = useWriteContract();
  const tx = useTx();

  async function submit() {
    if (!complete || problem !== null) return;
    if (needsApproval) {
      const ok = await tx.run(`Approve ${inLabel}`, () =>
        write.mutateAsync({ address: tokenIn, abi: erc20Abi, functionName: "approve", args: [deployment.vault, amountIn] }),
      );
      await reads.refetch();
      if (!ok) return;
    }
    const ok = await tx.run("Arm tripwire", () =>
      write.mutateAsync({
        address: deployment.vault,
        abi: vaultAbi,
        functionName: "createOrder",
        args: [deployment.poolId, zeroForOne, isStopLoss, triggerSqrt, amountIn, minOut, attempts],
      }),
    );
    if (ok) {
      setTrigger("");
      void reads.refetch();
      void queryClient.invalidateQueries({ queryKey: ["orders"] });
    }
  }

  function preset(pct: number) {
    if (pool === undefined) return;
    const target = pool.price * (below ? 1 - pct / 100 : 1 + pct / 100);
    setTrigger(target.toFixed(6));
  }

  const action = !owner
    ? { label: "Connect a wallet to arm", disabled: true }
    : !onChain
      ? { label: "Switch to Unichain Sepolia", disabled: true }
      : tx.busy
        ? { label: tx.state.status === "signing" ? "Confirm in wallet…" : "Waiting for Unichain…", disabled: true }
        : !complete || problem !== null
          ? { label: "Arm tripwire", disabled: true }
          : needsApproval
            ? { label: `Approve ${inLabel} & arm`, disabled: false }
            : { label: "Arm tripwire", disabled: false };

  return (
    <Panel title="Set a tripwire">
      <div className="grid gap-4">
        <div className="grid gap-3 sm:grid-cols-[3fr_2fr]">
          <div>
            <Eyebrow className="mb-1.5">Order</Eyebrow>
            <Segmented
              label="Order type"
              value={side}
              onChange={setSide}
              options={[
                { value: "sl", label: "Stop-loss" },
                { value: "tp", label: "Take-profit" },
              ]}
            />
          </div>
          <div>
            <Eyebrow className="mb-1.5">Sell</Eyebrow>
            <Segmented
              label="Token to sell"
              value={sell}
              onChange={setSell}
              options={[
                { value: "0", label: tokenLabel[0] },
                { value: "1", label: tokenLabel[1] },
              ]}
            />
          </div>
        </div>

        <div>
          <div className="mb-1.5 flex items-baseline justify-between">
            <label htmlFor={ids.trigger}>
              <Eyebrow>Fire when price {below ? "falls to" : "rises to"}</Eyebrow>
            </label>
            <div className="flex gap-1">
              {PRESET_PCT.map((pct) => (
                <button
                  key={pct}
                  type="button"
                  onClick={() => preset(pct)}
                  disabled={pool === undefined}
                  className="rounded px-1.5 py-0.5 font-mono text-[10.5px] text-ink-3 transition-colors hover:bg-raised hover:text-ink disabled:opacity-40"
                >
                  {below ? "−" : "+"}
                  {pct}%
                </button>
              ))}
            </div>
          </div>
          <div className="flex h-11 items-center rounded-lg border border-line bg-bg px-3 focus-within:border-wire/70">
            <input
              id={ids.trigger}
              inputMode="decimal"
              autoComplete="off"
              placeholder={pool ? formatPrice(pool.price * (below ? 0.99 : 1.01)) : "0.0000"}
              value={trigger}
              onChange={(e) => setTrigger(e.target.value)}
              className="w-full bg-transparent font-mono text-base tabular-nums outline-none placeholder:text-ink-3/60"
            />
            <span className="shrink-0 font-mono text-[11px] text-ink-3">
              {tokenLabel[1]}/{tokenLabel[0]}
            </span>
          </div>
          {pool && (
            <p className="mt-1.5 font-mono text-[11px] text-ink-3">
              now {formatPrice(pool.price)}
              {triggerSqrt !== null && current !== undefined && (
                <>
                  {" · "}
                  {(((sqrtX96ToPrice(triggerSqrt) - pool.price) / pool.price) * 100).toFixed(2)}% away
                </>
              )}
            </p>
          )}
        </div>

        <div>
          <div className="mb-1.5 flex items-baseline justify-between">
            <label htmlFor={ids.amount}>
              <Eyebrow>Amount to sell</Eyebrow>
            </label>
            {balance !== undefined && (
              <button
                type="button"
                onClick={() => setAmount(formatUnits(balance, 18))}
                className="font-mono text-[11px] text-ink-3 transition-colors hover:text-ink"
              >
                balance {fmtToken(balance)} · max
              </button>
            )}
          </div>
          <div className="flex h-11 items-center rounded-lg border border-line bg-bg px-3 focus-within:border-wire/70">
            <input
              id={ids.amount}
              inputMode="decimal"
              autoComplete="off"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full bg-transparent font-mono text-base tabular-nums outline-none"
            />
            <span className="shrink-0 font-mono text-[11px] text-ink-3">{inLabel}</span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Eyebrow className="mb-1.5">Slippage</Eyebrow>
            <Segmented
              label="Slippage tolerance"
              value={String(slippageBps)}
              onChange={(v) => setSlippageBps(Number(v))}
              options={SLIPPAGE.map((b) => ({ value: String(b), label: `${b / 100}%` }))}
            />
          </div>
          <div>
            <Eyebrow className="mb-1.5">Attempts</Eyebrow>
            <div className="flex h-9 items-center justify-between rounded-lg border border-line bg-bg px-1">
              <button
                type="button"
                aria-label="Fewer attempts"
                disabled={attempts <= 1}
                onClick={() => setAttempts((a) => a - 1)}
                className="size-7 rounded-md text-ink-2 hover:bg-raised disabled:opacity-30"
              >
                −
              </button>
              <span className="font-mono text-sm tabular-nums" aria-live="polite">
                {attempts}
              </span>
              <button
                type="button"
                aria-label="More attempts"
                disabled={attempts >= 5}
                onClick={() => setAttempts((a) => a + 1)}
                className="size-7 rounded-md text-ink-2 hover:bg-raised disabled:opacity-30"
              >
                +
              </button>
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-line bg-bg px-3 py-2.5 text-sm">
          <div className="flex justify-between gap-3">
            <span className="text-ink-3">You receive at least</span>
            <span className="font-mono tabular-nums">
              {minOut === null ? "-" : `${fmtToken(minOut, 6)} ${outLabel}`}
            </span>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-ink-3">
            If the price is back across your trigger when the callback lands, or the swap would pay less than this, the
            vault refuses and Reactive tries again, up to {attempts} {attempts === 1 ? "time" : "times"}.
          </p>
        </div>

        {problem !== null && (trigger.trim() !== "" || problem.startsWith("You have")) && (
          <p className="text-sm text-pending" role="alert">
            {problem}
          </p>
        )}

        <Button
          variant="primary"
          disabled={action.disabled}
          onClick={() => void submit()}
          className={cx("h-11 w-full", !action.disabled && "shadow-[0_0_24px_rgb(236_131_90/0.18)]")}
        >
          {action.label}
        </Button>
        <TxNotice state={tx.state} onDismiss={tx.reset} />
      </div>
    </Panel>
  );
}
