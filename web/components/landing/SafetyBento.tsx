import { StatusChip } from "@/components/ui";
import { Reveal } from "./Reveal";

/** Three guarantees, three cells. Each carries a real piece of the product UI rather than an illustration. */
export function SafetyBento() {
  return (
    <section id="safety" className="mx-auto max-w-[1240px] scroll-mt-20 px-4 py-24 md:px-6 md:py-32">
      <h2 className="max-w-3xl text-3xl font-semibold tracking-[-0.035em] text-balance md:text-5xl">
        A trigger is a request. The vault decides.
      </h2>
      <p className="mt-5 max-w-[60ch] text-lg leading-relaxed text-ink-2">
        Reactive Network only tells the vault when to look. Funds move only after the vault checks the live pool itself.
      </p>

      <div className="mt-14 grid gap-4 md:grid-cols-2 md:grid-rows-2">
        <Reveal className="md:row-span-2">
          <article className="flex h-full flex-col justify-between gap-10 rounded-2xl border border-line bg-panel p-6 md:p-8">
            <div>
              <h3 className="text-2xl font-medium tracking-[-0.02em]">Stale triggers are refused, then retried</h3>
              <p className="mt-3 max-w-[44ch] leading-relaxed text-ink-2">
                If the price bounces back before the callback lands, the vault refuses and Reactive re-arms the order. It
                fires again on the next real crossing, up to the attempts you chose.
              </p>
            </div>
            <ol className="grid gap-3" aria-label="An order that was refused once and then executed">
              <li className="flex items-center justify-between gap-4 border-t border-line pt-3">
                <StatusChip label="Armed" tone="wire" />
                <span className="text-sm text-ink-3">watching every swap</span>
              </li>
              <li className="flex items-center justify-between gap-4 border-t border-line pt-3">
                <StatusChip label="Firing" tone="pending" />
                <span className="text-sm text-ink-3">price crossed, callback sent</span>
              </li>
              <li className="flex items-center justify-between gap-4 border-t border-line pt-3">
                <StatusChip label="Refused" tone="bad" />
                <span className="text-sm text-ink-3">price moved back, nothing traded</span>
              </li>
              <li className="flex items-center justify-between gap-4 border-t border-line pt-3">
                <StatusChip label="Executed" tone="good" />
                <span className="text-sm text-ink-3">next crossing, filled</span>
              </li>
            </ol>
          </article>
        </Reveal>

        <Reveal delay={0.08}>
          <article className="h-full rounded-2xl border border-line bg-[linear-gradient(160deg,rgb(236_131_90/0.14),transparent_55%)] p-6 md:p-8">
            <p className="font-mono text-3xl font-medium tracking-[-0.03em] md:text-4xl">out ≥ minimum</p>
            <h3 className="mt-6 text-xl font-medium tracking-[-0.02em]">You set the worst price you accept</h3>
            <p className="mt-2 max-w-[44ch] leading-relaxed text-ink-2">
              Every order carries a minimum output. A swap that would pay less is rolled back inside the vault, so
              pushing the price around cannot force a bad fill.
            </p>
          </article>
        </Reveal>

        <Reveal delay={0.16}>
          <article className="h-full rounded-2xl border border-line bg-raised p-6 md:p-8">
            <h3 className="text-xl font-medium tracking-[-0.02em]">Cancel any time, even mid-flight</h3>
            <p className="mt-2 max-w-[44ch] leading-relaxed text-ink-2">
              Cancelling refunds your tokens in one transaction. A callback already on its way finds the order closed
              and does nothing.
            </p>
          </article>
        </Reveal>
      </div>
    </section>
  );
}
