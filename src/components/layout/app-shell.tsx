"use client";

import type { ReactNode } from "react";
import { GradyDock } from "@/components/grady/grady-dock";
import { useUserSettings } from "@/features/account/queries";
import { ChatSync } from "@/features/chat/chat-sync";
import { useErrorScreenShown } from "@/features/errors/error-screen-state";
import { GameSessionStart } from "@/features/game/game-session-start";
import { ReportProvider } from "@/features/feedback/report-provider";
import { OnboardingGate } from "@/features/onboarding/onboarding-gate";
import { TrialNotice } from "@/features/plan/trial-notice";
import { PastDueNotice } from "@/features/subscription/past-due-notice";
import { TutorialHost } from "@/features/tutorial/tutorial-host";
import { SearchProvider } from "@/features/search/search-provider";
import { AnalyticsProvider } from "@/lib/analytics/analytics-provider";
import { ThemeSync } from "@/features/settings/theme";
import { BottomNav } from "./bottom-nav";
import { useClearNavigatingOnArrival, usePendingHref } from "./nav-pending";
import { PageLockGuard } from "./page-lock-guard";
import { SectionGuard } from "./section-guard";
import { Sidebar } from "./sidebar";
import { TopBar } from "./top-bar";

/**
 * The app frame around every page. A client component on purpose: rendered
 * from the server layout, its nine siblings arrived as separate client
 * references, and whether their code was already in the browser changed the
 * tree React numbers useId by, so ids (the account menu, Grady's gradients,
 * every switch on the page) came out different from the server HTML on a
 * reload. As one client module the shell hydrates the same way every time.
 */
export function AppShell({ children }: { children: ReactNode }) {
  // The error page has no Grady (the dock hides itself, the tutorial goes) and no
  // onboarding over it; the overlays of the frame close themselves.
  const errorShown = useErrorScreenShown();
  // Seeded from the server with the rest of the settings, so the first HTML
  // already has the width the user left the menu at.
  const sidebarCollapsed = useUserSettings().sidebar_collapsed;
  // A menu click answers at once: while the next page is on its way the
  // content dims a little (only after 150 ms, so a fast change never flickers).
  useClearNavigatingOnArrival();
  const navigating = usePendingHref() !== null;
  return (
    <SearchProvider>
      <ReportProvider>
        <div
          data-app-shell=""
          data-sidebar={sidebarCollapsed ? "collapsed" : "expanded"}
          className="min-h-dvh pl-(--app-sidebar-width) transition-[padding-left] duration-200 ease-out motion-reduce:transition-none"
        >
          <Sidebar />
          <div className="flex min-h-dvh min-w-0 flex-col">
            <TopBar />
            <main
              data-navigating={navigating ? "" : undefined}
              className="mx-auto w-full max-w-6xl flex-1 transition-opacity duration-200 data-[navigating]:opacity-60 data-[navigating]:delay-150 pt-6 pr-[max(--spacing(4),env(safe-area-inset-right))] pb-[calc(12px+64px+32px+env(safe-area-inset-bottom))] pl-[max(--spacing(4),env(safe-area-inset-left))] md:pr-[max(--spacing(8),env(safe-area-inset-right))] md:pl-8 md:pt-8 md:pb-28"
            >
              <TrialNotice />
              <PastDueNotice />
              <SectionGuard>{children}</SectionGuard>
            </main>
          </div>
          <BottomNav />
          <GradyDock />
          <GameSessionStart />
          <ThemeSync />
          {!errorShown && <OnboardingGate />}
          {!errorShown && <TutorialHost />}
          <AnalyticsProvider />
          <ChatSync />
          <PageLockGuard />
        </div>
      </ReportProvider>
    </SearchProvider>
  );
}
