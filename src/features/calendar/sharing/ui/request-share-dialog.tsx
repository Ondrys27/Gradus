"use client";

import { useState, type FormEvent } from "react";
import { CalendarHeartIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { FormField } from "@/components/ui/form-field";
import { Textarea } from "@/components/ui/input";
import { ResponsiveDialog } from "@/components/ui/responsive-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useActiveMembers } from "@/features/account/active-members";
import { useSession } from "@/features/account/queries";
import { useFreshOnOpen } from "@/features/milestones/use-fresh-on-open";
import { formatDateTime } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { REQUEST_MESSAGE_MAX, requestableLevels, type ShareLevel } from "../levels";
import {
  SharingError,
  sharingErrorCode,
  useCalendarPeople,
  useRequestShare,
  type RequestOrigin,
} from "../queries";
import { LevelChoice } from "./level-choice";

const REQUEST_ERRORS = new Set([
  "calendar_request_too_soon",
  "calendar_request_already",
  "calendar_request_limit",
  "calendar_request_target",
  "read_only",
]);

/**
 * "Ask to share their calendar" (30.3): the level and an optional message.
 * The person hears it in the bell, on the dashboard and from Grady, and the
 * answer comes back the same way.
 */
export function RequestShareDialog({
  open,
  onOpenChange,
  personId,
  from,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The person asked; null = pick one. */
  personId: string | null;
  from: RequestOrigin;
}) {
  const t = useTranslations("calendar.sharing.request");
  const generation = useFreshOnOpen(open);
  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("title")}
      closeLabel={t("close")}
    >
      <RequestForm
        key={generation}
        personId={personId}
        from={from}
        onDone={() => onOpenChange(false)}
      />
    </ResponsiveDialog>
  );
}

function RequestForm({
  personId,
  from,
  onDone,
}: {
  personId: string | null;
  from: RequestOrigin;
  onDone: () => void;
}) {
  const t = useTranslations("calendar.sharing");
  const settings = useFormatSettings();
  const { user } = useSession();
  const members = useActiveMembers();
  const people = useCalendarPeople();
  const request = useRequestShare();
  const [person, setPerson] = useState<string | null>(personId);
  const current = people.data?.find((entry) => entry.userId === person)?.level ?? null;
  const levels = requestableLevels(current);
  const [level, setLevel] = useState<ShareLevel>("busy");
  const chosen = levels.includes(level) ? level : (levels[0] ?? "busy");
  const [message, setMessage] = useState("");
  const [sent, setSent] = useState(false);

  const others = (members.data ?? []).filter((member) => member.userId !== user.id);
  const name = others.find((member) => member.userId === person)?.name ?? "";

  if (sent) {
    return (
      <div className="flex flex-col gap-4">
        <FormAlert tone="success">{t("request.sent", { name })}</FormAlert>
        <Button type="button" className="self-end" onClick={onDone}>
          {t("request.done")}
        </Button>
      </div>
    );
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!person || !levels.length) return;
    request.mutate(
      { to: person, level: chosen, message, from },
      { onSuccess: () => setSent(true) },
    );
  }

  const code = request.isError ? sharingErrorCode(request.error) : null;
  const retry =
    code === "calendar_request_too_soon" &&
    request.error instanceof SharingError &&
    request.error.detail
      ? formatDateTime(new Date(request.error.detail), settings)
      : null;

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" data-testid="calendar-request-form">
      <p className="text-sm text-ink-soft">{t("request.hint")}</p>
      {!personId && (
        <FormField id="calendar-request-person" label={t("request.person")}>
          <Select
            value={person ?? ""}
            items={others.map((member) => ({ value: member.userId, label: member.name }))}
            onValueChange={(next) => setPerson(next || null)}
          >
            <SelectTrigger id="calendar-request-person" data-testid="calendar-request-person">
              <SelectValue placeholder={t("request.personPlaceholder")} />
            </SelectTrigger>
            <SelectContent>
              {others.map((member) => (
                <SelectItem key={member.userId} value={member.userId}>
                  {member.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
      )}
      {person && levels.length === 0 ? (
        <FormAlert tone="success">{t("request.already", { name })}</FormAlert>
      ) : (
        <LevelChoice
          name="calendar-request-level"
          value={chosen}
          onChange={setLevel}
          levels={levels.length ? levels : ["busy", "read", "write"]}
        />
      )}
      <FormField id="calendar-request-message" label={t("request.message")}>
        <Textarea
          id="calendar-request-message"
          value={message}
          maxLength={REQUEST_MESSAGE_MAX}
          placeholder={t("request.messagePlaceholder")}
          onChange={(event) => setMessage(event.target.value)}
        />
      </FormField>
      {code && (
        <FormAlert>
          {retry
            ? t("errors.calendar_request_too_soon", { when: retry })
            : t(
                `errors.${REQUEST_ERRORS.has(code) && code !== "calendar_request_too_soon" ? code : "unknown"}`,
              )}
        </FormAlert>
      )}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="ghost" onClick={onDone}>
          {t("request.cancel")}
        </Button>
        <Button
          type="submit"
          disabled={!person || !levels.length || request.isPending}
          data-testid="calendar-request-send"
        >
          {t("request.send")}
        </Button>
      </div>
    </form>
  );
}

/** "Ask to share their calendar" next to a person (company, messages, calendar). */
export function RequestShareButton({
  personId,
  from,
  className,
  variant = "outline",
}: {
  personId: string;
  from: RequestOrigin;
  className?: string;
  variant?: "outline" | "ghost" | "secondary";
}) {
  const t = useTranslations("calendar.sharing.request");
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant={variant}
        size="sm"
        className={className}
        onClick={() => setOpen(true)}
        data-testid="calendar-request-open"
      >
        <CalendarHeartIcon aria-hidden data-icon="inline-start" />
        {t("button")}
      </Button>
      <RequestShareDialog open={open} onOpenChange={setOpen} personId={personId} from={from} />
    </>
  );
}
