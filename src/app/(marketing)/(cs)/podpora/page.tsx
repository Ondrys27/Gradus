import { SupportPage, supportMetadata } from "@/features/marketing/support-page";

export const generateMetadata = () => supportMetadata("cs");

export default function Page() {
  return <SupportPage locale="cs" />;
}
