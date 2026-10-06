import { MarketingRoot, marketingRootMetadata } from "@/features/marketing/marketing-root";

export { rootViewport as viewport } from "@/components/root-document";
export const generateMetadata = () => marketingRootMetadata("en");

/** Root of the public website in English, generated statically. */
export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return <MarketingRoot locale="en">{children}</MarketingRoot>;
}
