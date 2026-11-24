"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import type { OrderView, PoolState, SwapPoint } from "@/lib/indexer";
import { formatPrice, sqrtX96ToPrice } from "@/lib/price";
import { displayStatus } from "@/lib/orderStatus";
import { tokenLabel } from "@/lib/contracts";
import type { DraftWire } from "./OrderForm";
import { Eyebrow } from "./ui";

interface Point {
  t: number;
  p: number;
}

interface Wire {
  id: number;
  price: number;
  firing: boolean;
  label: string;
  mine: boolean;
}

interface Snap {
  id: number;
  t: number;
  p: number;
}

const MIN_SPAN_MS = 10 * 60_000;
const MAX_SPAN_MS = 3 * 60 * 60_000;
const PAD = { top: 18, right: 108, bottom: 26, left: 64 };

function niceTicks(min: number, max: number, count: number): number[] {
  const span = max - min;
  if (span <= 0) return [min];
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= count) ?? raw;
  const ticks: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) ticks.push(Number(v.toPrecision(12)));
  return ticks;
}

const timeFmt = new Intl.DateTimeFormat("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
const timeFmtFull = new Intl.DateTimeFormat("en-US", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const ro = new ResizeObserver(([entry]) => entry && setWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

export function PriceWire({
  swaps,
  pool,
  orders,
  owner,
  draft = null,
}: {
  swaps: readonly SwapPoint[];
  pool: PoolState | undefined;
  orders: readonly OrderView[];
  owner: string | undefined;
  draft?: DraftWire | null;
}) {
  const [box, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<Point | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, []);

  const height = width < 640 ? 240 : 320;
  const compact = width < 640;

  const tMax = now;
  const earliest = swaps[0] === undefined ? now : swaps[0].blockTs * 1000;
  const tMin = Math.max(Math.min(earliest, now - MIN_SPAN_MS), now - MAX_SPAN_MS);

  // Only what is inside the window, starting from the price that held when the window opened.
  const points = useMemo<Point[]>(() => {
    const all = swaps.map((s) => ({ t: s.blockTs * 1000, p: sqrtX96ToPrice(s.sqrtPriceX96) }));
    const before = all.filter((pt) => pt.t < tMin).at(-1);
    const pts = [...(before ? [{ t: tMin, p: before.p }] : []), ...all.filter((pt) => pt.t >= tMin)];
    const current = pool === undefined ? pts.at(-1)?.p : pool.price;
    if (current !== undefined) pts.push({ t: now, p: current });
    return pts;
  }, [swaps, pool, now, tMin]);

  const wires = useMemo<Wire[]>(
    () =>
      orders
        .filter((o) => o.status === "open" && o.reactiveState !== "done")
        .map((o) => ({
          id: o.id,
          price: sqrtX96ToPrice(o.triggerSqrtPriceX96),
          firing: displayStatus(o).label === "Firing",
          label: `#${o.id} ${o.isStopLoss ? "SL" : "TP"}`,
          mine: owner !== undefined && o.owner === owner.toLowerCase(),
        })),
    [orders, owner],
  );

  const snaps = useMemo<Snap[]>(
    () =>
      orders.flatMap((o) => {
        const done = o.attempts.find((a) => a.outcome?.kind === "executed");
        if (done?.outcome?.kind !== "executed") return [];
        return [{ id: o.id, t: done.outcome.leg.blockTs * 1000, p: sqrtX96ToPrice(done.outcome.executionSqrtPriceX96) }];
      }),
    [orders],
  );

  // Room for wire labels on the right only when there are wires to label.
  const rightPad = wires.length === 0 && draft === null ? 20 : compact ? 72 : PAD.right;
  const left = compact ? 50 : PAD.left;
  const plotW = Math.max(0, width - left - rightPad);
  const plotH = height - PAD.top - PAD.bottom;

  const values = [...points.map((p) => p.p), ...wires.map((w) => w.price), ...(draft ? [draft.price] : []), ...snaps.filter((s) => s.t >= tMin).map((s) => s.p)];
  const lo = values.length ? Math.min(...values) : 0.99;
  const hi = values.length ? Math.max(...values) : 1.01;
  const padY = Math.max((hi - lo) * 0.14, hi * 0.002);
  const yMin = lo - padY;
  const yMax = hi + padY;

  const x = (t: number) => left + ((t - tMin) / (tMax - tMin)) * plotW;
  const y = (p: number) => PAD.top + (1 - (p - yMin) / (yMax - yMin)) * plotH;

  // Step-after: a pool's price holds until the next swap moves it.
  const linePath = points.map((pt, i) => (i === 0 ? `M${x(pt.t)},${y(pt.p)}` : `H${x(pt.t)}V${y(pt.p)}`)).join("");
  const first = points[0];
  const last = points.at(-1);
  const areaPath = first && last ? `${linePath}V${PAD.top + plotH}H${x(first.t)}Z` : "";

  const yTicks = niceTicks(yMin, yMax, compact ? 3 : 4);
  const xTicks = niceTicks(tMin, tMax, compact ? 2 : 4).filter((t) => t >= tMin && t <= tMax);

  function onMove(e: PointerEvent<SVGRectElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const t = tMin + ((e.clientX - rect.left) / rect.width) * (tMax - tMin);
    let found: Point | undefined;
    for (const pt of points) if (pt.t <= t) found = pt;
    setHover(found === undefined ? null : { t, p: found.p });
  }

  const ready = width > 0;
  const empty = swaps.length === 0;

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div>
          <Eyebrow>
            Pool price · {tokenLabel[1]} per {tokenLabel[0]}
          </Eyebrow>
          <p className="mt-1.5 font-mono text-[40px] leading-none font-medium tracking-[-0.03em] tabular-nums md:text-[52px]">
            {pool === undefined ? <span className="text-ink-3">—</span> : formatPrice(pool.price)}
          </p>
          <p className="mt-2 font-mono text-[11px] text-ink-3 tabular-nums">
            {pool === undefined ? "Waiting for the indexer…" : `tick ${pool.tick} · Uniswap V4 · 0.05% fee`}
          </p>
        </div>
        <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5 font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-2" aria-label="Chart key">
          <li className="flex items-center gap-1.5">
            <span aria-hidden className="h-0.5 w-4 rounded-full bg-price" /> Price
          </li>
          <li className="flex items-center gap-1.5">
            <span aria-hidden className="h-0.5 w-4 rounded-full bg-wire" /> Armed wire
          </li>
          <li className="flex items-center gap-1.5">
            <span aria-hidden className="h-0.5 w-4 rounded-full bg-pending" /> Firing
          </li>
          <li className="flex items-center gap-1.5">
            <span aria-hidden className="size-2 rounded-full bg-good ring-2 ring-panel" /> Filled
          </li>
        </ul>
      </div>

      <div ref={box} className="relative mt-5" style={{ height }}>
        {ready && (
          <svg width={width} height={height} role="img" aria-label={`Pool price over time, currently ${pool ? formatPrice(pool.price) : "unknown"}, with ${wires.length} open trigger wires`}>
            {yTicks.map((v) => (
              <g key={`y${v}`}>
                <line x1={left} x2={left + plotW} y1={y(v)} y2={y(v)} stroke="var(--color-grid)" strokeWidth={1} />
                <text x={left - 10} y={y(v)} dy="0.32em" textAnchor="end" className="fill-ink-3 font-mono text-[10.5px] tabular-nums">
                  {v.toFixed(4)}
                </text>
              </g>
            ))}
            {xTicks.map((t) => (
              <text key={`x${t}`} x={x(t)} y={height - 6} textAnchor="middle" className="fill-ink-3 font-mono text-[10.5px] tabular-nums">
                {timeFmt.format(t)}
              </text>
            ))}

            {areaPath && <path d={areaPath} fill="var(--color-price)" opacity={0.08} />}
            {linePath && (
              <path d={linePath} fill="none" stroke="var(--color-price)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            )}

            {wires.map((w) => {
              const wy = y(w.price);
              const color = w.firing ? "var(--color-pending)" : "var(--color-wire)";
              return (
                <g key={`w${w.id}`} opacity={w.mine || owner === undefined ? 1 : 0.45}>
                  <line x1={left} x2={left + plotW} y1={wy} y2={wy} stroke={color} strokeWidth={w.mine ? 1.5 : 1} />
                  <g transform={`translate(${left + plotW + 8},${wy})`}>
                    <rect x={0} y={-10} width={compact ? 60 : 96} height={20} rx={5} fill="var(--color-raised)" stroke={color} strokeOpacity={0.6} />
                    <text x={8} dy="0.33em" className="fill-ink font-mono text-[10.5px]">
                      {compact ? w.label : `${w.label} ${w.price.toFixed(4)}`}
                    </text>
                  </g>
                </g>
              );
            })}

            {draft && (
              <g opacity={draft.valid ? 0.8 : 0.5}>
                <line
                  x1={left}
                  x2={left + plotW}
                  y1={y(draft.price)}
                  y2={y(draft.price)}
                  stroke={draft.valid ? "var(--color-wire)" : "var(--color-bad)"}
                  strokeWidth={1}
                  strokeDasharray="5 4"
                />
                <g transform={`translate(${left + plotW + 8},${y(draft.price)})`}>
                  <rect x={0} y={-10} width={compact ? 60 : 96} height={20} rx={5} fill="var(--color-bg)" stroke="var(--color-line-strong)" />
                  <text x={8} dy="0.33em" className="fill-ink-2 font-mono text-[10.5px]">
                    {compact ? "draft" : `draft ${draft.price.toFixed(4)}`}
                  </text>
                </g>
              </g>
            )}

            {snaps
              .filter((s) => s.t >= tMin)
              .map((s) => {
                const sx = x(s.t);
                const sy = y(s.p);
                // Keep the label inside the plot: anchor inward near the edges, flip above near the bottom.
                const anchor = sx < left + 40 ? "start" : sx > left + plotW - 40 ? "end" : "middle";
                const ly = sy > PAD.top + plotH - 24 ? sy - 12 : sy + 20;
                return (
                  <g key={`s${s.id}`}>
                    <circle className="snap" cx={sx} cy={sy} r={6} fill="var(--color-good)" stroke="var(--color-panel)" strokeWidth={2} />
                    <text x={sx + (anchor === "start" ? -4 : anchor === "end" ? 4 : 0)} y={ly} textAnchor={anchor} className="fill-ink-2 font-mono text-[10.5px]">
                      #{s.id} filled
                    </text>
                  </g>
                );
              })}

            {last && (
              <circle cx={x(last.t)} cy={y(last.p)} r={4.5} fill="var(--color-price)" stroke="var(--color-panel)" strokeWidth={2} />
            )}

            {hover && (
              <g pointerEvents="none">
                <line x1={x(hover.t)} x2={x(hover.t)} y1={PAD.top} y2={PAD.top + plotH} stroke="var(--color-line-strong)" strokeWidth={1} />
                <circle cx={x(hover.t)} cy={y(hover.p)} r={4.5} fill="var(--color-price)" stroke="var(--color-panel)" strokeWidth={2} />
              </g>
            )}

            <rect
              x={left}
              y={PAD.top}
              width={plotW}
              height={plotH}
              fill="transparent"
              onPointerMove={onMove}
              onPointerLeave={() => setHover(null)}
            />
          </svg>
        )}

        {hover && (
          <div
            className="pointer-events-none absolute rounded-md border border-line-strong bg-raised px-2.5 py-1.5 font-mono text-[11px] text-ink shadow-lg shadow-black/40"
            style={{
              left: Math.min(Math.max(x(hover.t) - 60, 0), Math.max(0, width - 130)),
              top: Math.max(y(hover.p) - 52, 0),
            }}
          >
            <span className="text-ink-3">{timeFmtFull.format(hover.t)}</span>
            <span className="ml-2 tabular-nums">{formatPrice(hover.p)}</span>
          </div>
        )}

        {ready && empty && (
          <p className="absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-sm text-ink-3">
            No swaps indexed yet. Move the price from the sandbox below to draw the trace.
          </p>
        )}
      </div>

      <table className="sr-only">
        <caption>Recent swaps in the demo pool</caption>
        <thead>
          <tr>
            <th>Time</th>
            <th>Price</th>
          </tr>
        </thead>
        <tbody>
          {swaps.slice(-20).map((s) => (
            <tr key={s.tx}>
              <td>{timeFmtFull.format(s.blockTs * 1000)}</td>
              <td>{formatPrice(sqrtX96ToPrice(s.sqrtPriceX96))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
