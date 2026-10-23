"use client";

import type { ReactNode } from "react";
import { JarvisDock } from "@/components/jarvis/jarvis-dock";
import { JarvisTour } from "@/components/jarvis/jarvis-tour";
import { useErrorScreenShown } from "@/features/errors/error-screen-state";
import { GameSessionStart } from "@/features/game/game-session-start";
import { OnboardingGate } from "@/features/onboarding/onboarding-gate";
import { TrialNotice } from "@/features/plan/trial-notice";
import { SearchProvider } from "@/features/search/search-provider";
import { AnalyticsProvider } from "@/lib/analytics/analytics-provider";
import { ThemeSync } from "@/features/settings/theme";
import { BottomNav } from "./bottom-nav";
import { PageLockGuard } from "./page-lock-guard";
import { SectionGuard } from "./section-guard";
import { Sidebar } from "./sidebar";
import { TopBar } from "./top-bar";

/**
 * The app frame around every page. A client component on purpose: rendered
 * from the server layout, its nine siblings arrived as separate client
 * references, and whether their code was already in the browser changed the
 * tree React numbers useId by, so ids (the account menu, Jarvis's gradients,
 * every switch on the page) came out different from the server HTML on a
 * reload. As one client module the shell hydrates the same way every time.
 */
export function AppShell({ children }: { children: ReactNode }) {
  // The error page has no Jarvis (the dock hides itself, the tour goes) and no
  // onboarding over it; the overlays of the frame close themselves.
  const errorShown = useErrorScreenShown();
  return (
    <SearchProvider>
      <div className="min-h-dvh md:pl-[calc(--spacing(19)+env(safe-area-inset-left))] lg:pl-[calc(--spacing(60)+env(safe-area-inset-left))]">
        <Sidebar />
        <div className="flex min-h-dvh min-w-0 flex-col">
          <TopBar />
          <main className="mx-auto w-full max-w-6xl flex-1 pt-6 pr-[max(--spacing(4),env(safe-area-inset-right))] pb-[calc(12px+64px+32px+env(safe-area-inset-bottom))] pl-[max(--spacing(4),env(safe-area-inset-left))] md:pr-[max(--spacing(8),env(safe-area-inset-right))] md:pl-8 md:pt-8 md:pb-28">
            <TrialNotice />
            <SectionGuard>{children}</SectionGuard>
          </main>
        </div>
        <BottomNav />
        <JarvisDock />
        <GameSessionStart />
        <ThemeSync />
        {!errorShown && <OnboardingGate />}
        {!errorShown && <JarvisTour />}
        <AnalyticsProvider />
        <PageLockGuard />
      </div>
    </SearchProvider>
  );
}
