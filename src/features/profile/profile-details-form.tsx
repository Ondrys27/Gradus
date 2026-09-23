"use client";

import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { CheckIcon, LoaderCircleIcon, XIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { fieldA11y, FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { useProfile, useSession, useUpdateProfile } from "@/features/account/queries";
import { DISPLAY_NAME_MAX } from "@/features/auth/schemas";
import { createClient } from "@/lib/supabase/client";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { cn } from "@/lib/utils";
import { normalizeUsernameInput, USERNAME_MAX, usernameProblem } from "./username";

type Availability =
  "unchanged" | "empty" | "invalid" | "checking" | "available" | "taken" | "error";

function useUsernameAvailability(value: string, current: string | null): Availability {
  const debounced = useDebouncedValue(value, 350);
  const valid = value !== "" && usernameProblem(value) === null;
  const unchanged = value === (current ?? "");
  const { data, isError } = useQuery({
    queryKey: ["username-available", debounced],
    queryFn: async () => {
      const { data, error } = await createClient().rpc("username_available", {
        _username: debounced,
      });
      if (error) throw error;
      return data;
    },
    enabled: valid && !unchanged && debounced === value,
    staleTime: 30_000,
    retry: false,
  });

  if (unchanged) return "unchanged";
  if (value === "") return "empty";
  if (!valid) return "invalid";
  if (isError) return "error";
  if (debounced !== value || data === undefined) return "checking";
  return data ? "available" : "taken";
}

export function ProfileDetailsForm() {
  const t = useTranslations("profile.details");
  const { user } = useSession();
  const profile = useProfile();
  const updateProfile = useUpdateProfile();
  const [displayName, setDisplayName] = useState(profile.display_name ?? "");
  const [username, setUsername] = useState(profile.username ?? "");
  const [saveState, setSaveState] = useState<"idle" | "saved" | "taken" | "error">("idle");
  const availability = useUsernameAvailability(username, profile.username);
  const problem = username ? usernameProblem(username) : null;

  const dirty =
    displayName.trim() !== (profile.display_name ?? "") || username !== (profile.username ?? "");
  const blocked =
    availability === "invalid" || availability === "taken" || availability === "checking";

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!dirty || blocked) return;
    setSaveState("idle");
    try {
      await updateProfile.mutateAsync({
        display_name: displayName.trim() || null,
        username: username || null,
      });
      setSaveState("saved");
    } catch (error) {
      setSaveState((error as { code?: string }).code === "23505" ? "taken" : "error");
    }
  }

  const usernameError =
    availability === "invalid" && problem
      ? t(`username.${problem}`)
      : availability === "taken" || saveState === "taken"
        ? t("username.taken")
        : undefined;
  const usernameHint =
    availability === "available"
      ? t("username.available")
      : availability === "checking"
        ? t("username.checking")
        : availability === "error"
          ? t("username.checkFailed")
          : t("username.hint");

  return (
    <form onSubmit={submit} className="flex flex-col gap-5" noValidate>
      <FormField id="profile-display-name" label={t("displayName")} hint={t("displayNameHint")}>
        <Input
          {...fieldA11y("profile-display-name", undefined, true)}
          value={displayName}
          maxLength={DISPLAY_NAME_MAX}
          autoComplete="name"
          onChange={(event) => {
            setDisplayName(event.target.value);
            setSaveState("idle");
          }}
        />
      </FormField>

      <FormField
        id="profile-username"
        label={t("username.label")}
        error={usernameError}
        hint={usernameHint}
      >
        <div className="relative">
          <span
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-ink-muted"
          >
            @
          </span>
          <Input
            {...fieldA11y("profile-username", usernameError, true)}
            value={username}
            maxLength={USERNAME_MAX + 5}
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            className="pr-11 pl-8"
            onChange={(event) => {
              setUsername(normalizeUsernameInput(event.target.value));
              setSaveState("idle");
            }}
          />
          <span
            className="pointer-events-none absolute top-1/2 right-3.5 -translate-y-1/2"
            aria-hidden
          >
            {availability === "checking" && (
              <LoaderCircleIcon className="size-4 animate-spin text-ink-muted motion-reduce:animate-none" />
            )}
            {availability === "available" && <CheckIcon className="size-4 text-green" />}
            {(availability === "taken" || availability === "invalid") && (
              <XIcon className="size-4 text-pink" />
            )}
          </span>
        </div>
      </FormField>

      <FormField id="profile-email" label={t("email")} hint={t("emailHint")}>
        <Input
          {...fieldA11y("profile-email", undefined, true)}
          value={user.email}
          readOnly
          disabled
        />
      </FormField>

      {saveState === "error" && <FormAlert>{t("saveFailed")}</FormAlert>}

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={!dirty || blocked || updateProfile.isPending}>
          {updateProfile.isPending ? t("saving") : t("save")}
        </Button>
        <span
          role="status"
          className={cn(
            "flex items-center gap-1.5 text-sm text-green transition-opacity",
            saveState === "saved" && !dirty ? "opacity-100" : "opacity-0",
          )}
        >
          <CheckIcon aria-hidden className="size-4" />
          {saveState === "saved" && !dirty ? t("saved") : null}
        </span>
      </div>
    </form>
  );
}
