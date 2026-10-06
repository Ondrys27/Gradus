import { LegalPage, legalMetadata } from "@/features/marketing/legal-page";

export const generateMetadata = () => legalMetadata("cs", "terms");

export default function Page() {
  return <LegalPage locale="cs" kind="terms" />;
}
