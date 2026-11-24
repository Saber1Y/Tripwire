import { createConfig, http } from "wagmi";
import { unichainSepolia } from "wagmi/chains";
import { injected } from "wagmi/connectors";

export const UNICHAIN_RPC = process.env.NEXT_PUBLIC_UNICHAIN_SEPOLIA_RPC ?? "https://sepolia.unichain.org";

/** Users only ever sign on Unichain Sepolia; Lasna is read through the indexer and linked to on Reactscan. */
export const wagmiConfig = createConfig({
  chains: [unichainSepolia],
  connectors: [injected()],
  transports: { [unichainSepolia.id]: http(UNICHAIN_RPC) },
  ssr: true,
});

export const appChain = unichainSepolia;

export const explorer = {
  unichain: (kind: "tx" | "address", value: string) => `https://sepolia.uniscan.xyz/${kind}/${value}`,
  lasna: (kind: "tx" | "address", value: string) => `https://lasna.reactscan.net/${kind}/${value}`,
} as const;

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
