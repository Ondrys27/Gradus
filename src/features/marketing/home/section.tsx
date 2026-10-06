import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Reveal } from "./reveal";

/** One idea per section: generous space, a centred column. */
export function Section({
  id,
  labelledBy,
  className,
  children,
}: {
  id?: string;
  labelledBy: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={labelledBy}
      className={cn("mx-auto w-full max-w-6xl scroll-mt-24 px-4 py-24 md:px-8 md:py-36", className)}
    >
      {children}
    </section>
  );
}

export function SectionHeading({
  id,
  eyebrow,
  title,
  subtitle,
  align = "center",
}: {
  id: string;
  eyebrow?: string;
  title: string;
  subtitle?: string;
  align?: "center" | "start";
}) {
  return (
    <Reveal
      as="header"
      className={cn(
        "flex flex-col gap-4",
        align === "center" ? "mx-auto max-w-3xl items-center text-center" : "max-w-2xl",
      )}
    >
      {eyebrow && <p className="micro-label text-teal">{eyebrow}</p>}
      <h2 id={id} className="text-4xl font-bold tracking-tight text-balance text-ink md:text-6xl">
        {title}
      </h2>
      {subtitle && <p className="text-lg text-pretty text-ink-soft md:text-xl">{subtitle}</p>}
    </Reveal>
  );
}
