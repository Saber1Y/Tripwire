"use client";

import { useCallback, useState } from "react";
import { BaseError, ContractFunctionRevertedError, UserRejectedRequestError, type Hash } from "viem";
import { useConfig } from "wagmi";
import { waitForTransactionReceipt } from "wagmi/actions";

export type TxState =
  | { status: "idle" }
  | { status: "signing"; label: string }
  | { status: "pending"; label: string; hash: Hash }
  | { status: "confirmed"; label: string; hash: Hash }
  | { status: "failed"; label: string; message: string };

const friendlyReverts: Record<string, string> = {
  TriggerAlreadyCrossed: "The price already crossed this trigger. Pick a level on the other side of the current price.",
  ZeroMinAmountOut: "A minimum output is required.",
  AttemptsOutOfRange: "Attempts must be between 1 and 5.",
  ZeroAmount: "Enter an amount.",
  UnsupportedPool: "This pool is not enabled on the vault.",
  FeeOnTransferToken: "Fee-on-transfer tokens are not supported.",
  NotOrderOwner: "Only the order's owner can cancel it.",
  OrderNotOpen: "This order is no longer open.",
};

export function describeTxError(err: unknown): string {
  if (err instanceof BaseError) {
    if (err.walk((e) => e instanceof UserRejectedRequestError)) return "You rejected the request in your wallet.";
    const revert = err.walk((e) => e instanceof ContractFunctionRevertedError);
    if (revert instanceof ContractFunctionRevertedError) {
      const name = revert.data?.errorName;
      if (name !== undefined) return friendlyReverts[name] ?? `The contract rejected it: ${name}.`;
    }
    if (/insufficient funds/i.test(err.message)) return "Not enough Unichain Sepolia ETH for gas.";
    return err.shortMessage;
  }
  return err instanceof Error ? err.message : "Something went wrong.";
}

/** Runs one transaction at a time through signing, inclusion and confirmation, with readable failures. */
export function useTx() {
  const config = useConfig();
  const [state, setState] = useState<TxState>({ status: "idle" });

  const run = useCallback(
    async (label: string, send: () => Promise<Hash>): Promise<boolean> => {
      setState({ status: "signing", label });
      try {
        const hash = await send();
        setState({ status: "pending", label, hash });
        const receipt = await waitForTransactionReceipt(config, { hash });
        if (receipt.status !== "success") {
          setState({ status: "failed", label, message: "The transaction reverted on-chain." });
          return false;
        }
        setState({ status: "confirmed", label, hash });
        return true;
      } catch (err) {
        setState({ status: "failed", label, message: describeTxError(err) });
        return false;
      }
    },
    [config],
  );

  const reset = useCallback(() => setState({ status: "idle" }), []);
  const busy = state.status === "signing" || state.status === "pending";
  return { state, run, reset, busy };
}
