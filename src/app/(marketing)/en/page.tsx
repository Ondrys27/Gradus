import { HomePage, homeMetadata } from "@/features/marketing/home-page";

// The founder's name comes from the owner's profile; refreshed once a day.
export const revalidate = 86400;

export const generateMetadata = () => homeMetadata("en");

export default function Page() {
  return <HomePage locale="en" />;
}
