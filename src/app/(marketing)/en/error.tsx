"use client";

import { MarketingError } from "@/features/marketing/marketing-error";

export default function MarketingErrorEn(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <MarketingError {...props} locale="en" />;
}
