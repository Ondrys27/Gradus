import type { ReactNode } from "react";
import { JarvisDock } from "@/components/jarvis/jarvis-dock";
import { GameSessionStart } from "@/features/game/game-session-start";
import { OnboardingGate } from "@/features/onboarding/onboarding-gate";
import { SearchProvider } from "@/features/search/search-provider";
import { ThemeSync } from "@/features/settings/theme";
import { BottomNav } from "./bottom-nav";
import { SectionGuard } from "./section-guard";
import { Sidebar } from "./sidebar";
import { TopBar } from "./top-bar";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <SearchProvider>
      <div className="min-h-dvh md:pl-[calc(--spacing(19)+env(safe-area-inset-left))] lg:pl-[calc(--spacing(60)+env(safe-area-inset-left))]">
        <Sidebar />
        <div className="flex min-h-dvh min-w-0 flex-col">
          <TopBar />
          <main className="mx-auto w-full max-w-6xl flex-1 pt-6 pr-[max(--spacing(4),env(safe-area-inset-right))] pb-[calc(12px+64px+32px+env(safe-area-inset-bottom))] pl-[max(--spacing(4),env(safe-area-inset-left))] md:pr-[max(--spacing(8),env(safe-area-inset-right))] md:pl-8 md:pt-8 md:pb-28">
            <SectionGuard>{children}</SectionGuard>
          </main>
        </div>
        <BottomNav />
        <JarvisDock />
        <GameSessionStart />
        <ThemeSync />
        <OnboardingGate />
      </div>
    </SearchProvider>
  );
}
