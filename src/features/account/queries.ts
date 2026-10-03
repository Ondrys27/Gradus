"use client";

import { createContext, useContext, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { writeLocaleCookie } from "@/i18n/locale-cookie";
import type { Locale } from "@/i18n/locales";
import { createClient } from "@/lib/supabase/client";
import {
  USER_SETTINGS_COLUMNS,
  type UserSettings,
  type UserSettingsPatch,
} from "@/lib/user-settings";
import { signOutEverywhereInTab } from "./client-state";
import {
  PROFILE_COLUMNS,
  type AppRole,
  type Profile,
  type SessionUser,
  type WorkerAccount,
} from "./types";

export const accountKeys = {
  profile: (userId: string) => ["account", userId, "profile"] as const,
  settings: (userId: string) => ["account", userId, "settings"] as const,
};

export const SessionContext = createContext<{
  user: SessionUser;
  roles: AppRole[];
  /** Set when the account works for an owner; it then gets the worker environment. */
  worker: WorkerAccount | null;
} | null>(null);

export function useSession() {
  const session = useContext(SessionContext);
  if (!session) throw new Error("useSession must be used inside <SessionProvider>");
  return session;
}

/** Seeded by the app layout, so it is never pending on screen. */
export function useProfile(): Profile {
  const { user } = useSession();
  const { data } = useQuery({
    queryKey: accountKeys.profile(user.id),
    queryFn: async () => {
      const { data, error } = await createClient()
        .from("profiles")
        .select(PROFILE_COLUMNS)
        .eq("id", user.id)
        .single();
      if (error) throw error;
      return data;
    },
    staleTime: Infinity,
  });
  return data!;
}

/** The database is the source of truth; this is its cached copy. */
export function useUserSettings(): UserSettings {
  const { user } = useSession();
  const { data } = useQuery({
    queryKey: accountKeys.settings(user.id),
    queryFn: async () => {
      const { data, error } = await createClient()
        .from("user_settings")
        .select(USER_SETTINGS_COLUMNS)
        .eq("user_id", user.id)
        .single();
      if (error) throw error;
      return data;
    },
    staleTime: Infinity,
  });
  return data!;
}

/** Saves settings immediately, shows them optimistically and rolls back on failure. */
export function useUpdateSettings() {
  const { user } = useSession();
  const queryClient = useQueryClient();
  const router = useRouter();
  const [, startTransition] = useTransition();
  const key = accountKeys.settings(user.id);

  return useMutation({
    mutationFn: async (patch: UserSettingsPatch) => {
      const { data, error } = await createClient()
        .from("user_settings")
        .update(patch)
        .eq("user_id", user.id)
        .select(USER_SETTINGS_COLUMNS)
        .single();
      if (error) throw error;
      return data;
    },
    onMutate: async (patch) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<UserSettings>(key);
      if (previous) queryClient.setQueryData<UserSettings>(key, { ...previous, ...patch });
      if (patch.locale) {
        writeLocaleCookie(patch.locale as Locale);
        startTransition(() => router.refresh());
      }
      return { previous };
    },
    onError: (_error, patch, context) => {
      if (context?.previous) {
        queryClient.setQueryData(key, context.previous);
        if (patch.locale) {
          writeLocaleCookie(context.previous.locale as Locale);
          startTransition(() => router.refresh());
        }
      }
    },
    onSuccess: (row) => queryClient.setQueryData(key, row),
  });
}

export type ProfilePatch = Partial<
  Pick<
    Profile,
    | "username"
    | "display_name"
    | "avatar_url"
    | "industry"
    | "onboarding_completed_at"
    | "tour_completed_at"
  >
>;

export function useUpdateProfile() {
  const { user } = useSession();
  const queryClient = useQueryClient();
  const key = accountKeys.profile(user.id);

  return useMutation({
    mutationFn: async (patch: ProfilePatch) => {
      const { data, error } = await createClient()
        .from("profiles")
        .update(patch)
        .eq("id", user.id)
        .select(PROFILE_COLUMNS)
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (row) => queryClient.setQueryData(key, row),
  });
}

export function useSignOut() {
  const queryClient = useQueryClient();
  return () => signOutEverywhereInTab(queryClient);
}
