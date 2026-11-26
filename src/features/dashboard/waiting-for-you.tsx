"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import {
  CalendarClockIcon,
  CalendarHeartIcon,
  ClipboardListIcon,
  MailOpenIcon,
  MailPlusIcon,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FormAlert } from "@/components/ui/form-alert";
import { GlowCard } from "@/components/ui/glow-card";
import { useSession } from "@/features/account/queries";
import {
  InboxActionError,
  inviterName,
  useInbox,
  useRespondInvite,
} from "@/features/account/inbox";
import { useSwitchSpace } from "@/features/account/space-switch";
import { useCan, useWorkspace } from "@/features/account/workspace-queries";
import {
  useBookingSurveys,
  useDismissSurvey,
  useSetNoShow,
  useWaitingBookings,
} from "@/features/scheduler/booking-queries";
import { bookingAppPath } from "@/features/scheduler/booking/paths";
import { BookingControls } from "@/features/scheduler/ui/booking-controls";
import { formatNumber, formatSlotMoment } from "@/lib/format";
import { INVITES_PATH } from "@/lib/routes";
import { useFormatSettings } from "@/lib/use-format-settings";
import { cn } from "@/lib/utils";
import { MeetingSurveyDialog, type SurveyTarget } from "./meeting-survey-dialog";
import { useShareRequests, type ShareRequest } from "@/features/calendar/sharing/queries";
import { AnswerForm } from "@/features/calendar/sharing/ui/answer-request-dialog";

/** Calendar share requests waiting for the account in the open company (30.3). */
function useWaitingRequests() {
  const requests = useShareRequests();
  return {
    query: requests,
    list: (requests.data ?? []).filter(
      (request) => request.incoming && request.status === "pending",
    ),
  };
}

const requestHref = (request: ShareRequest) => `/app/kalendar?shareRequest=${request.id}`;

export type WaitingItem = {
  key: string;
  kind: "booking" | "invite" | "survey" | "calendarRequest";
  /** Who it is about: the guest, the company, the deal. */
  who: string;
  /** When the meeting is or was; invites have none. */
  when: string | null;
  href: string;
};

/**
 * What waits, as one flat list for the dashboard widget's small sizes (28.6):
 * the same reads as the cards below, so both agree and share the cache.
 */
export function useWaitingItems() {
  const t = useTranslations("dashboard.waiting");
  const workspace = useWorkspace();
  const bookings = useWaitingBookings();
  const inbox = useInbox();
  const surveyRight = useCan("pipeline", "update");
  const surveys = useBookingSurveys(surveyRight && !workspace.readOnly);
  const requests = useWaitingRequests();
  const queries = [
    bookings,
    inbox,
    requests.query,
    ...(surveyRight && !workspace.readOnly ? [surveys] : []),
  ];
  const items: WaitingItem[] = [
    ...(bookings.data ?? []).map((booking) => ({
      key: `booking-${booking.id}`,
      kind: "booking" as const,
      who: booking.guest_name ?? booking.typeName ?? t("booking.meeting"),
      when: booking.starts_at,
      href: bookingAppPath(booking.id),
    })),
    ...(inbox.data?.invites ?? []).map((invite) => ({
      key: `invite-${invite.id}`,
      kind: "invite" as const,
      who: inviterName(invite) ?? t("invite.someone"),
      when: null,
      href: INVITES_PATH,
    })),
    ...(surveys.data ?? []).map((booking) => ({
      key: `survey-${booking.id}`,
      kind: "survey" as const,
      who: booking.guest_name ?? booking.dealTitle ?? "",
      when: booking.starts_at,
      href: bookingAppPath(booking.id),
    })),
    ...requests.list.map((request) => ({
      key: `calendar-request-${request.id}`,
      kind: "calendarRequest" as const,
      who: request.name,
      when: null,
      href: requestHref(request),
    })),
  ];
  return {
    items,
    pending: queries.some((query) => query.isPending),
    failed: queries.some((query) => query.isError && query.data === undefined),
    refetch: () => {
      for (const query of queries) void query.refetch();
    },
  };
}

/**
 * "Waiting for you" on the dashboard (24.4): what only the person can decide,
 * as cards with the decision right on them. Meetings to approve (Confirm /
 * Decline), invites into other companies (Accept / Decline) and booked
 * meetings that are over and wait for the meeting survey. Hidden when
 * nothing waits; more kinds join later.
 */
export function WaitingForYou({
  variant = "section",
  empty = null,
}: {
  /** "widget": inside the dashboard widget, without its own heading. */
  variant?: "section" | "widget";
  /** Shown instead when nothing waits (the widget's empty state). */
  empty?: ReactNode;
} = {}) {
  const t = useTranslations("dashboard.waiting");
  const { user } = useSession();
  const workspace = useWorkspace();
  const bookings = useWaitingBookings();
  const inbox = useInbox();
  // The survey is filed under the deal: only where the person may write the pipeline.
  const surveyRight = useCan("pipeline", "update");
  const surveys = useBookingSurveys(surveyRight && !workspace.readOnly);
  const [survey, setSurvey] = useState<SurveyTarget | null>(null);
  // An accepted invite leaves the inbox; its card stays to offer the company.
  const [accepted, setAccepted] = useState<{ spaceId: string; who: string } | null>(null);
  const requests = useWaitingRequests().list;

  const pending = bookings.data ?? [];
  const invites = inbox.data?.invites ?? [];
  const asked = surveys.data ?? [];
  if (!pending.length && !invites.length && !asked.length && !requests.length && !accepted)
    return empty;
  const widget = variant === "widget";

  return (
    <section
      aria-labelledby={widget ? undefined : "waiting-title"}
      aria-label={widget ? t("title") : undefined}
      className="flex flex-col gap-3"
      data-testid="waiting-for-you"
    >
      {!widget && (
        <h2 id="waiting-title" className="micro-label">
          {t("title")}
        </h2>
      )}
      <ul
        className={
          widget
            ? "grid gap-3 @2xl:grid-cols-2 @5xl:grid-cols-3"
            : "grid gap-3 md:grid-cols-2 xl:grid-cols-3"
        }
      >
        {pending.map((booking) => (
          <li key={booking.id}>
            <BookingCard
              title={t("booking.title", {
                guest: booking.guest_name ?? "",
                type: booking.typeName ?? t("booking.meeting"),
              })}
              when={booking.starts_at}
              href={bookingAppPath(booking.id)}
              testId="waiting-booking"
            >
              <BookingControls
                booking={booking}
                isHost={booking.host_user_id === user.id}
                compact
              />
            </BookingCard>
          </li>
        ))}
        {accepted && (
          <li>
            <AcceptedInviteCard spaceId={accepted.spaceId} who={accepted.who} />
          </li>
        )}
        {invites.map((invite) => (
          <li key={invite.id}>
            <InviteCard
              inviteId={invite.id}
              who={inviterName(invite) ?? t("invite.someone")}
              onAccepted={(spaceId, who) => setAccepted({ spaceId, who })}
            />
          </li>
        ))}
        {requests.map((request) => (
          <li key={request.id}>
            <GlowCard
              interactive={false}
              className="flex h-full flex-col gap-3 p-4"
              data-testid="waiting-calendar-request"
            >
              <div className="flex items-start gap-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-full bg-teal/15 text-teal">
                  <CalendarHeartIcon aria-hidden className="size-4" />
                </span>
                <p className="font-medium text-ink">
                  {t("calendarRequest.title", { who: request.name })}
                </p>
              </div>
              <AnswerForm request={request} />
            </GlowCard>
          </li>
        ))}
        {asked.map((booking) => (
          <li key={booking.id}>
            <SurveyCard
              bookingId={booking.id}
              title={t("survey.title", { guest: booking.guest_name ?? "" })}
              when={booking.starts_at}
              onOpen={() =>
                booking.deal_id &&
                setSurvey({
                  dealId: booking.deal_id,
                  dealTitle: booking.dealTitle ?? booking.guest_name ?? "",
                  stageId: booking.stageId,
                  bookingId: booking.id,
                })
              }
            />
          </li>
        ))}
      </ul>
      <MeetingSurveyDialog target={survey} onClose={() => setSurvey(null)} />
    </section>
  );
}

function BookingCard({
  title,
  when,
  href,
  testId,
  children,
}: {
  title: string;
  when: string;
  href: string;
  testId: string;
  children: React.ReactNode;
}) {
  const t = useTranslations("dashboard.waiting");
  const settings = useFormatSettings();
  const locale = useLocale();
  return (
    <GlowCard interactive={false} className="flex h-full flex-col gap-3 p-4" data-testid={testId}>
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-gold/15 text-gold">
          <CalendarClockIcon aria-hidden className="size-4" />
        </span>
        <div className="flex min-w-0 flex-col">
          <p className="font-medium text-ink">{title}</p>
          <p className="text-sm text-ink-muted">
            {formatSlotMoment(new Date(when), settings, locale)}
          </p>
        </div>
      </div>
      {children}
      <Link href={href} className="text-sm text-violet hover:underline">
        {t("booking.open")}
      </Link>
    </GlowCard>
  );
}

type InviteProps = {
  inviteId: string;
  who: string;
  onAccepted: (spaceId: string, who: string) => void;
};

function InviteCard({ inviteId, who, onAccepted }: InviteProps) {
  const t = useTranslations("dashboard.waiting.invite");
  return (
    <GlowCard
      interactive={false}
      className="flex h-full flex-col gap-3 p-4"
      data-testid="waiting-invite"
    >
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-violet/15 text-violet">
          <MailPlusIcon aria-hidden className="size-4" />
        </span>
        <p className="font-medium text-ink">{t("title", { who })}</p>
      </div>
      <InviteActions inviteId={inviteId} who={who} onAccepted={onAccepted} />
      <Link href={INVITES_PATH} className="text-sm text-violet hover:underline">
        {t("open")}
      </Link>
    </GlowCard>
  );
}

/** Accept / Decline (which asks first), shared by the card and the compact widget. */
function InviteActions({ inviteId, who, onAccepted }: InviteProps) {
  const t = useTranslations("dashboard.waiting.invite");
  const tInvites = useTranslations("invites");
  const respond = useRespondInvite();
  const [declining, setDeclining] = useState(false);
  const failure =
    respond.error instanceof InboxActionError
      ? tInvites(`errors.${respond.error.code}`)
      : respond.error
        ? tInvites("errors.unknown")
        : null;
  return (
    <>
      {failure && <FormAlert>{failure}</FormAlert>}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={respond.isPending}
          data-testid="waiting-invite-accept"
          onClick={() =>
            respond.mutate(
              { inviteId, accept: true },
              { onSuccess: (data) => onAccepted(data.spaceId, who) },
            )
          }
        >
          {t("accept")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={respond.isPending}
          onClick={() => setDeclining(true)}
        >
          {t("decline")}
        </Button>
      </div>
      <ConfirmDialog
        open={declining}
        onOpenChange={setDeclining}
        title={tInvites("declineTitle")}
        description={tInvites("declineText", { who })}
        confirmLabel={t("decline")}
        cancelLabel={tInvites("cancel")}
        closeLabel={tInvites("cancel")}
        pending={respond.isPending}
        error={declining ? failure : null}
        onConfirm={() =>
          respond.mutate({ inviteId, accept: false }, { onSuccess: () => setDeclining(false) })
        }
      />
    </>
  );
}

/**
 * Accepted on the dashboard: the company is now the person's, but the
 * switcher was read when the app loaded, so both ways reload the page.
 */
function AcceptedInviteCard({ spaceId, who }: { spaceId: string; who: string }) {
  const t = useTranslations("dashboard.waiting.invite");
  return (
    <GlowCard
      interactive={false}
      className="flex h-full flex-col gap-3 border-green/40 p-4"
      data-testid="waiting-invite-accepted"
    >
      <p className="flex items-center gap-2 font-medium text-ink">
        <MailOpenIcon aria-hidden className="size-4 shrink-0 text-green" />
        {t("acceptedTitle", { who })}
      </p>
      <AcceptedInviteActions spaceId={spaceId} />
    </GlowCard>
  );
}

/** Go there (the company) or later, which reloads so the switcher learns of it. */
function AcceptedInviteActions({ spaceId }: { spaceId: string }) {
  const t = useTranslations("dashboard.waiting.invite");
  const tInvites = useTranslations("invites");
  const { state, switchTo } = useSwitchSpace();
  return (
    <>
      {state === "failed" && <FormAlert>{tInvites("switchFailed")}</FormAlert>}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => void switchTo(spaceId)} disabled={state === "switching"}>
          {t("goThere")}
        </Button>
        <Button size="sm" variant="outline" onClick={() => window.location.reload()}>
          {t("later")}
        </Button>
      </div>
    </>
  );
}

type SurveyProps = {
  bookingId: string;
  title: string;
  when: string;
  onOpen: () => void;
};

function SurveyCard({ bookingId, title, when, onOpen }: SurveyProps) {
  const settings = useFormatSettings();
  const locale = useLocale();
  return (
    <GlowCard
      interactive={false}
      className="flex h-full flex-col gap-3 p-4"
      data-testid="waiting-survey"
    >
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-teal/15 text-teal">
          <ClipboardListIcon aria-hidden className="size-4" />
        </span>
        <div className="flex min-w-0 flex-col">
          <p className="font-medium text-ink">{title}</p>
          <p className="text-sm text-ink-muted">
            {formatSlotMoment(new Date(when), settings, locale)}
          </p>
        </div>
      </div>
      <SurveyActions bookingId={bookingId} onOpen={onOpen} />
    </GlowCard>
  );
}

/** Fill in, no-show, skip: the survey's three answers. */
function SurveyActions({ bookingId, onOpen }: Pick<SurveyProps, "bookingId" | "onOpen">) {
  const t = useTranslations("dashboard.waiting.survey");
  const dismiss = useDismissSurvey();
  const noShow = useSetNoShow();
  return (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" onClick={onOpen}>
        {t("fill")}
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={noShow.isPending}
        onClick={() => noShow.mutate({ bookingId, noShow: true })}
      >
        {t("noShow")}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={dismiss.isPending}
        onClick={() => dismiss.mutate(bookingId)}
      >
        {t("skip")}
      </Button>
    </div>
  );
}

/**
 * The widget's one-row size (M, 28.6): no room for cards, so the first thing
 * that waits is shown with its decision right there (the same testids and
 * dialogs as the cards), and one quiet line says how many more there are.
 * Order as the cards: meetings to approve, an accepted invite, invites, surveys.
 */
export function WaitingCompact({ empty = null }: { empty?: ReactNode }) {
  const t = useTranslations("dashboard.waiting");
  const tWidget = useTranslations("dashboard.widgets.waiting");
  const settings = useFormatSettings();
  const { user } = useSession();
  const workspace = useWorkspace();
  const bookings = useWaitingBookings();
  const inbox = useInbox();
  const surveyRight = useCan("pipeline", "update");
  const surveys = useBookingSurveys(surveyRight && !workspace.readOnly);
  const [survey, setSurvey] = useState<SurveyTarget | null>(null);
  const [accepted, setAccepted] = useState<{ spaceId: string; who: string } | null>(null);
  const requests = useWaitingRequests().list;

  const pending = bookings.data ?? [];
  const invites = inbox.data?.invites ?? [];
  const asked = surveys.data ?? [];
  const total = pending.length + invites.length + asked.length + requests.length;
  if (!total && !accepted) return empty;

  let first: {
    testId: string;
    title: string;
    actions: ReactNode;
    href: string;
    className?: string;
  };
  if (pending.length) {
    const booking = pending[0];
    first = {
      testId: "waiting-booking",
      title: t("booking.title", {
        guest: booking.guest_name ?? "",
        type: booking.typeName ?? t("booking.meeting"),
      }),
      actions: (
        <BookingControls booking={booking} isHost={booking.host_user_id === user.id} compact />
      ),
      href: bookingAppPath(booking.id),
    };
  } else if (accepted) {
    first = {
      testId: "waiting-invite-accepted",
      title: t("invite.acceptedTitle", { who: accepted.who }),
      actions: <AcceptedInviteActions spaceId={accepted.spaceId} />,
      href: INVITES_PATH,
      className: "text-green",
    };
  } else if (invites.length) {
    const invite = invites[0];
    const who = inviterName(invite) ?? t("invite.someone");
    first = {
      testId: "waiting-invite",
      title: t("invite.title", { who }),
      actions: (
        <InviteActions
          inviteId={invite.id}
          who={who}
          onAccepted={(spaceId, name) => setAccepted({ spaceId, who: name })}
        />
      ),
      href: INVITES_PATH,
    };
  } else if (!asked.length && requests.length) {
    const request = requests[0];
    first = {
      testId: "waiting-calendar-request",
      title: t("calendarRequest.title", { who: request.name }),
      actions: (
        <Link href={requestHref(request)} className="text-sm text-violet hover:underline">
          {t("calendarRequest.open")}
        </Link>
      ),
      href: requestHref(request),
    };
  } else {
    const booking = asked[0];
    first = {
      testId: "waiting-survey",
      title: t("survey.title", { guest: booking.guest_name ?? "" }),
      actions: (
        <SurveyActions
          bookingId={booking.id}
          onOpen={() =>
            booking.deal_id &&
            setSurvey({
              dealId: booking.deal_id,
              dealTitle: booking.dealTitle ?? booking.guest_name ?? "",
              stageId: booking.stageId,
              bookingId: booking.id,
            })
          }
        />
      ),
      href: bookingAppPath(booking.id),
    };
  }
  const more = total - (first.testId === "waiting-invite-accepted" ? 0 : 1);

  return (
    <div
      className="flex min-h-0 flex-1 flex-col justify-between gap-2"
      aria-label={t("title")}
      data-testid="waiting-for-you"
    >
      <div className="flex min-w-0 flex-col gap-2" data-testid={first.testId}>
        <Link
          href={first.href}
          className={cn(
            "truncate text-sm font-semibold text-ink outline-none hover:underline focus-visible:ring-3 focus-visible:ring-violet/40",
            first.className,
          )}
        >
          {first.title}
        </Link>
        {first.actions}
      </div>
      {more > 0 && (
        <p className="truncate text-xs text-ink-muted">
          {tWidget("more", { count: more, formatted: formatNumber(more, {}, settings) })}
        </p>
      )}
      <MeetingSurveyDialog target={survey} onClose={() => setSurvey(null)} />
    </div>
  );
}
