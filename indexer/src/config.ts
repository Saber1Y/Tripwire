import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getAddress, type Address, type Hex } from "viem";

export interface ChainConfig {
  readonly name: ChainName;
  readonly chainId: number;
  readonly rpcUrl: string;
  /** Largest block range the public RPC accepts in one eth_getLogs call. */
  readonly maxLogRange: bigint;
  readonly startBlock: bigint;
}

export type ChainName = "unichain" | "lasna";

export interface Config {
  readonly unichain: ChainConfig;
  readonly lasna: ChainConfig;
  readonly vault: Address;
  readonly reactive: Address;
  readonly poolId: Hex;
  readonly poolManager: Address;
  readonly stateView: Address;
  readonly callbackProxy: Address;
  readonly systemContract: Address;
  /** How often each chain head is polled. Wall-clock latency is only as precise as this. */
  readonly pollMs: number;
  readonly port: number;
  readonly dbPath: string;
}

interface DeploymentFile {
  vault: string;
  reactive: string;
  poolId: string;
  unichainStartBlock: number;
  lasnaStartBlock: number;
}

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

function env(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value === "" ? fallback : value;
}

function readDeployment(path: string): DeploymentFile {
  const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (typeof raw !== "object" || raw === null) throw new Error(`${path}: not a JSON object`);
  const d = raw as Record<string, unknown>;
  for (const key of ["vault", "reactive", "poolId"] as const) {
    if (typeof d[key] !== "string") throw new Error(`${path}: missing string field "${key}"`);
  }
  for (const key of ["unichainStartBlock", "lasnaStartBlock"] as const) {
    if (typeof d[key] !== "number") throw new Error(`${path}: missing numeric field "${key}"`);
  }
  return d as unknown as DeploymentFile;
}

export function loadConfig(): Config {
  const deploymentPath = env("TRIPWIRE_DEPLOYMENT", `${repoRoot}contracts/deployments/tripwire.json`);
  const d = readDeployment(deploymentPath);

  return {
    unichain: {
      name: "unichain",
      chainId: 1301,
      rpcUrl: env("UNICHAIN_SEPOLIA_RPC", "https://sepolia.unichain.org"),
      maxLogRange: 1000n,
      startBlock: BigInt(d.unichainStartBlock),
    },
    lasna: {
      name: "lasna",
      chainId: 5318007,
      rpcUrl: env("LASNA_RPC", "https://lasna-rpc.rnk.dev/"),
      maxLogRange: 10_000n,
      startBlock: BigInt(d.lasnaStartBlock),
    },
    vault: getAddress(d.vault),
    reactive: getAddress(d.reactive),
    poolId: d.poolId as Hex,
    poolManager: getAddress("0x00B036B58a818B1BC34d502D3fE730Db729e62AC"),
    stateView: getAddress("0xc199f1072a74d4e905aba1a84d9a45e2546b6222"),
    callbackProxy: getAddress("0x775c9B990ADe401060B78D0e98684eEf8d2466C1"),
    systemContract: getAddress("0x8888888888888888888888888888888888888888"),
    pollMs: Number(env("INDEXER_POLL_MS", "250")),
    port: Number(env("INDEXER_PORT", "8787")),
    dbPath: env("INDEXER_DB", `${repoRoot}indexer/data/tripwire.sqlite`),
  };
}
