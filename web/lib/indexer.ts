"use client";

import { useQuery } from "@tanstack/react-query";
import type { LatencySummary } from "../../indexer/src/stats.ts";
import type { OrderView } from "../../indexer/src/timeline.ts";
import type { WatcherStatus } from "../../indexer/src/watcher.ts";

export type { Attempt, Leg, OrderView, Outcome } from "../../indexer/src/timeline.ts";
export type { Distribution, LatencySummary } from "../../indexer/src/stats.ts";

export const INDEXER_URL = process.env.NEXT_PUBLIC_INDEXER_URL ?? "http://localhost:8787";

/** Chains move once a second; polling faster than this just burns requests. */
const LIVE_MS = 1_500;

export interface Health {
  pollMs: number;
  chains: WatcherStatus[];
}

export interface SwapPoint {
  tx: string;
  block: number;
  blockTs: number;
  sqrtPriceX96: string;
  tick: number;
}

export interface PoolState {
  sqrtPriceX96: string;
  tick: number;
  price: number;
}

export interface ActivityEvent {
  chain: "unichain" | "lasna";
  name: string;
  orderId: number | null;
  tx: string;
  block: number;
  blockTs: number;
  args: Record<string, string | boolean | number>;
}

export interface Balances {
  vault: { reserves: string; debt: string };
  reactive: { reserves: string; debt: string };
}

export class IndexerError extends Error {}

async function get<T>(path: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${INDEXER_URL}${path}`, { cache: "no-store" });
  } catch {
    throw new IndexerError(`Indexer unreachable at ${INDEXER_URL}`);
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new IndexerError(body.error ?? `Indexer returned ${res.status}`);
  }
  return (await res.json()) as T;
}

const live = { refetchInterval: LIVE_MS, retry: 1 } as const;

export const useHealth = () => useQuery({ queryKey: ["health"], queryFn: () => get<Health>("/api/health"), ...live });
export const usePool = () => useQuery({ queryKey: ["pool"], queryFn: () => get<PoolState>("/api/pool"), ...live });
export const useSwaps = (limit = 240) =>
  useQuery({ queryKey: ["swaps", limit], queryFn: () => get<SwapPoint[]>(`/api/swaps?limit=${limit}`), ...live });
export const useLatency = () =>
  useQuery({ queryKey: ["latency"], queryFn: () => get<LatencySummary & { pollMs: number }>("/api/latency"), ...live });
export const useActivity = (limit = 60) =>
  useQuery({ queryKey: ["activity", limit], queryFn: () => get<ActivityEvent[]>(`/api/activity?limit=${limit}`), ...live });
export const useBalances = () =>
  useQuery({ queryKey: ["balances"], queryFn: () => get<Balances>("/api/balances"), refetchInterval: 10_000 });
export const useOrders = (owner?: string) =>
  useQuery({
    queryKey: ["orders", owner ?? "all"],
    queryFn: () => get<OrderView[]>(owner === undefined ? "/api/orders" : `/api/orders?owner=${owner}`),
    ...live,
  });
