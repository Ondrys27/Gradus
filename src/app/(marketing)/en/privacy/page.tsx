import { LegalPage, legalMetadata } from "@/features/marketing/legal-page";

export const generateMetadata = () => legalMetadata("en", "privacy");

export default function Page() {
  return <LegalPage locale="en" kind="privacy" />;
}
