"use client";

import type { ComponentProps } from "react";
import { NextIntlClientProvider } from "next-intl";
import { getIntlMessageFallback, onIntlError } from "@/i18n/error-handling";

type Props = Omit<ComponentProps<typeof NextIntlClientProvider>, "onError" | "getMessageFallback">;

/**
 * The client side of next-intl with the shared error handling. The handlers are
 * functions, so they cannot be passed from the server layout and live here.
 */
export function IntlProvider(props: Props) {
  return (
    <NextIntlClientProvider
      {...props}
      onError={onIntlError}
      getMessageFallback={getIntlMessageFallback}
    />
  );
}
