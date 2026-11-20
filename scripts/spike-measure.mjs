#!/usr/bin/env node
// Phase 0 latency report. Joins every loop through the origin tx hash:
//   origin Swap (Unichain Sepolia) -> PingRequested (Lasna) -> Ping callback (Unichain Sepolia)
// and prints per-loop legs plus median / p95, using block timestamps (whole-second resolution).
//
// Usage: node scripts/spike-measure.mjs [--unichain-from <block>] [--lasna-from <block>]
// Env:   UNICHAIN_SEPOLIA_RPC, LASNA_RPC (defaults below). Reads contracts/deployments/spike.json.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const UNICHAIN_RPC = process.env.UNICHAIN_SEPOLIA_RPC ?? "https://sepolia.unichain.org";
const LASNA_RPC = process.env.LASNA_RPC ?? "https://lasna-rpc.rnk.dev/";
const UNICHAIN_MAX_RANGE = 1000n; // public RPC limit for eth_getLogs
const LASNA_MAX_RANGE = 1000n;

// keccak256 of the event signatures in contracts/src/spike (computed with `cast keccak`).
const PING_TOPIC = "0x48c3db7595ffa1a0cf10e2c2a42ee251bb6dacb9cf901024fd0f5594131b64ab"; // Ping(uint256,uint256,uint256,uint256,uint256)
const PING_REQUESTED_TOPIC = "0x4a17e717d19bc117c59b4c4f42304061b95bf08b9c61861e2feed9d4e5e26fff"; // PingRequested(uint256,uint256,uint256)

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const deployments = JSON.parse(readFileSync(join(root, "contracts/deployments/spike.json"), "utf8"));

function arg(name) {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : BigInt(process.argv[i + 1]);
}

let rpcId = 0;
async function rpc(url, method, params) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
  });
  if (!res.ok) throw new Error(`${method} on ${url}: HTTP ${res.status}`);
  const body = await res.json();
  if (body.error) throw new Error(`${method} on ${url}: ${body.error.message}`);
  return body.result;
}

const hex = (n) => "0x" + n.toString(16);

async function getLogsChunked(url, maxRange, filter, from, to) {
  const out = [];
  for (let start = from; start <= to; start += maxRange) {
    const end = start + maxRange - 1n < to ? start + maxRange - 1n : to;
    out.push(...(await rpc(url, "eth_getLogs", [{ ...filter, fromBlock: hex(start), toBlock: hex(end) }])));
  }
  return out;
}

const blockTimes = new Map();
async function blockTimestamp(url, blockHex) {
  const key = `${url}:${blockHex}`;
  if (!blockTimes.has(key)) {
    const block = await rpc(url, "eth_getBlockByNumber", [blockHex, false]);
    blockTimes.set(key, Number(BigInt(block.timestamp)));
  }
  return blockTimes.get(key);
}

function percentile(sorted, p) {
  if (sorted.length === 0) return NaN;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

async function main() {
  const uniHead = BigInt(await rpc(UNICHAIN_RPC, "eth_blockNumber", []));
  const lasnaHead = BigInt(await rpc(LASNA_RPC, "eth_blockNumber", []));
  const uniFrom = arg("--unichain-from") ?? uniHead - 5n * UNICHAIN_MAX_RANGE;
  const lasnaFrom = arg("--lasna-from") ?? lasnaHead - 5n * LASNA_MAX_RANGE;

  const pings = await getLogsChunked(
    UNICHAIN_RPC,
    UNICHAIN_MAX_RANGE,
    { address: deployments.pingReceiver, topics: [PING_TOPIC] },
    uniFrom,
    uniHead,
  );
  const requests = await getLogsChunked(
    LASNA_RPC,
    LASNA_MAX_RANGE,
    { address: deployments.spikeReactive, topics: [PING_REQUESTED_TOPIC] },
    lasnaFrom,
    lasnaHead,
  );
  const requestByOrigin = new Map(requests.map((l) => [l.topics[1].toLowerCase(), l]));

  const rows = [];
  for (const ping of pings) {
    const originTx = ping.topics[1].toLowerCase();
    const originReceipt = await rpc(UNICHAIN_RPC, "eth_getTransactionReceipt", [originTx]);
    if (!originReceipt) continue;
    const tOrigin = await blockTimestamp(UNICHAIN_RPC, originReceipt.blockNumber);
    const tCallback = await blockTimestamp(UNICHAIN_RPC, ping.blockNumber);
    const req = requestByOrigin.get(originTx);
    const tReactive = req ? await blockTimestamp(LASNA_RPC, req.blockNumber) : undefined;
    rows.push({
      originTx,
      reactiveTx: req?.transactionHash ?? "(not found in Lasna window)",
      callbackTx: ping.transactionHash,
      leg1: tReactive === undefined ? NaN : tReactive - tOrigin,
      leg2: tReactive === undefined ? NaN : tCallback - tReactive,
      total: tCallback - tOrigin,
    });
  }

  if (rows.length === 0) {
    console.log("No Ping callbacks found in the scanned window.");
    console.log(`Unichain blocks ${uniFrom}..${uniHead}, Lasna blocks ${lasnaFrom}..${lasnaHead}.`);
    return;
  }

  for (const r of rows) {
    console.log(`origin   ${r.originTx}`);
    console.log(`reactive ${r.reactiveTx}`);
    console.log(`callback ${r.callbackTx}`);
    console.log(`  origin->reactive ${r.leg1}s  reactive->callback ${r.leg2}s  total ${r.total}s\n`);
  }

  const totals = rows.map((r) => r.total).sort((a, b) => a - b);
  console.log(`loops: ${rows.length}`);
  console.log(`total latency (block timestamps, 1s resolution): median ${percentile(totals, 50)}s, p95 ${percentile(totals, 95)}s, max ${totals.at(-1)}s`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
