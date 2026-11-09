"use client";

import { useState } from "react";
import Link from "next/link";
import { CalendarClockIcon, ClipboardListIcon, MailPlusIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { GlowCard } from "@/components/ui/glow-card";
import { useSession } from "@/features/account/queries";
import { InboxActionError, inviterName, useInbox, useRespondInvite } from "@/features/account/inbox";
import { useCan, useWorkspace } from "@/features/account/workspace-queries";
import {
  useBookingSurveys,
  useDismissSurvey,
  useSetNoShow,
  useWaitingBookings,
} from "@/features/scheduler/booking-queries";
import { bookingAppPath } from "@/features/scheduler/booking/paths";
import { BookingControls } from "@/features/scheduler/ui/booking-controls";
import { formatSlotMoment } from "@/lib/format";
import { INVITES_PATH } from "@/lib/routes";
import { useFormatSettings } from "@/lib/use-format-settings";
import { MeetingSurveyDialog, type SurveyTarget } from "./meeting-survey-dialog";

/**
 * "Waiting for you" on the dashboard (24.4): what only the person can decide,
 * as cards with the decision right on them. Meetings to approve (Confirm /
 * Decline), invites into other companies (Accept / Decline) and booked
 * meetings that are over and wait for the meeting survey. Hidden when
 * nothing waits; more kinds join later.
 */
export function WaitingForYou() {
  const t = useTranslations("dashboard.waiting");
  const { user } = useSession();
  const workspace = useWorkspace();
  const bookings = useWaitingBookings();
  const inbox = useInbox();
  // The survey is filed under the deal: only where the person may write the pipeline.
  const surveyRight = useCan("pipeline", "update");
  const surveys = useBookingSurveys(surveyRight && !workspace.readOnly);
  const [survey, setSurvey] = useState<SurveyTarget | null>(null);

  const pending = bookings.data ?? [];
  const invites = inbox.data?.invites ?? [];
  const asked = surveys.data ?? [];
  if (!pending.length && !invites.length && !asked.length) return null;

  return (
    <section aria-labelledby="waiting-title" className="flex flex-col gap-3" data-testid="waiting-for-you">
      <h2 id="waiting-title" className="micro-label">
        {t("title")}
      </h2>
      <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {pending.map((booking) => (
          <li key={booking.id}>
            <BookingCard
              title={t("booking.title", { guest: booking.guest_name ?? "", type: booking.typeName ?? t("booking.meeting") })}
              when={booking.starts_at}
              href={bookingAppPath(booking.id)}
              testId="waiting-booking"
            >
              <BookingControls booking={booking} isHost={booking.host_user_id === user.id} compact />
            </BookingCard>
          </li>
        ))}
        {invites.map((invite) => (
          <li key={invite.id}>
            <InviteCard inviteId={invite.id} who={inviterName(invite) ?? t("invite.someone")} />
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
          <p className="text-sm text-ink-muted">{formatSlotMoment(new Date(when), settings, locale)}</p>
        </div>
      </div>
      {children}
      <Link href={href} className="text-sm text-violet hover:underline">
        {t("booking.open")}
      </Link>
    </GlowCard>
  );
}

function InviteCard({ inviteId, who }: { inviteId: string; who: string }) {
  const t = useTranslations("dashboard.waiting.invite");
  const tInvites = useTranslations("invites");
  const respond = useRespondInvite();
  const failure =
    respond.error instanceof InboxActionError
      ? tInvites(`errors.${respond.error.code}`)
      : respond.error
        ? tInvites("errors.unknown")
        : null;
  return (
    <GlowCard interactive={false} className="flex h-full flex-col gap-3 p-4" data-testid="waiting-invite">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-violet/15 text-violet">
          <MailPlusIcon aria-hidden className="size-4" />
        </span>
        <p className="font-medium text-ink">{t("title", { who })}</p>
      </div>
      {failure && <FormAlert>{failure}</FormAlert>}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={respond.isPending} onClick={() => respond.mutate({ inviteId, accept: true })}>
          {t("accept")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={respond.isPending}
          onClick={() => respond.mutate({ inviteId, accept: false })}
        >
          {t("decline")}
        </Button>
      </div>
      <Link href={INVITES_PATH} className="text-sm text-violet hover:underline">
        {t("open")}
      </Link>
    </GlowCard>
  );
}

function SurveyCard({
  bookingId,
  title,
  when,
  onOpen,
}: {
  bookingId: string;
  title: string;
  when: string;
  onOpen: () => void;
}) {
  const t = useTranslations("dashboard.waiting.survey");
  const settings = useFormatSettings();
  const locale = useLocale();
  const dismiss = useDismissSurvey();
  const noShow = useSetNoShow();
  return (
    <GlowCard interactive={false} className="flex h-full flex-col gap-3 p-4" data-testid="waiting-survey">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-teal/15 text-teal">
          <ClipboardListIcon aria-hidden className="size-4" />
        </span>
        <div className="flex min-w-0 flex-col">
          <p className="font-medium text-ink">{title}</p>
          <p className="text-sm text-ink-muted">{formatSlotMoment(new Date(when), settings, locale)}</p>
        </div>
      </div>
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
        <Button size="sm" variant="ghost" disabled={dismiss.isPending} onClick={() => dismiss.mutate(bookingId)}>
          {t("skip")}
        </Button>
      </div>
    </GlowCard>
  );
}
