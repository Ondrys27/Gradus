import type { Metadata } from "next";
import { AppRoot, appRootMetadata } from "@/components/app-root";

export { rootViewport as viewport } from "@/components/root-document";

/** The administration: rendered per request, never indexed, linked from nowhere. */
export async function generateMetadata(): Promise<Metadata> {
  return {
    ...(await appRootMetadata()),
    robots: { index: false, follow: false, nocache: true },
  };
}

export const dynamic = "force-dynamic";

export default function AdminRootLayout({ children }: { children: React.ReactNode }) {
  // A calm canvas: no grid and no glows behind numbers.
  return <AppRoot backdrop="plain">{children}</AppRoot>;
}
