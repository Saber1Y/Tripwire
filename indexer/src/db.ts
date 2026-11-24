import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { ChainName } from "./config.ts";

/** One decoded log, as stored. Event arguments keep bigints as decimal strings. */
export interface StoredEvent {
  readonly chain: ChainName;
  readonly block: number;
  readonly tx: string;
  readonly logIndex: number;
  readonly address: string;
  readonly name: string;
  readonly orderId: number | null;
  readonly args: Record<string, string | boolean | number>;
  /** Block timestamp in seconds. */
  readonly blockTs: number;
  /**
   * Wall-clock ms at which the watcher first saw the log, or null when it was picked up while catching up on
   * history (then only block timestamps are meaningful).
   */
  readonly seenMs: number | null;
}

interface EventRow {
  chain: string;
  block: number;
  tx: string;
  log_index: number;
  address: string;
  name: string;
  order_id: number | null;
  args: string;
  block_ts: number;
  seen_ms: number | null;
}

function fromRow(row: EventRow): StoredEvent {
  return {
    chain: row.chain as ChainName,
    block: row.block,
    tx: row.tx,
    logIndex: row.log_index,
    address: row.address,
    name: row.name,
    orderId: row.order_id,
    args: JSON.parse(row.args) as StoredEvent["args"],
    blockTs: row.block_ts,
    seenMs: row.seen_ms,
  };
}

/** Event store with per-chain cursors. Writes for one getLogs batch go in one transaction with the cursor. */
export class Store {
  readonly #db: DatabaseSync;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.#db = new DatabaseSync(path);
    this.#db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS events (
        chain     TEXT    NOT NULL,
        block     INTEGER NOT NULL,
        tx        TEXT    NOT NULL,
        log_index INTEGER NOT NULL,
        address   TEXT    NOT NULL,
        name      TEXT    NOT NULL,
        order_id  INTEGER,
        args      TEXT    NOT NULL,
        block_ts  INTEGER NOT NULL,
        seen_ms   INTEGER,
        PRIMARY KEY (chain, tx, log_index)
      );
      CREATE INDEX IF NOT EXISTS events_by_order ON events (order_id, chain, block, log_index);
      CREATE INDEX IF NOT EXISTS events_by_name ON events (name, block);
      CREATE INDEX IF NOT EXISTS events_by_tx ON events (tx);
      CREATE TABLE IF NOT EXISTS cursors (
        chain TEXT PRIMARY KEY,
        block INTEGER NOT NULL
      );
    `);
  }

  cursor(chain: ChainName): bigint | null {
    const row = this.#db.prepare("SELECT block FROM cursors WHERE chain = ?").get(chain) as
      | { block: number }
      | undefined;
    return row === undefined ? null : BigInt(row.block);
  }

  /** Stores a batch and advances the chain's cursor atomically, so a crash never skips or half-applies a range. */
  commitBatch(chain: ChainName, toBlock: bigint, events: readonly StoredEvent[]): void {
    const insert = this.#db.prepare(`
      INSERT INTO events (chain, block, tx, log_index, address, name, order_id, args, block_ts, seen_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (chain, tx, log_index) DO NOTHING
    `);
    const setCursor = this.#db.prepare(`
      INSERT INTO cursors (chain, block) VALUES (?, ?)
      ON CONFLICT (chain) DO UPDATE SET block = excluded.block
    `);
    this.#db.exec("BEGIN");
    try {
      for (const e of events) {
        insert.run(
          e.chain,
          e.block,
          e.tx,
          e.logIndex,
          e.address,
          e.name,
          e.orderId,
          JSON.stringify(e.args),
          e.blockTs,
          e.seenMs,
        );
      }
      setCursor.run(chain, Number(toBlock));
      this.#db.exec("COMMIT");
    } catch (err) {
      this.#db.exec("ROLLBACK");
      throw err;
    }
  }

  eventsForOrder(orderId: number): StoredEvent[] {
    const rows = this.#db
      .prepare("SELECT * FROM events WHERE order_id = ? ORDER BY chain, block, log_index")
      .all(orderId) as unknown as EventRow[];
    return rows.map(fromRow);
  }

  eventsByName(name: string): StoredEvent[] {
    const rows = this.#db
      .prepare("SELECT * FROM events WHERE name = ? ORDER BY block, log_index")
      .all(name) as unknown as EventRow[];
    return rows.map(fromRow);
  }

  /** Most recent swaps on the watched pool, oldest first, for the price chart. */
  recentSwaps(limit: number): StoredEvent[] {
    const rows = this.#db
      .prepare("SELECT * FROM (SELECT * FROM events WHERE name = 'Swap' ORDER BY block DESC, log_index DESC LIMIT ?) ORDER BY block, log_index")
      .all(limit) as unknown as EventRow[];
    return rows.map(fromRow);
  }

  /** The Unichain swap with this transaction hash, if indexed. */
  swapByTx(tx: string): StoredEvent | null {
    const row = this.#db
      .prepare("SELECT * FROM events WHERE name = 'Swap' AND tx = ? ORDER BY log_index LIMIT 1")
      .get(tx.toLowerCase()) as EventRow | undefined;
    return row === undefined ? null : fromRow(row);
  }

  orderIds(owner?: string): number[] {
    const rows = (
      owner === undefined
        ? this.#db.prepare("SELECT order_id FROM events WHERE name = 'OrderCreated' ORDER BY order_id DESC").all()
        : this.#db
            .prepare(
              "SELECT order_id FROM events WHERE name = 'OrderCreated' AND json_extract(args, '$.owner') = ? ORDER BY order_id DESC",
            )
            .all(owner.toLowerCase())
    ) as unknown as { order_id: number }[];
    return rows.map((r) => r.order_id);
  }

  close(): void {
    this.#db.close();
  }
}
