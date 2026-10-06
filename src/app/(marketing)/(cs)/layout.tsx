import { MarketingRoot, marketingRootMetadata } from "@/features/marketing/marketing-root";

export { rootViewport as viewport } from "@/components/root-document";
export const generateMetadata = () => marketingRootMetadata("cs");

/** Root of the public website in Czech, generated statically. */
export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return <MarketingRoot locale="cs">{children}</MarketingRoot>;
}
