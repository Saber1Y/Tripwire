import { ArrowRightIcon } from "@phosphor-icons/react/ssr";
import Link from "next/link";
import { Wordmark } from "@/components/Brand";

const links = [
  { href: "#loop", label: "How it works" },
  { href: "#proof", label: "Proof" },
  { href: "#safety", label: "Safety" },
] as const;

export function LandingNav() {
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-bg/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-[1240px] items-center justify-between gap-6 px-4 md:px-6">
        <Wordmark />
        <nav aria-label="Sections" className="hidden items-center gap-1 md:flex">
          {links.map((l) => (
            <a key={l.href} href={l.href} className="rounded-full px-4 py-2 text-sm text-ink-2 transition-colors hover:text-ink">
              {l.label}
            </a>
          ))}
        </nav>
        <Link
          href="/app"
          className="inline-flex h-10 items-center gap-2 rounded-full bg-ink px-5 text-sm font-medium text-bg transition-[filter,transform] duration-150 hover:brightness-90 active:scale-[0.98]"
        >
          Open app <ArrowRightIcon size={16} weight="bold" />
        </Link>
      </div>
    </header>
  );
}
