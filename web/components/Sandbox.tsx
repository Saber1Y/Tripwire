"use client";

import { useQueryClient } from "@tanstack/react-query";
import { parseUnits, type Address } from "viem";
import { useConnection, useReadContracts, useWriteContract } from "wagmi";
import { appChain } from "@/lib/chains";
import {
  MAX_SQRT_PRICE_MINUS_1,
  MIN_SQRT_PRICE_PLUS_1,
  deployment,
  erc20Abi,
  poolKey,
  swapRouterAbi,
  tokenLabel,
} from "@/lib/contracts";
import { useTx } from "@/lib/useTx";
import { TxNotice } from "./TxNotice";
import { useOpenWalletPicker } from "./WalletPickerProvider";
import { Button, Eyebrow } from "./ui";

const MINT = parseUnits("100", 18);
const MOVE = parseUnits("5", 18);
const MAX = 2n ** 256n - 1n;

/**
 * Test-pool controls, clearly separate from the product: mint the demo tokens and push the demo pool's price so
 * anyone can watch a tripwire fire without waiting for organic trading.
 */
export function Sandbox() {
  const connection = useConnection();
  const owner = connection.status === "connected" ? connection.address : undefined;
  const ready = owner !== undefined && connection.chainId === appChain.id;
  const openPicker = useOpenWalletPicker();
  const write = useWriteContract();
  const tx = useTx();
  const queryClient = useQueryClient();

  const allowances = useReadContracts({
    contracts: owner
      ? ([deployment.token0, deployment.token1] as const).map((t) => ({
          address: t,
          abi: erc20Abi,
          functionName: "allowance" as const,
          args: [owner, deployment.swapRouter] as const,
        }))
      : [],
    query: { enabled: owner !== undefined },
  });

  async function mint() {
    if (!owner) return;
    const ok0 = await tx.run(`Mint 100 ${tokenLabel[0]}`, () =>
      write.mutateAsync({ address: deployment.token0, abi: erc20Abi, functionName: "mint", args: [owner, MINT] }),
    );
    if (!ok0) return;
    await tx.run(`Mint 100 ${tokenLabel[1]}`, () =>
      write.mutateAsync({ address: deployment.token1, abi: erc20Abi, functionName: "mint", args: [owner, MINT] }),
    );
  }

  async function move(zeroForOne: boolean) {
    if (!owner) return;
    const token: Address = zeroForOne ? deployment.token0 : deployment.token1;
    const allowance = allowances.data?.[zeroForOne ? 0 : 1]?.result;
    if (allowance === undefined || allowance < MOVE) {
      const ok = await tx.run(`Approve ${tokenLabel[zeroForOne ? 0 : 1]} for the test router`, () =>
        write.mutateAsync({ address: token, abi: erc20Abi, functionName: "approve", args: [deployment.swapRouter, MAX] }),
      );
      await allowances.refetch();
      if (!ok) return;
    }
    const ok = await tx.run(zeroForOne ? "Push price down" : "Push price up", () =>
      write.mutateAsync({
        address: deployment.swapRouter,
        abi: swapRouterAbi,
        functionName: "swap",
        args: [
          poolKey,
          {
            zeroForOne,
            amountSpecified: -MOVE,
            sqrtPriceLimitX96: zeroForOne ? MIN_SQRT_PRICE_PLUS_1 : MAX_SQRT_PRICE_MINUS_1,
          },
          { takeClaims: false, settleUsingBurn: false },
          "0x",
        ],
      }),
    );
    if (ok) void queryClient.invalidateQueries();
  }

  return (
    <section className="border-t border-line p-4">
      <div className="grid gap-4">
        <div>
          <Eyebrow className="text-pending">Testnet sandbox</Eyebrow>
          <p className="mt-1.5 text-sm text-ink-2">
            The demo pool has no other traders, so move it yourself. Mint free test tokens, then push the price through
            your trigger and watch the wire fire. Each push sells 5 tokens into the pool.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void mint()} disabled={!ready || tx.busy}>
            Mint test tokens
          </Button>
          <Button onClick={() => void move(true)} disabled={!ready || tx.busy}>
            ↓ Push price down
          </Button>
          <Button onClick={() => void move(false)} disabled={!ready || tx.busy}>
            ↑ Push price up
          </Button>
        </div>
      </div>
      {!ready && (
        <p className="mt-3 text-xs text-ink-3">
          {owner === undefined ? (
            <button type="button" onClick={openPicker} className="text-ink-2 underline decoration-line-strong underline-offset-4 hover:text-ink">
              Connect a wallet
            </button>
          ) : (
            "Switch to Unichain Sepolia"
          )}{" "}
          to use the sandbox.
        </p>
      )}
      <TxNotice state={tx.state} onDismiss={tx.reset} />
    </section>
  );
}
