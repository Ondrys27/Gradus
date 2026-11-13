import { SupportPage, supportMetadata } from "@/features/marketing/support-page";

export const generateMetadata = () => supportMetadata("en");

export default function Page() {
  return <SupportPage locale="en" />;
}
