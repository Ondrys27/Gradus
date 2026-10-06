import {
  WaitlistConfirmPage,
  waitlistConfirmMetadata,
} from "@/features/marketing/waitlist-confirm-page";

export const generateMetadata = () => waitlistConfirmMetadata("en");

export default function Page({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  return <WaitlistConfirmPage locale="en" searchParams={searchParams} />;
}
