import { explorer } from "@/lib/chains";
import type { TxState } from "@/lib/useTx";
import { ExternalLink, cx, shortHash } from "./ui";

export function TxNotice({ state, onDismiss }: { state: TxState; onDismiss?: () => void }) {
  if (state.status === "idle") return null;
  const tone =
    state.status === "failed" ? "border-bad/50" : state.status === "confirmed" ? "border-good/50" : "border-line-strong";
  return (
    <div role="status" aria-live="polite" className={cx("mt-3 flex items-start justify-between gap-3 rounded-lg border bg-bg px-3 py-2.5 text-sm", tone)}>
      <div className="min-w-0">
        <p className="text-ink">
          {state.status === "signing" && <>Confirm “{state.label}” in your wallet…</>}
          {state.status === "pending" && <>{state.label}: waiting for Unichain…</>}
          {state.status === "confirmed" && <>{state.label}: confirmed.</>}
          {state.status === "failed" && <>{state.label} failed.</>}
        </p>
        {state.status === "failed" && <p className="mt-0.5 text-ink-2">{state.message}</p>}
        {(state.status === "pending" || state.status === "confirmed") && (
          <ExternalLink href={explorer.unichain("tx", state.hash)} className="mt-0.5 inline-block font-mono text-xs text-ink-3">
            {shortHash(state.hash, 10, 6)}
          </ExternalLink>
        )}
      </div>
      {onDismiss && (state.status === "confirmed" || state.status === "failed") && (
        <button type="button" onClick={onDismiss} className="shrink-0 text-xs text-ink-3 hover:text-ink" aria-label="Dismiss">
          Dismiss
        </button>
      )}
    </div>
  );
}
