import { AppRoot, appRootMetadata } from "@/components/app-root";

export { rootViewport as viewport } from "@/components/root-document";
export const generateMetadata = appRootMetadata;

export default function DesignSystemLayout({ children }: { children: React.ReactNode }) {
  return <AppRoot>{children}</AppRoot>;
}
