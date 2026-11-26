import type { ButtonHTMLAttributes, ReactNode } from "react";
import type { Tone } from "@/lib/orderStatus";

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

export const toneDot: Record<Tone, string> = {
  wire: "bg-wire",
  pending: "bg-pending",
  good: "bg-good",
  bad: "bg-bad",
  muted: "bg-ink-3",
};

/** Mono micro-label used for every technical heading and readout caption. */
export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cx("font-mono text-[10.5px] uppercase tracking-[0.16em] text-ink-3", className)}>{children}</p>
  );
}

/** A flat, line-separated section of the terminal. Elevation is reserved for things that float. */
export function Panel({
  title,
  aside,
  children,
  className,
}: {
  title: string;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cx("min-w-0", className)}>
      <header className="flex min-h-11 items-center justify-between gap-3 border-b border-line px-4">
        <h2 className="text-[13px] font-medium text-ink">{title}</h2>
        {aside}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

/** Status with a coloured dot and a text label, so state never rides on colour alone. */
export function StatusChip({ label, tone, live = false }: { label: string; tone: Tone; live?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-line px-2 py-0.5 font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink">
      <span aria-hidden className={cx("size-1.5 rounded-full", toneDot[tone], live && "breathe")} />
      {label}
    </span>
  );
}

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

const buttonVariants: Record<ButtonVariant, string> = {
  primary:
    "bg-wire text-[#1a0d06] hover:brightness-110 active:brightness-95 disabled:bg-raised disabled:text-ink-3",
  secondary:
    "border border-line-strong text-ink hover:bg-raised active:bg-panel disabled:border-line disabled:text-ink-3 disabled:hover:bg-transparent",
  ghost: "text-ink-2 hover:text-ink hover:bg-raised disabled:text-ink-3",
  danger: "border border-bad/50 text-ink hover:bg-bad/15 disabled:text-ink-3 disabled:border-line",
};

export function Button({
  variant = "secondary",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return (
    <button
      type="button"
      {...props}
      className={cx(
        "inline-flex h-10 items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium transition-[background-color,filter,color] duration-150 ease-out disabled:cursor-not-allowed",
        buttonVariants[variant],
        className,
      )}
    />
  );
}

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="grid auto-cols-fr grid-flow-col rounded-lg border border-line bg-bg p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx(
            "h-8 rounded-md px-2.5 text-sm whitespace-nowrap transition-colors duration-150",
            value === o.value ? "bg-raised text-ink shadow-[inset_0_0_0_1px_var(--color-line-strong)]" : "text-ink-3 hover:text-ink-2",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function ExternalLink({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={cx("underline decoration-line-strong underline-offset-4 transition-colors hover:decoration-ink-2", className)}
    >
      {children}
    </a>
  );
}

export const shortHash = (h: string, head = 6, tail = 4): string => `${h.slice(0, head)}…${h.slice(-tail)}`;
