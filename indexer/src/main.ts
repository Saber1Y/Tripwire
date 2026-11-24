import { startApi } from "./api.ts";
import { reactiveEvents, unichainEvents } from "./abi.ts";
import { loadConfig } from "./config.ts";
import { Store } from "./db.ts";
import { ChainWatcher, orderIdFromExecutePayload, type DecodedLog } from "./watcher.ts";

const config = loadConfig();
const store = new Store(config.dbPath);

const orderIdArg = (log: DecodedLog): bigint | null =>
  typeof log.args["orderId"] === "bigint" ? log.args["orderId"] : null;

const unichain = new ChainWatcher(
  {
    chain: config.unichain,
    addresses: [config.vault, config.poolManager, config.callbackProxy],
    events: [...unichainEvents],
    keep: (log) => {
      if (log.eventName === "Swap") return String(log.args["id"]).toLowerCase() === config.poolId.toLowerCase();
      if (log.eventName === "CallbackFailure") {
        return String(log.args["target"]).toLowerCase() === config.vault.toLowerCase();
      }
      return log.address.toLowerCase() === config.vault.toLowerCase();
    },
    orderIdOf: (log) =>
      log.eventName === "CallbackFailure"
        ? orderIdFromExecutePayload(log.args["payload"] as `0x${string}`)
        : orderIdArg(log),
    pollMs: config.pollMs,
  },
  store,
);

const lasna = new ChainWatcher(
  {
    chain: config.lasna,
    addresses: [config.reactive],
    events: [...reactiveEvents],
    keep: () => true,
    orderIdOf: orderIdArg,
    pollMs: config.pollMs,
  },
  store,
);

const controller = new AbortController();
const server = startApi({
  config,
  store,
  unichain: unichain.client,
  lasna: lasna.client,
  status: () => [unichain.status(), lasna.status()],
});

console.log(`[indexer] vault ${config.vault} on Unichain Sepolia, reactive ${config.reactive} on Lasna`);
console.log(`[indexer] polling every ${config.pollMs}ms; db ${config.dbPath}`);

const watchers = Promise.all([unichain.run(controller.signal), lasna.run(controller.signal)]);

function shutdown(): void {
  console.log("[indexer] shutting down");
  controller.abort();
  server.close();
  void watchers.finally(() => store.close());
}
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
