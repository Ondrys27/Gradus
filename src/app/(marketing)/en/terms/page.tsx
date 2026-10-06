import { LegalPage, legalMetadata } from "@/features/marketing/legal-page";

export const generateMetadata = () => legalMetadata("en", "terms");

export default function Page() {
  return <LegalPage locale="en" kind="terms" />;
}
