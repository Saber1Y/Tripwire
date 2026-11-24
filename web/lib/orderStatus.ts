import type { OrderView } from "../../indexer/src/timeline.ts";

export type Tone = "wire" | "pending" | "good" | "bad" | "muted";

export interface DisplayStatus {
  readonly label: string;
  readonly tone: Tone;
  /** Whether the state is still moving on its own (gets a breathing dot). */
  readonly live: boolean;
  readonly detail: string;
}

/**
 * One user-facing status from the vault (source of truth for funds) and the reactive contract (what will happen
 * next). Order matters: a closed vault order wins over whatever Lasna last said.
 */
export function displayStatus(o: Pick<OrderView, "status" | "reactiveState" | "retireReason" | "attempts" | "maxAttempts">): DisplayStatus {
  if (o.status === "executed") return { label: "Executed", tone: "good", live: false, detail: "Swapped and paid out." };
  if (o.status === "cancelled") return { label: "Cancelled", tone: "muted", live: false, detail: "Refunded to your wallet." };

  if (o.reactiveState === "done") {
    return {
      label: "Stopped",
      tone: "bad",
      live: false,
      detail:
        o.retireReason === "AttemptsExhausted"
          ? `Tried ${o.attempts.length} of ${o.maxAttempts} times without filling. Cancel to get your tokens back.`
          : "Reactive stopped watching this order. Cancel to get your tokens back.",
    };
  }
  if (o.reactiveState === "pending") {
    return { label: "Firing", tone: "pending", live: true, detail: "Trigger crossed. The callback is on its way." };
  }
  if (o.reactiveState === "armed") {
    const retried = o.attempts.length > 0;
    return {
      label: "Armed",
      tone: "wire",
      live: false,
      detail: retried
        ? `Re-armed after attempt ${o.attempts.length}. Watching every swap.`
        : "Watching every swap in the pool.",
    };
  }
  return { label: "Arming", tone: "muted", live: true, detail: "Waiting for Reactive to pick the order up." };
}
