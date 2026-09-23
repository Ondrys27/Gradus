"use client";

import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MotionConfig } from "framer-motion";
import { CelebrationProvider } from "@/components/celebration/celebration-provider";

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 60_000, refetchOnWindowFocus: false } },
      }),
  );

  return (
    // Safety net: Framer Motion drops transform animations when the OS asks for reduced motion.
    <MotionConfig reducedMotion="user">
      <QueryClientProvider client={queryClient}>
        <CelebrationProvider>{children}</CelebrationProvider>
      </QueryClientProvider>
    </MotionConfig>
  );
}
