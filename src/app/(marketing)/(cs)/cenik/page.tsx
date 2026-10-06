import { PricingPage, pricingMetadata } from "@/features/marketing/pricing-page";

export const generateMetadata = () => pricingMetadata("cs");

export default function Page() {
  return <PricingPage locale="cs" />;
}
