import { PricingPage, pricingMetadata } from "@/features/marketing/pricing-page";

export const generateMetadata = () => pricingMetadata("en");

export default function Page() {
  return <PricingPage locale="en" />;
}
