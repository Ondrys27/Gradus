"use client";

import { MarketingError } from "@/features/marketing/marketing-error";

export default function MarketingErrorCs(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <MarketingError {...props} locale="cs" />;
}
