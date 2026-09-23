import type { ReactNode } from "react";
import { GlowCard } from "@/components/ui/glow-card";

export function AuthCard({
  title,
  description,
  footer,
  children,
}: {
  title: string;
  description?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-5">
      <GlowCard interactive={false} className="flex flex-col gap-6 p-6 md:p-8">
        <header className="flex flex-col gap-2">
          <h1 className="text-2xl font-bold tracking-tight text-balance">{title}</h1>
          {description && <p className="text-sm text-ink-soft">{description}</p>}
        </header>
        {children}
      </GlowCard>
      {footer && <p className="text-center text-sm text-ink-soft">{footer}</p>}
    </div>
  );
}

export const authLinkClass =
  "font-medium text-violet underline-offset-4 outline-none hover:underline focus-visible:underline rounded-sm focus-visible:ring-3 focus-visible:ring-ring/50";
