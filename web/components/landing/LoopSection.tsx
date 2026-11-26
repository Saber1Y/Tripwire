"use client";

import { ArrowUpRightIcon } from "@phosphor-icons/react";
import { motion, useReducedMotion } from "motion/react";
import { explorer } from "@/lib/chains";
import { useOrders, type Attempt, type OrderView } from "@/lib/indexer";
import { formatPrice, sqrtX96ToPrice } from "@/lib/price";
import { shortHash } from "@/components/ui";
import { tokenLabel } from "@/lib/contracts";

const words = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine"] as const;
const blocksPhrase = (n: number | null | undefined) =>
  n === null || n === undefined ? "Two blocks." : `${words[n] ?? n} ${n === 1 ? "block" : "blocks"}.`;

interface Step {
  chain: string;
  title: string;
  body: string;
  tx: string | null;
  href: string | null;
  block: number | null;
}

/** The most recent attempt that executed and whose origin swap is indexed: one complete, checkable loop. */
function latestLoop(orders: readonly OrderView[]): { order: OrderView; attempt: Attempt } | null {
  let best: { order: OrderView; attempt: Attempt } | null = null;
  for (const order of orders) {
    for (const attempt of order.attempts) {
      if (attempt.outcome?.kind !== "executed" || attempt.origin === null) continue;
      if (best === null || attempt.outcome.leg.block > (best.attempt.outcome?.leg.block ?? 0)) best = { order, attempt };
    }
  }
  return best;
}

function steps(loop: ReturnType<typeof latestLoop>): Step[] {
  const a = loop?.attempt;
  const executed = a?.outcome?.kind === "executed" ? a.outcome : null;
  return [
    {
      chain: "Unichain Sepolia",
      title: "A swap crosses the wire",
      body: a ? `Price hits ${formatPrice(sqrtX96ToPrice(a.observedSqrtPriceX96))}, past the trigger.` : "Any swap in the pool that crosses a trigger.",
      tx: a?.origin?.tx ?? null,
      href: a?.origin ? explorer.unichain("tx", a.origin.tx) : null,
      block: a?.origin?.block ?? null,
    },
    {
      chain: "Reactive Lasna",
      title: "Reactive sees it and fires",
      body: "The reactive contract checks its order book and requests a callback.",
      tx: a?.reactive.tx ?? null,
      href: a ? explorer.lasna("tx", a.reactive.tx) : null,
      block: a?.reactive.block ?? null,
    },
    {
      chain: "Unichain Sepolia",
      title: "The vault re-checks and trades",
      body: executed
        ? `Sold ${Number(BigInt(loop!.order.amountIn)) / 1e18} ${tokenLabel[loop!.order.zeroForOne ? 0 : 1]} for ${(Number(BigInt(executed.amountOut)) / 1e18).toFixed(4)} ${tokenLabel[loop!.order.zeroForOne ? 1 : 0]}, paid straight to the owner.`
        : "Live price re-checked, swap executed, proceeds sent to the owner.",
      tx: executed?.leg.tx ?? null,
      href: executed ? explorer.unichain("tx", executed.leg.tx) : null,
      block: executed?.leg.block ?? null,
    },
  ];
}

export function LoopSection() {
  const orders = useOrders();
  const reduce = useReducedMotion();
  const loop = latestLoop(orders.data ?? []);
  const list = steps(loop);
  const blocks = loop?.attempt.latency.unichainBlocks;

  return (
    <section id="loop" className="mx-auto max-w-[1240px] scroll-mt-20 px-4 py-24 md:px-6 md:py-32">
      <h2 className="max-w-3xl text-3xl font-semibold tracking-[-0.035em] text-balance md:text-5xl">
        One swap. Three transactions. {blocksPhrase(blocks)}
      </h2>
      <p className="mt-5 max-w-[60ch] text-lg leading-relaxed text-ink-2">
        {loop
          ? `This is order #${loop.order.id}, the latest one to fire. Every step below is a real transaction you can open.`
          : "Once an order fires, its three transactions appear here, each linked to its block explorer."}
      </p>

      <div className="relative mt-16">
        {/* The wire itself: horizontal on wide screens, vertical on phones. Drawn once, in reading order. */}
        <motion.span
          aria-hidden
          className="absolute top-[7px] right-0 left-0 hidden h-px origin-left bg-wire md:block"
          initial={reduce ? false : { scaleX: 0 }}
          whileInView={{ scaleX: 1 }}
          viewport={{ once: true, amount: 0.4 }}
          transition={{ duration: 1.1, ease: [0.16, 1, 0.3, 1] }}
        />
        <span aria-hidden className="absolute top-0 bottom-0 left-[7px] w-px bg-wire/60 md:hidden" />

        <ol className="relative grid gap-12 md:grid-cols-3 md:gap-8">
          {list.map((s, i) => (
            <motion.li
              key={s.title}
              className="relative pl-10 md:pl-0"
              initial={reduce ? false : { opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.4 }}
              transition={{ duration: 0.5, delay: 0.25 + i * 0.3, ease: [0.16, 1, 0.3, 1] }}
            >
              <span
                aria-hidden
                className={`absolute top-0 left-0 block size-[15px] rounded-full border-2 border-bg ${i === 2 ? "bg-good" : "bg-wire"}`}
              />
              <div className="md:pt-10">
                <p className="text-sm text-ink-3">{s.chain}</p>
                <h3 className="mt-1.5 text-xl font-medium tracking-[-0.02em]">{s.title}</h3>
                <p className="mt-2 max-w-[34ch] leading-relaxed text-ink-2">{s.body}</p>
                {s.href && s.tx && (
                  <a
                    href={s.href}
                    target="_blank"
                    rel="noreferrer"
                    className="group mt-4 inline-flex items-center gap-1.5 font-mono text-sm text-ink transition-colors hover:text-wire"
                  >
                    block {s.block?.toLocaleString("en-US")} · {shortHash(s.tx)}
                    <ArrowUpRightIcon size={14} weight="bold" className="transition-transform group-hover:-translate-y-px group-hover:translate-x-px" />
                  </a>
                )}
              </div>
            </motion.li>
          ))}
        </ol>
      </div>
    </section>
  );
}
