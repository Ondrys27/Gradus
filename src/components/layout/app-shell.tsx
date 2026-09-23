import type { ReactNode } from "react";
import { BottomNav } from "./bottom-nav";
import { JarvisButton } from "./jarvis-button";
import { Sidebar } from "./sidebar";
import { TopBar } from "./top-bar";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh md:pl-19 lg:pl-60">
      <Sidebar />
      <div className="flex min-h-dvh min-w-0 flex-col">
        {/* Streak and level are placeholders until progress data exists. */}
        <TopBar streakDays={0} level={1} />
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 pt-6 pb-[calc(12px+64px+32px+env(safe-area-inset-bottom))] md:px-8 md:pt-8 md:pb-28">
          {children}
        </main>
      </div>
      <BottomNav />
      <JarvisButton />
    </div>
  );
}
