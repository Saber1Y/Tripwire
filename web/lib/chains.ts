import { createConfig, http, type CreateConnectorFn } from "wagmi";
import { unichainSepolia } from "wagmi/chains";
import { injected, walletConnect } from "wagmi/connectors";

export const UNICHAIN_RPC = process.env.NEXT_PUBLIC_UNICHAIN_SEPOLIA_RPC ?? "https://sepolia.unichain.org";

/** Free project id from https://cloud.reown.com. Without it, phone wallets are simply not offered. */
export const WALLETCONNECT_PROJECT_ID = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

/**
 * Browser wallets are discovered individually through EIP-6963 (MetaMask, Rabby, Coinbase Wallet, ...); the generic
 * `injected()` connector covers older extensions that do not announce themselves. WalletConnect adds phone wallets
 * via a QR code when a project id is configured.
 */
const connectors: CreateConnectorFn[] = [injected()];
// Browser only: WalletConnect opens IndexedDB storage when it initialises, which does not exist during server
// prerendering, and creating it there also initialises its core once per render worker.
if (WALLETCONNECT_PROJECT_ID !== "" && typeof window !== "undefined") {
  connectors.push(
    walletConnect({
      projectId: WALLETCONNECT_PROJECT_ID,
      metadata: {
        name: "Tripwire",
        description: "Stop-loss and take-profit for Uniswap V4, fired on-chain by Reactive Network.",
        url: SITE_URL,
        icons: [],
      },
      qrModalOptions: { themeMode: "dark" },
    }),
  );
}

/** Users only ever sign on Unichain Sepolia; Lasna is read through the indexer and linked to on Reactscan. */
export const wagmiConfig = createConfig({
  chains: [unichainSepolia],
  connectors,
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
