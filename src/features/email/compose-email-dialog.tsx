"use client";

import { useState, type ChangeEvent, type FormEvent } from "react";
import { PaperclipIcon, SparklesIcon, XIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { FormField } from "@/components/ui/form-field";
import { Input, Textarea } from "@/components/ui/input";
import { ResponsiveDialog } from "@/components/ui/responsive-dialog";
import { uploadContentType } from "@/features/jarvis/files";
import { formatNumber } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { errorCodeOf, type EmailErrorCode } from "./errors";
import {
  ACCEPTED_EXTENSIONS,
  EmailReplyError,
  MAX_EMAIL_ATTACHMENTS,
  MAX_FILE_BYTES,
  useSendEmail,
  useSuggestEmailReply,
} from "./queries";
import { EMAIL_BODY_MAX, EMAIL_SUBJECT_MAX } from "./types";

/** Codes with their own text under `email.compose.errors`. */
const SEND_ERRORS: EmailErrorCode[] = [
  "contactNotFound",
  "noAddress",
  "fileType",
  "fileTooLarge",
  "fileMissing",
  "tooManyFiles",
  "sendFailed",
];
/** Codes with their own text under `email.compose.aiError`. */
const AI_ERRORS = ["notConfigured", "busy", "unavailable", "limitReached", "network"];

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contactId: string;
  contactEmail: string | null;
  dealId?: string | null;
  defaultSubject?: string;
  /** Fires once the e-mail is actually sent; the caller offers the table move. */
  onSent: (result: { subject: string; body: string }) => void;
};

export function ComposeEmailDialog({
  open,
  onOpenChange,
  contactId,
  contactEmail,
  dealId,
  defaultSubject,
  onSent,
}: Props) {
  const t = useTranslations("email.compose");
  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("title")}
      closeLabel={t("close")}
      className="w-[min(100vw-32px,560px)]"
    >
      {open && (
        <ComposeForm
          contactId={contactId}
          contactEmail={contactEmail}
          dealId={dealId ?? null}
          defaultSubject={defaultSubject ?? ""}
          onDone={() => onOpenChange(false)}
          onSent={onSent}
        />
      )}
    </ResponsiveDialog>
  );
}

function ComposeForm({
  contactId,
  contactEmail,
  dealId,
  defaultSubject,
  onDone,
  onSent,
}: {
  contactId: string;
  contactEmail: string | null;
  dealId: string | null;
  defaultSubject: string;
  onDone: () => void;
  onSent: (result: { subject: string; body: string }) => void;
}) {
  const t = useTranslations("email.compose");
  const settings = useFormatSettings();
  const send = useSendEmail();
  const suggest = useSuggestEmailReply();
  const [subject, setSubject] = useState(defaultSubject);
  const [body, setBody] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [fileError, setFileError] = useState<"fileType" | "fileTooLarge" | "tooManyFiles" | null>(
    null,
  );
  const [showAiHelper, setShowAiHelper] = useState(false);
  const [receivedEmail, setReceivedEmail] = useState("");

  const sendCode = send.error ? errorCodeOf(send.error).code : null;
  const sendDetail = send.error ? errorCodeOf(send.error).detail : undefined;
  const aiCode =
    suggest.error instanceof EmailReplyError
      ? suggest.error.code
      : suggest.error
        ? "unknown"
        : null;

  function onPickFiles(event: ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!picked.length) return;
    let problem: "fileType" | "fileTooLarge" | "tooManyFiles" | null = null;
    const accepted: File[] = [];
    for (const file of picked) {
      if (!uploadContentType(file.name)) problem = "fileType";
      else if (file.size > MAX_FILE_BYTES) problem = "fileTooLarge";
      else if (file.size > 0) accepted.push(file);
    }
    const next = [...files, ...accepted];
    if (next.length > MAX_EMAIL_ATTACHMENTS) problem = "tooManyFiles";
    setFiles(next.slice(0, MAX_EMAIL_ATTACHMENTS));
    setFileError(problem);
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!contactEmail || !subject.trim() || !body.trim() || send.isPending) return;
    try {
      await send.mutateAsync({
        contactId,
        dealId,
        subject: subject.trim(),
        body: body.trim(),
        files,
      });
      onSent({ subject: subject.trim(), body: body.trim() });
      onDone();
    } catch {
      // The error banner below shows the reason; the draft stays for another try.
    }
  }

  async function onSuggest() {
    if (!receivedEmail.trim()) return;
    try {
      const reply = await suggest.mutateAsync({
        contactId,
        dealId,
        receivedEmail: receivedEmail.trim(),
      });
      setBody(reply);
    } catch {
      // The error banner below shows the reason.
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <p className="text-sm text-ink-soft">
        {contactEmail ? t("to", { email: contactEmail }) : t("noAddress")}
      </p>

      <FormField id="email-subject" label={t("subject")}>
        <Input
          id="email-subject"
          value={subject}
          maxLength={EMAIL_SUBJECT_MAX}
          placeholder={t("subjectPlaceholder")}
          onChange={(event) => setSubject(event.target.value)}
        />
      </FormField>

      <FormField id="email-body" label={t("body")}>
        <Textarea
          id="email-body"
          value={body}
          maxLength={EMAIL_BODY_MAX}
          rows={7}
          placeholder={t("bodyPlaceholder")}
          onChange={(event) => setBody(event.target.value)}
        />
      </FormField>

      <div className="flex flex-col gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="self-start"
          onClick={() => setShowAiHelper((current) => !current)}
        >
          <SparklesIcon aria-hidden data-icon="inline-start" />
          {t("aiToggle")}
        </Button>
        {showAiHelper && (
          <div className="flex flex-col gap-2 rounded-xl border border-line bg-surface-hover/40 p-3">
            <FormField id="email-received" label={t("aiReceivedLabel")}>
              <Textarea
                id="email-received"
                value={receivedEmail}
                rows={5}
                placeholder={t("aiReceivedPlaceholder")}
                onChange={(event) => setReceivedEmail(event.target.value)}
              />
            </FormField>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="self-start"
              disabled={!receivedEmail.trim() || suggest.isPending}
              onClick={() => void onSuggest()}
            >
              {suggest.isPending ? t("aiWorking") : t("aiSuggest")}
            </Button>
            {aiCode && (
              <FormAlert>
                {t(`aiError.${AI_ERRORS.includes(aiCode) ? aiCode : "unknown"}`)}
              </FormAlert>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <input
          id="email-attachments"
          type="file"
          multiple
          accept={ACCEPTED_EXTENSIONS.join(",")}
          onChange={onPickFiles}
          className="sr-only"
        />
        <label
          htmlFor="email-attachments"
          className="inline-flex w-fit cursor-pointer items-center gap-2 rounded-full border border-line px-3 py-2 text-sm text-ink-soft outline-none hover:text-ink"
        >
          <PaperclipIcon aria-hidden className="size-4" />
          {t("attach", {
            max: formatNumber(MAX_EMAIL_ATTACHMENTS, {}, settings),
            size: formatNumber(MAX_FILE_BYTES / 1024 / 1024, {}, settings),
          })}
        </label>
        {files.length > 0 && (
          <ul aria-label={t("filesSelected")} className="flex flex-wrap gap-2">
            {files.map((file, index) => (
              <li
                key={`${file.name}-${index}`}
                className="flex max-w-full items-center gap-1.5 rounded-full border border-line bg-canvas py-1 pr-1 pl-3 text-xs text-ink"
              >
                <span className="max-w-48 truncate">{file.name}</span>
                <button
                  type="button"
                  onClick={() => setFiles((current) => current.filter((_, i) => i !== index))}
                  aria-label={t("removeFile", { name: file.name })}
                  className="grid size-8 place-items-center rounded-full text-ink-muted outline-none hover:text-ink"
                >
                  <XIcon aria-hidden className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
        {fileError && (
          <p role="alert" className="text-xs text-pink">
            {t(`errors.${fileError}`, {
              max: formatNumber(MAX_EMAIL_ATTACHMENTS, {}, settings),
              size: formatNumber(MAX_FILE_BYTES / 1024 / 1024, {}, settings),
            })}
          </p>
        )}
      </div>

      {sendCode && (
        <FormAlert>
          {t(`errors.${SEND_ERRORS.includes(sendCode as EmailErrorCode) ? sendCode : "unknown"}`)}
          {sendDetail ? ` ${t("detail", { detail: sendDetail })}` : ""}
        </FormAlert>
      )}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="ghost" onClick={onDone}>
          {t("cancel")}
        </Button>
        <Button
          type="submit"
          disabled={!contactEmail || !subject.trim() || !body.trim() || send.isPending}
        >
          {send.isPending ? t("sending") : t("send")}
        </Button>
      </div>
    </form>
  );
}
