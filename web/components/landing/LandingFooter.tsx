import { ArrowRightIcon } from "@phosphor-icons/react/ssr";
import Link from "next/link";
import { Wordmark } from "@/components/Brand";
import { explorer } from "@/lib/chains";
import { deployment } from "@/lib/contracts";

export function CtaBand() {
  return (
    <section className="border-t border-line">
      <div className="mx-auto grid max-w-[1240px] gap-8 px-4 py-20 md:grid-cols-[1fr_auto] md:items-end md:px-6 md:py-28">
        <h2 className="max-w-2xl text-4xl font-semibold tracking-[-0.04em] text-balance md:text-6xl">
          Set your first wire in under a minute.
        </h2>
        <Link
          href="/app"
          className="inline-flex h-12 items-center justify-center gap-2 justify-self-start rounded-full bg-wire px-6 font-medium text-[#1a0d06] transition-[filter,transform] duration-150 hover:brightness-110 active:scale-[0.98]"
        >
          Open app <ArrowRightIcon size={18} weight="bold" />
        </Link>
      </div>
    </section>
  );
}

export function LandingFooter() {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto grid max-w-[1240px] gap-10 px-4 py-12 md:grid-cols-[1fr_auto] md:px-6">
        <div className="grid content-start gap-4">
          <Wordmark />
          <p className="max-w-[48ch] text-sm leading-relaxed text-ink-3">
            Built for the Reactive Omni Buildathon. Runs on testnets with test tokens. Not financial advice.
          </p>
        </div>
        <dl className="grid gap-3 text-sm">
          <div className="flex flex-wrap gap-x-3">
            <dt className="text-ink-3">Vault on Unichain Sepolia</dt>
            <dd>
              <a href={explorer.unichain("address", deployment.vault)} target="_blank" rel="noreferrer" className="font-mono text-ink-2 hover:text-ink">
                {deployment.vault}
              </a>
            </dd>
          </div>
          <div className="flex flex-wrap gap-x-3">
            <dt className="text-ink-3">Reactive contract on Lasna</dt>
            <dd>
              <a href={explorer.lasna("address", deployment.reactive)} target="_blank" rel="noreferrer" className="font-mono text-ink-2 hover:text-ink">
                {deployment.reactive}
              </a>
            </dd>
          </div>
        </dl>
      </div>
    </footer>
  );
}
