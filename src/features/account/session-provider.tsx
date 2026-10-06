"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import { writeLocaleCookie } from "@/i18n/locale-cookie";
import type { Locale } from "@/i18n/locales";
import { loginUrlFor } from "@/lib/auth/routes";
import { applyAnimationsEnabled } from "@/lib/animation-preference";
import { applySoundEnabled } from "@/lib/sound-preference";
import { createClient } from "@/lib/supabase/client";
import { CelebrationProvider } from "@/components/celebration/celebration-provider";
import { FormatSettingsContext } from "@/lib/use-format-settings";
import { toFormatSettings } from "@/lib/user-settings";
import { clearClientState } from "./client-state";
import { accountKeys, SessionContext, useUserSettings } from "./queries";
import type { AccountSnapshot } from "./types";
import { WorkspaceSync } from "./workspace-queries";

/**
 * Holds the account for the whole app. The server verified the session once
 * when the app started; from here on we only listen for changes, so page
 * changes never wait for or show an auth check.
 */
export function SessionProvider({
  initial,
  children,
}: {
  initial: AccountSnapshot;
  children: ReactNode;
}) {
  const queryClient = useQueryClient();
  const userId = initial.user.id;

  // Seed the cache before the first render of anything that reads it.
  useState(() => {
    queryClient.setQueryData(accountKeys.profile(userId), initial.profile);
    queryClient.setQueryData(accountKeys.settings(userId), initial.settings);
    return null;
  });

  useEffect(() => {
    const supabase = createClient();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT" || !session) {
        // Signed out here, in another tab, or the session could not be refreshed.
        clearClientState(queryClient);
        window.location.replace(
          loginUrlFor(
            window.location.pathname + window.location.search,
            document.documentElement.lang,
          ),
        );
      } else if (session.user.id !== userId) {
        // Another account signed in from a different tab.
        clearClientState(queryClient);
        window.location.reload();
      }
    });
    return () => subscription.unsubscribe();
  }, [queryClient, userId]);

  const session = useMemo(
    () => ({
      user: initial.user,
      roles: initial.roles,
      worker: initial.worker,
      plan: initial.plan,
    }),
    [initial.user, initial.roles, initial.worker, initial.plan],
  );

  return (
    <SessionContext.Provider value={session}>
      <WorkspaceSync />
      <SettingsBridge>{children}</SettingsBridge>
    </SessionContext.Provider>
  );
}

/** Pushes `user_settings` into formatting, sound and the UI language. */
function SettingsBridge({ children }: { children: ReactNode }) {
  const settings = useUserSettings();
  const uiLocale = useLocale();
  const router = useRouter();
  const formatSettings = useMemo(() => toFormatSettings(settings), [settings]);

  useEffect(() => applySoundEnabled(settings.sound_enabled), [settings.sound_enabled]);
  useEffect(
    () => applyAnimationsEnabled(settings.animations_enabled),
    [settings.animations_enabled],
  );

  // The language saved in the account wins over a stale cookie (e.g. changed on another device).
  const localeChecked = useRef(false);
  useEffect(() => {
    if (localeChecked.current) return;
    localeChecked.current = true;
    if (settings.locale !== uiLocale) {
      writeLocaleCookie(settings.locale as Locale);
      router.refresh();
    }
  }, [settings.locale, uiLocale, router]);

  return (
    <FormatSettingsContext.Provider value={formatSettings}>
      {/* Nested so celebrations inside the app format numbers with the user's settings. */}
      <CelebrationProvider>{children}</CelebrationProvider>
    </FormatSettingsContext.Provider>
  );
}
