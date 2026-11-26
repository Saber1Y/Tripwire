import { ArrowRightIcon } from "@phosphor-icons/react/ssr";
import Link from "next/link";
import { HeroLive } from "@/components/landing/HeroLive";
import { CtaBand, LandingFooter } from "@/components/landing/LandingFooter";
import { LandingNav } from "@/components/landing/LandingNav";
import { LoopSection } from "@/components/landing/LoopSection";
import { ProofStrip } from "@/components/landing/ProofStrip";
import { Reveal } from "@/components/landing/Reveal";
import { SafetyBento } from "@/components/landing/SafetyBento";

export default function Landing() {
  return (
    <>
      <LandingNav />
      <main>
        <section className="mx-auto grid max-w-[1240px] items-center gap-12 px-4 pt-14 pb-20 md:px-6 md:pt-20 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-14 lg:pt-24 lg:pb-28">
          <Reveal>
            <h1 className="text-4xl leading-[1.02] font-semibold tracking-[-0.045em] text-balance md:text-5xl xl:text-[64px]">
              Stop-losses that fire in two blocks.
            </h1>
            <p className="mt-6 max-w-[42ch] text-lg leading-relaxed text-ink-2">
              Set a price wire on Uniswap V4. Reactive Network trades it on-chain the moment a swap crosses it.
            </p>
            <div className="mt-9 flex flex-wrap gap-3">
              <Link
                href="/app"
                className="inline-flex h-12 items-center gap-2 rounded-full bg-wire px-6 font-medium text-[#1a0d06] shadow-[0_10px_30px_-12px_rgb(236_131_90/0.6)] transition-[filter,transform] duration-150 hover:brightness-110 active:scale-[0.98]"
              >
                Open app <ArrowRightIcon size={18} weight="bold" />
              </Link>
              <a
                href="#loop"
                className="inline-flex h-12 items-center rounded-full border border-line-strong px-6 font-medium text-ink transition-colors hover:bg-raised"
              >
                See a real loop
              </a>
            </div>
          </Reveal>
          <Reveal delay={0.12}>
            <HeroLive />
          </Reveal>
        </section>

        <LoopSection />
        <ProofStrip />
        <SafetyBento />
        <CtaBand />
      </main>
      <LandingFooter />
    </>
  );
}
