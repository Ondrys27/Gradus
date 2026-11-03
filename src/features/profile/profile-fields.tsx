"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CheckIcon, LoaderCircleIcon, XIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { useProfile, useUpdateProfile } from "@/features/account/queries";
import { DISPLAY_NAME_MAX } from "@/features/auth/schemas";
import { useSaveMarks } from "@/features/settings/save-state";
import { SettingRow } from "@/features/settings/ui";
import { createClient } from "@/lib/supabase/client";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { normalizeUsernameInput, USERNAME_MAX, usernameProblem } from "./username";

type Availability =
  | "unchanged"
  | "empty"
  | "invalid"
  | "checking"
  | "available"
  | "taken"
  | "error";

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

/** Commits on Enter (by leaving the field) and on leaving it. */
function commitKeys(event: React.KeyboardEvent<HTMLInputElement>) {
  if (event.key === "Enter") {
    event.preventDefault();
    event.currentTarget.blur();
  }
}

/**
 * Settings → Account: the display name and the username, each saved on its
 * own when the field is left (or Enter), with a quiet "Saved" by the label.
 */
export function ProfileFields() {
  const t = useTranslations("profile.details");
  const profile = useProfile();
  const updateProfile = useUpdateProfile();
  const marks = useSaveMarks();

  const [displayName, setDisplayName] = useState(profile.display_name ?? "");
  useEffect(() => setDisplayName(profile.display_name ?? ""), [profile.display_name]);
  function commitDisplayName() {
    const next = displayName.trim() || null;
    if (next === (profile.display_name ?? null)) {
      setDisplayName(profile.display_name ?? "");
      return;
    }
    void marks.run(["display_name"], () => updateProfile.mutateAsync({ display_name: next }));
  }

  const [username, setUsername] = useState(profile.username ?? "");
  const [usernameSaveError, setUsernameSaveError] = useState<"taken" | null>(null);
  useEffect(() => setUsername(profile.username ?? ""), [profile.username]);
  const availability = useUsernameAvailability(username, profile.username);
  const problem = username ? usernameProblem(username) : null;
  async function commitUsername() {
    if (availability === "unchanged") return;
    // Not sendable: an invalid or taken name stays in the field with its message.
    // A name still being checked is sent anyway (leaving the field right after
    // typing must not drop it); the unique index answers "taken" just the same.
    if (availability === "invalid" || availability === "taken") return;
    setUsernameSaveError(null);
    const next = username || null;
    let taken = false;
    const ok = await marks.run(["username"], () =>
      updateProfile.mutateAsync({ username: next }).catch((error: { code?: string }) => {
        if (error.code === "23505") {
          taken = true;
          setUsernameSaveError("taken");
        }
        throw error;
      }),
    );
    // A name somebody took meanwhile stays in the field with its message; any other failure reverts.
    if (!ok && !taken) setUsername(profile.username ?? "");
  }

  const usernameMessage =
    availability === "invalid" && problem
      ? { tone: "error", text: t(`username.${problem}`) }
      : availability === "taken" || usernameSaveError === "taken"
        ? { tone: "error", text: t("username.taken") }
        : availability === "available"
          ? { tone: "ok", text: t("username.available") }
          : availability === "checking"
            ? { tone: "muted", text: t("username.checking") }
            : availability === "error"
              ? { tone: "error", text: t("username.checkFailed") }
              : { tone: "muted", text: t("username.hint") };
  const usernameInvalid = usernameMessage.tone === "error";

  return (
    <>
      <SettingRow
        id="settings-display-name"
        label={t("displayName")}
        hint={t("displayNameHint")}
        state={marks.stateOf(["display_name"])}
        layout="stack"
      >
        <Input
          id="settings-display-name"
          value={displayName}
          maxLength={DISPLAY_NAME_MAX}
          autoComplete="name"
          onChange={(event) => setDisplayName(event.target.value)}
          onBlur={commitDisplayName}
          onKeyDown={commitKeys}
        />
      </SettingRow>

      <SettingRow
        id="settings-username"
        label={t("username.label")}
        hint={
          <span
            id="settings-username-message"
            aria-live="polite"
            className={
              usernameMessage.tone === "error"
                ? "text-pink"
                : usernameMessage.tone === "ok"
                  ? "text-green"
                  : undefined
            }
          >
            {usernameMessage.text}
          </span>
        }
        state={marks.stateOf(["username"])}
        layout="stack"
      >
        <div className="relative">
          <span
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-ink-muted"
          >
            @
          </span>
          <Input
            id="settings-username"
            value={username}
            maxLength={USERNAME_MAX + 5}
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            aria-invalid={usernameInvalid || undefined}
            aria-describedby="settings-username-message"
            className="pr-11 pl-8"
            onChange={(event) => {
              setUsernameSaveError(null);
              setUsername(normalizeUsernameInput(event.target.value));
            }}
            onBlur={() => void commitUsername()}
            onKeyDown={commitKeys}
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
      </SettingRow>
    </>
  );
}
