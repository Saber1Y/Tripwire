"use client";

import { ArrowUpRightIcon, DeviceMobileIcon, WalletIcon, XIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { BaseError, UserRejectedRequestError } from "viem";
import { ProviderNotFoundError, useConnect, type Connector } from "wagmi";
import { appChain } from "@/lib/chains";
import { cx } from "./ui";

/**
 * Wallets worth listing: every EIP-6963 wallet the browser announced, the generic injected connector only when no
 * wallet announced itself (an older extension may still be there), and WalletConnect when configured.
 */
function visibleConnectors(all: readonly Connector[], legacyProvider: boolean): Connector[] {
  const announced = all.filter((c) => c.type === "injected" && c.id !== "injected");
  const generic = all.find((c) => c.id === "injected");
  const phone = all.filter((c) => c.type === "walletConnect");
  const showGeneric = announced.length === 0 && legacyProvider && generic !== undefined;
  return [...announced, ...(showGeneric ? [generic] : []), ...phone];
}

const noSubscription = () => () => {};

function describeError(err: Error | null): string | null {
  if (err === null) return null;
  if (err instanceof ProviderNotFoundError) return "That wallet isn't available in this browser.";
  if (err instanceof BaseError && err.walk((e) => e instanceof UserRejectedRequestError)) {
    return "You closed the request in your wallet. Pick a wallet to try again.";
  }
  return err instanceof BaseError ? err.shortMessage : err.message;
}

export function WalletPicker({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const connect = useConnect();
  // An extension that predates EIP-6963 only shows up as window.ethereum. There is no window on the server.
  const legacyProvider = useSyncExternalStore(
    noSubscription,
    () => "ethereum" in window && window.ethereum !== undefined,
    () => false,
  );
  const list = visibleConnectors(connect.connectors, legacyProvider);
  const hasBrowserWallet = list.some((c) => c.type === "injected");
  const hasPhone = list.some((c) => c.type === "walletConnect");

  useEffect(() => {
    const d = dialog.current;
    if (d === null) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  // Close once a wallet connects.
  useEffect(() => {
    if (connect.isSuccess && open) onClose();
  }, [connect.isSuccess, open, onClose]);

  function pick(connector: Connector) {
    // WalletConnect draws its own QR modal; ours steps aside so the two don't stack.
    if (connector.type === "walletConnect") onClose();
    connect.mutate({ connector, chainId: appChain.id });
  }

  const error = describeError(connect.error);

  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      onClick={(e) => e.target === dialog.current && onClose()}
      aria-labelledby="wallet-title"
      className="m-auto w-[min(420px,calc(100vw-2rem))] rounded-2xl border border-line-strong bg-panel p-0 text-ink shadow-[0_30px_80px_-20px_rgb(0_0_0/0.7)] backdrop:bg-black/60 backdrop:backdrop-blur-[2px]"
    >
      <div className="flex items-center justify-between border-b border-line px-5 py-4">
        <h2 id="wallet-title" className="text-base font-medium">
          Connect a wallet
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="grid size-8 place-items-center rounded-lg text-ink-3 transition-colors hover:bg-raised hover:text-ink"
        >
          <XIcon size={16} weight="bold" />
        </button>
      </div>

      <ul className="grid gap-1 p-2">
        {list.map((c) => {
          const pending = connect.isPending && connect.variables?.connector === c;
          const isPhone = c.type === "walletConnect";
          return (
            <li key={c.uid}>
              <button
                type="button"
                onClick={() => pick(c)}
                disabled={connect.isPending}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition-colors hover:bg-raised disabled:opacity-60"
              >
                <span className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-lg border border-line bg-bg">
                  {c.icon ? (
                    // EIP-6963 icons are data URIs supplied by the wallet itself.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={c.icon} alt="" className="size-6" />
                  ) : isPhone ? (
                    <DeviceMobileIcon size={18} className="text-ink-2" />
                  ) : (
                    <WalletIcon size={18} className="text-ink-2" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-ink">
                    {isPhone ? "Phone wallet" : c.id === "injected" ? "Browser wallet" : c.name}
                  </span>
                  <span className="block text-xs text-ink-3">
                    {isPhone ? "Scan a QR code with WalletConnect" : pending ? "Check your wallet…" : "Browser extension"}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {!hasBrowserWallet && (
        <div className="mx-2 mb-2 rounded-xl border border-line bg-bg px-4 py-3 text-sm text-ink-2">
          No browser wallet detected.{" "}
          <a
            href="https://metamask.io/download/"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-ink underline decoration-line-strong underline-offset-4 hover:decoration-ink-2"
          >
            Install MetaMask <ArrowUpRightIcon size={12} weight="bold" />
          </a>
          {hasPhone ? " or use a phone wallet above." : "."}
        </div>
      )}

      {error !== null && (
        <p role="alert" className={cx("mx-4 mb-3 text-sm text-pending")}>
          {error}
        </p>
      )}

      <p className="border-t border-line px-5 py-3 text-xs leading-relaxed text-ink-3">
        Tripwire runs on Unichain Sepolia (chain {appChain.id}). Your wallet will be asked to add or switch to it.
      </p>
    </dialog>
  );
}
