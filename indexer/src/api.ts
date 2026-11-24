import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { isAddress, type PublicClient } from "viem";
import { readAbi } from "./abi.ts";
import type { Config } from "./config.ts";
import type { Store } from "./db.ts";
import { summarise } from "./stats.ts";
import { buildOrderView, type OrderView } from "./timeline.ts";
import type { WatcherStatus } from "./watcher.ts";

export interface ApiDeps {
  readonly config: Config;
  readonly store: Store;
  readonly unichain: PublicClient;
  readonly lasna: PublicClient;
  readonly status: () => readonly WatcherStatus[];
}

class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body, (_k, v: unknown) => (typeof v === "bigint" ? v.toString() : v));
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
  });
  res.end(json);
}

function orderView(deps: ApiDeps, id: number): OrderView | null {
  return buildOrderView(deps.store.eventsForOrder(id), (tx) => deps.store.swapByTx(tx));
}

function allOrders(deps: ApiDeps, owner?: string): OrderView[] {
  return deps.store.orderIds(owner).flatMap((id) => {
    const v = orderView(deps, id);
    return v === null ? [] : [v];
  });
}

async function balances(deps: ApiDeps) {
  const { config, unichain, lasna } = deps;
  const [vaultReserves, vaultDebt, reactiveReserves, reactiveDebt] = await Promise.all([
    unichain.readContract({ address: config.callbackProxy, abi: readAbi, functionName: "reserves", args: [config.vault] }),
    unichain.readContract({ address: config.callbackProxy, abi: readAbi, functionName: "debt", args: [config.vault] }),
    lasna.readContract({ address: config.systemContract, abi: readAbi, functionName: "reserves", args: [config.reactive] }),
    lasna.readContract({ address: config.systemContract, abi: readAbi, functionName: "debt", args: [config.reactive] }),
  ]);
  return {
    vault: { address: config.vault, chain: "unichain", currency: "ETH", reserves: vaultReserves, debt: vaultDebt },
    reactive: {
      address: config.reactive,
      chain: "lasna",
      currency: "lREACT",
      reserves: reactiveReserves,
      debt: reactiveDebt,
    },
  };
}

async function pool(deps: ApiDeps) {
  const [sqrtPriceX96, tick] = await deps.unichain.readContract({
    address: deps.config.stateView,
    abi: readAbi,
    functionName: "getSlot0",
    args: [deps.config.poolId],
  });
  const ratio = Number(sqrtPriceX96) / 2 ** 96;
  return { poolId: deps.config.poolId, sqrtPriceX96, tick, price: ratio * ratio };
}

async function route(deps: ApiDeps, req: IncomingMessage): Promise<unknown> {
  if (req.method !== "GET") throw new HttpError(405, "method not allowed");
  const url = new URL(req.url ?? "/", "http://localhost");
  const path = url.pathname.replace(/\/+$/, "");

  if (path === "/api/health") {
    return { pollMs: deps.config.pollMs, chains: deps.status(), contracts: deployment(deps.config) };
  }
  if (path === "/api/orders") {
    const owner = url.searchParams.get("owner") ?? undefined;
    if (owner !== undefined && !isAddress(owner)) throw new HttpError(400, "owner must be an address");
    return allOrders(deps, owner);
  }
  const match = /^\/api\/orders\/(\d+)$/.exec(path);
  if (match !== null) {
    const view = orderView(deps, Number(match[1]));
    if (view === null) throw new HttpError(404, "order not found");
    return view;
  }
  if (path === "/api/latency") {
    const attempts = allOrders(deps).flatMap((o) => o.attempts);
    return { pollMs: deps.config.pollMs, ...summarise(attempts) };
  }
  if (path === "/api/swaps") {
    const limit = Number(url.searchParams.get("limit") ?? "200");
    if (!Number.isInteger(limit) || limit < 1 || limit > 2000) throw new HttpError(400, "limit must be 1-2000");
    return deps.store.recentSwaps(limit).map((e) => ({
      tx: e.tx,
      block: e.block,
      blockTs: e.blockTs,
      sqrtPriceX96: e.args["sqrtPriceX96"],
      tick: e.args["tick"],
      amount0: e.args["amount0"],
      amount1: e.args["amount1"],
    }));
  }
  if (path === "/api/balances") return balances(deps);
  if (path === "/api/pool") return pool(deps);
  throw new HttpError(404, "not found");
}

function deployment(config: Config) {
  return {
    vault: config.vault,
    reactive: config.reactive,
    poolId: config.poolId,
    unichainChainId: config.unichain.chainId,
    lasnaChainId: config.lasna.chainId,
  };
}

export function startApi(deps: ApiDeps): Server {
  const server = createServer((req, res) => {
    route(deps, req).then(
      (body) => send(res, 200, body),
      (err: unknown) => {
        if (err instanceof HttpError) return send(res, err.status, { error: err.message });
        console.error("[api]", err);
        send(res, 500, { error: "internal error" });
      },
    );
  });
  server.listen(deps.config.port, () => console.log(`[api] listening on http://localhost:${deps.config.port}`));
  return server;
}
