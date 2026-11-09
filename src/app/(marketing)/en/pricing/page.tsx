import { PricingPage, pricingMetadata } from "@/features/marketing/pricing-page";

// The prices follow the published catalog and the day's exchange rates.
export const revalidate = 86400;

export const generateMetadata = () => pricingMetadata("en");

export default function Page() {
  return <PricingPage locale="en" />;
}
