import { LegalPage, legalMetadata } from "@/features/marketing/legal-page";

export const generateMetadata = () => legalMetadata("cs", "privacy");

export default function Page() {
  return <LegalPage locale="cs" kind="privacy" />;
}
