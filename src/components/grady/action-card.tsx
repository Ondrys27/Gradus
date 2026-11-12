"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  CircleAlertIcon,
  CircleCheckIcon,
  ClockIcon,
  ExternalLinkIcon,
  ShieldQuestionIcon,
  Undo2Icon,
  XIcon,
} from "lucide-react";
import { canStillUndo, cardExpired, type ActionCard as Card } from "@/features/grady/actions";
import { ActionDecisionError, useDecideAction } from "@/features/grady/use-action-cards";
import { cn } from "@/lib/utils";

const BUTTON =
  "inline-flex min-h-11 items-center gap-1.5 rounded-full px-3.5 text-sm font-medium outline-none focus-visible:ring-3 focus-visible:ring-teal/50 disabled:opacity-50 mouse:min-h-8";

/**
 * One change of Grady's under his answer. Done: "Done: …" with Open and
 * Undo (24 h). Waiting: exactly what will happen, the whole text of a
 * message or an e-mail, with Confirm / Cancel (30 min). Otherwise its state.
 */
export function ActionCard({ card, onNavigate }: { card: Card; onNavigate?: () => void }) {
  const t = useTranslations("grady.actions");
  const decide = useDecideAction();
  const status = cardExpired(card) ? "expired" : card.status;
  const failure =
    decide.error instanceof ActionDecisionError
      ? decide.error.code
      : decide.error
        ? "failed"
        : null;
  const waiting = status === "pending";

  const Icon =
    status === "done"
      ? CircleCheckIcon
      : waiting
        ? ShieldQuestionIcon
        : status === "failed"
          ? CircleAlertIcon
          : status === "expired"
            ? ClockIcon
            : Undo2Icon;

  return (
    <div
      className={cn(
        "w-full rounded-2xl border bg-surface px-3.5 py-3 text-sm",
        waiting ? "border-gold/50" : status === "done" ? "border-green/40" : "border-line",
      )}
      data-testid="grady-action"
      data-status={status}
    >
      <div className="flex items-start gap-2.5">
        <Icon
          aria-hidden
          className={cn(
            "mt-0.5 size-4 shrink-0",
            status === "done"
              ? "text-green"
              : waiting
                ? "text-gold"
                : status === "failed"
                  ? "text-pink"
                  : "text-ink-muted",
          )}
        />
        <div className="min-w-0 flex-1">
          <p className="break-words text-ink">
            <span className="font-medium">{t(`status.${status}`)}</span> {card.summary}
          </p>
          {card.preview && (
            <p className="mt-1.5 max-h-48 overflow-y-auto rounded-xl bg-surface-hover px-3 py-2 text-xs leading-relaxed break-words whitespace-pre-wrap text-ink-soft">
              {card.preview}
            </p>
          )}
          {card.error && status === "failed" && (
            <p className="mt-1 text-xs text-ink-muted">{t(`errors.${errorKey(card.error)}`)}</p>
          )}
          <div className="mt-2 flex flex-wrap gap-2">
            {waiting && (
              <>
                <button
                  type="button"
                  disabled={decide.isPending}
                  onClick={() => decide.mutate({ kind: "confirmAction", id: card.id })}
                  className={cn(BUTTON, "bg-teal/20 text-ink hover:bg-teal/30")}
                >
                  <CircleCheckIcon aria-hidden className="size-4" />
                  {t("confirm")}
                </button>
                <button
                  type="button"
                  disabled={decide.isPending}
                  onClick={() => decide.mutate({ kind: "rejectAction", id: card.id })}
                  className={cn(BUTTON, "text-ink-soft hover:bg-surface-hover")}
                >
                  <XIcon aria-hidden className="size-4" />
                  {t("reject")}
                </button>
              </>
            )}
            {status === "done" && card.href && (
              <Link
                href={card.href}
                onClick={onNavigate}
                className={cn(BUTTON, "text-ink-soft hover:bg-surface-hover")}
              >
                <ExternalLinkIcon aria-hidden className="size-4" />
                {t("open")}
              </Link>
            )}
            {canStillUndo(card) && (
              <button
                type="button"
                disabled={decide.isPending}
                onClick={() => decide.mutate({ kind: "undoAction", id: card.id })}
                className={cn(BUTTON, "bg-teal/15 text-ink hover:bg-teal/25")}
              >
                <Undo2Icon aria-hidden className="size-4" />
                {t("undo")}
              </button>
            )}
          </div>
          {failure && (
            <p role="alert" className="mt-1 text-xs text-pink">
              {t(`errors.${errorKey(failure)}`)}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/** Codes with their own sentence; anything else reads as a general failure. */
const KNOWN_ERRORS = [
  "changed",
  "gone",
  "tooLate",
  "expired",
  "decided",
  "spaceChanged",
  "forbidden",
  "readOnly",
  "notFound",
  "invalid",
  "openSubtasks",
  "milestoneNotReady",
] as const;

function errorKey(code: string): (typeof KNOWN_ERRORS)[number] | "failed" {
  return (KNOWN_ERRORS as readonly string[]).includes(code)
    ? (code as (typeof KNOWN_ERRORS)[number])
    : "failed";
}
