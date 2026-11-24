// Simulates every write the dashboard makes, via eth_call against live Unichain Sepolia, using the exact ABIs and
// argument shapes from lib/contracts.ts. Nothing is signed or sent.
// Usage: node scripts/simulate-writes.ts <account with test tokens and approvals>
import { BaseError, ContractFunctionRevertedError, createPublicClient, http, parseUnits, type Address } from "viem";
import { unichainSepolia } from "viem/chains";
import {
  MAX_SQRT_PRICE_MINUS_1,
  MIN_SQRT_PRICE_PLUS_1,
  deployment,
  erc20Abi,
  poolKey,
  swapRouterAbi,
  vaultAbi,
} from "../lib/contracts.ts";
import { applySlippage, outAtTrigger, priceToSqrtX96, sqrtX96ToPrice } from "../lib/price.ts";

const account = process.argv[2] as Address | undefined;
if (!account) throw new Error("pass an account address");
const client = createPublicClient({ chain: unichainSepolia, transport: http("https://sepolia.unichain.org") });

const stateView = "0xc199f1072a74d4e905aba1a84d9a45e2546b6222" as const;
const [current] = await client.readContract({
  address: stateView,
  abi: [{ type: "function", name: "getSlot0", stateMutability: "view", inputs: [{ type: "bytes32" }], outputs: [{ type: "uint160" }, { type: "int24" }, { type: "uint24" }, { type: "uint24" }] }],
  functionName: "getSlot0",
  args: [deployment.poolId],
});
const trigger = priceToSqrtX96((sqrtX96ToPrice(current) * 0.99).toFixed(6));
const amountIn = parseUnits("1", 18);
const minOut = applySlippage(outAtTrigger(amountIn, trigger, true, deployment.fee), 100);

async function check(label: string, run: () => Promise<unknown>, expectRevert?: string) {
  try {
    await run();
    console.log(expectRevert ? `FAIL ${label}: expected revert ${expectRevert}` : `ok   ${label}`);
  } catch (err) {
    const revert = err instanceof BaseError ? err.walk((e) => e instanceof ContractFunctionRevertedError) : null;
    const name = revert instanceof ContractFunctionRevertedError ? revert.data?.errorName : undefined;
    if (expectRevert && name === expectRevert) console.log(`ok   ${label} (reverts ${name}, decoded)`);
    else console.log(`FAIL ${label}: ${err instanceof BaseError ? err.shortMessage : String(err)}`);
  }
}

await check("mint test tokens", () =>
  client.simulateContract({ account, address: deployment.token0, abi: erc20Abi, functionName: "mint", args: [account, parseUnits("100", 18)] }),
);
await check("approve vault", () =>
  client.simulateContract({ account, address: deployment.token0, abi: erc20Abi, functionName: "approve", args: [deployment.vault, amountIn] }),
);
await check(`createOrder (stop-loss, trigger -1%, minOut ${minOut})`, () =>
  client.simulateContract({
    account,
    address: deployment.vault,
    abi: vaultAbi,
    functionName: "createOrder",
    args: [deployment.poolId, true, true, trigger, amountIn, minOut, 3],
  }),
);
await check(
  "createOrder with an already-crossed trigger",
  () =>
    client.simulateContract({
      account,
      address: deployment.vault,
      abi: vaultAbi,
      functionName: "createOrder",
      args: [deployment.poolId, true, true, priceToSqrtX96((sqrtX96ToPrice(current) * 1.01).toFixed(6)), amountIn, minOut, 3],
    }),
  "TriggerAlreadyCrossed",
);
await check(
  "cancelOrder on someone else's order",
  () => client.simulateContract({ account: "0x000000000000000000000000000000000000dEaD", address: deployment.vault, abi: vaultAbi, functionName: "cancelOrder", args: [1n] }),
  "NotOrderOwner",
);
for (const zeroForOne of [true, false]) {
  await check(`sandbox push price ${zeroForOne ? "down" : "up"}`, () =>
    client.simulateContract({
      account,
      address: deployment.swapRouter,
      abi: swapRouterAbi,
      functionName: "swap",
      args: [
        poolKey,
        { zeroForOne, amountSpecified: -parseUnits("5", 18), sqrtPriceLimitX96: zeroForOne ? MIN_SQRT_PRICE_PLUS_1 : MAX_SQRT_PRICE_MINUS_1 },
        { takeClaims: false, settleUsingBurn: false },
        "0x",
      ],
    }),
  );
}
