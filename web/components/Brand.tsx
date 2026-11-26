import Link from "next/link";

/** The mark is the product: a wire with a trigger ring on it. */
export function BrandMark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 22 22" aria-hidden>
      <line x1="1" y1="11" x2="21" y2="11" stroke="var(--color-wire)" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="11" cy="11" r="3.25" fill="var(--color-bg)" stroke="var(--color-wire)" strokeWidth="1.5" />
    </svg>
  );
}

export function Wordmark({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="flex items-center gap-2.5" aria-label="Tripwire home">
      <BrandMark />
      <span className="font-mono text-[13px] tracking-[0.22em] text-ink">TRIPWIRE</span>
    </Link>
  );
}
