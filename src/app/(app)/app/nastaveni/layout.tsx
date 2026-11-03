import { Suspense, type ReactNode } from "react";
import { SettingsShell } from "@/features/settings/settings-shell";

/** The menu, the search and the deep links around every settings page. */
export default function SettingsLayout({ children }: { children: ReactNode }) {
  // The shell reads the address (`?focus=`, `?q=`), which needs a boundary.
  return (
    <Suspense>
      <SettingsShell>{children}</SettingsShell>
    </Suspense>
  );
}
