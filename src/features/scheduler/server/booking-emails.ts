import "server-only";
import { serverTranslator } from "@/i18n/server-translator";
import { APP_NAME } from "@/lib/constants";
import { escapeHtml } from "@/lib/email/resend";
import { formatLongMoment, formatNumber, type FormatSettings } from "@/lib/format";
import { formatPhone } from "@/lib/phone";
import type { LocationKind } from "../types";

/**
 * The e-mails of a booking (24.4), texts from `email.booking.*`: to the guest
 * in the language they booked in and their time zone, to the host in their
 * own language and formats. Plain text and a simple HTML twin, like every
 * other e-mail of the app. The guest's e-mails never say where the host keeps
 * their calendar; "Made with Gradus" only without the no-branding add-on.
 */

export type BookingMail = { subject: string; text: string; html: string };

export type GuestMailKind =
  | "confirmed"
  | "pending"
  | "approved"
  | "declined"
  | "cancelledByHost"
  | "cancelledByGuest"
  | "rescheduled"
  | "reminder";

export type HostMailKind =
  | "booked"
  | "approval"
  | "cancelledByGuest"
  | "rescheduledByGuest"
  | "reminder";

export type MailMeeting = {
  typeName: string;
  durationMin: number;
  startsAt: string;
  locationKind: LocationKind;
  locationText: string | null;
  /** Only in an e-mail of a confirmed meeting. */
  videoLink: string | null;
  hostName: string;
  guestName: string;
  guestEmail: string;
  guestPhone: string | null;
  guestCompany: string | null;
  confirmationNote: string | null;
};

const BUTTON =
  "display:inline-block;background:#7C5CFF;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:10px;font-weight:600;margin:0 8px 8px 0";
const BUTTON_QUIET =
  "display:inline-block;background:#ffffff;color:#1a1a2e;text-decoration:none;padding:9px 17px;border-radius:10px;font-weight:600;border:1px solid #d0d0e0;margin:0 8px 8px 0";

type Button = { label: string; url: string; quiet?: boolean };

function render(parts: {
  paragraphs: readonly string[];
  details: readonly string[];
  buttons: readonly Button[];
  footer: string | null;
}): { text: string; html: string } {
  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#1a1a2e;max-width:560px">
${parts.paragraphs
  .map((line) => `<p style="margin:0 0 12px;font-size:15px;line-height:1.5">${escapeHtml(line)}</p>`)
  .join("\n")}
${
  parts.details.length
    ? `<table role="presentation" style="margin:8px 0 16px;font-size:14px;line-height:1.5;border-collapse:collapse">${parts.details
        .map(
          (line) =>
            `<tr><td style="padding:2px 0;white-space:pre-line">${escapeHtml(line)}</td></tr>`,
        )
        .join("")}</table>`
    : ""
}
${
  parts.buttons.length
    ? `<p style="margin:20px 0 8px">${parts.buttons
        .map(
          (button) =>
            `<a href="${escapeHtml(button.url)}" style="${button.quiet ? BUTTON_QUIET : BUTTON}">${escapeHtml(button.label)}</a>`,
        )
        .join("")}</p>`
    : ""
}
${parts.footer ? `<p style="margin:24px 0 0;font-size:12px;color:#7a7a90">${escapeHtml(parts.footer)}</p>` : ""}
</div>`;
  const text = [
    ...parts.paragraphs,
    ...(parts.details.length ? [parts.details.join("\n")] : []),
    ...parts.buttons.map((button) => `${button.label}: ${button.url}`),
    ...(parts.footer ? [parts.footer] : []),
  ].join("\n\n");
  return { text, html };
}

type T = ReturnType<typeof serverTranslator>;

function when(meeting: MailMeeting, settings: FormatSettings, locale: string): string {
  return formatLongMoment(new Date(meeting.startsAt), settings, locale);
}

/** Where the meeting is, as the reader needs it. */
function placeLine(
  t: T,
  meeting: MailMeeting,
  forGuest: boolean,
  country: string | null,
): string | null {
  switch (meeting.locationKind) {
    case "video":
      return meeting.videoLink
        ? t("email.booking.place.video", { link: meeting.videoLink })
        : t("email.booking.place.videoLater");
    case "phone":
      return forGuest
        ? t("email.booking.place.phoneGuest", { host: meeting.hostName })
        : meeting.guestPhone
          ? t("email.booking.place.phoneHost", { phone: formatPhone(meeting.guestPhone, country) })
          : t("email.booking.place.phoneNone");
    default:
      return meeting.locationText ? t("email.booking.place.at", { place: meeting.locationText }) : null;
  }
}

function details(
  t: T,
  meeting: MailMeeting,
  settings: FormatSettings,
  locale: string,
  forGuest: boolean,
  country: string | null,
): string[] {
  const lines = [
    t("email.booking.when", { when: when(meeting, settings, locale), zone: settings.timeZone }),
    t("email.booking.duration", {
      minutes: meeting.durationMin,
      formatted: formatNumber(meeting.durationMin, {}, settings),
    }),
  ];
  const place = placeLine(t, meeting, forGuest, country);
  if (place) lines.push(place);
  if (forGuest) lines.push(t("email.booking.with", { host: meeting.hostName }));
  return lines;
}

export function guestBookingEmail(input: {
  kind: GuestMailKind;
  meeting: MailMeeting;
  locale: string;
  settings: FormatSettings;
  /** The guest's page for moving or cancelling (live bookings only). */
  manageUrl: string | null;
  /** The type's page to book again (a declined or cancelled booking). */
  bookAgainUrl: string | null;
  reason?: string | null;
  /** A declined booking: the time the host offers instead, ISO. */
  alternative?: string | null;
  previousStartsAt?: string | null;
  reminderMinutes?: number;
  brandingHidden: boolean;
}): BookingMail {
  const t = serverTranslator(input.locale);
  const { meeting, settings, locale } = input;
  const values = {
    type: meeting.typeName,
    host: meeting.hostName,
    when: when(meeting, settings, locale),
  };
  const paragraphs: string[] = [t(`email.booking.guest.${input.kind}.intro`, values)];
  if (input.kind === "reminder" && input.reminderMinutes) {
    paragraphs[0] = t("email.booking.guest.reminder.intro", {
      ...values,
      minutes: input.reminderMinutes,
    });
  }
  if (input.previousStartsAt) {
    paragraphs.push(
      t("email.booking.previous", {
        when: formatLongMoment(new Date(input.previousStartsAt), settings, locale),
      }),
    );
  }
  if (input.reason) paragraphs.push(t("email.booking.reason", { reason: input.reason }));
  if (input.alternative) {
    paragraphs.push(
      t("email.booking.alternative", {
        when: formatLongMoment(new Date(input.alternative), settings, locale),
      }),
    );
  }
  const live = ["confirmed", "pending", "approved", "rescheduled", "reminder"].includes(input.kind);
  if ((input.kind === "confirmed" || input.kind === "approved") && meeting.confirmationNote) {
    paragraphs.push(meeting.confirmationNote);
  }
  if (input.kind === "pending") paragraphs.push(t("email.booking.guest.pending.next"));

  const buttons: Button[] = [];
  if (live && input.manageUrl) {
    buttons.push({ label: t("email.booking.reschedule"), url: input.manageUrl });
    buttons.push({ label: t("email.booking.cancel"), url: `${input.manageUrl}?cancel=1`, quiet: true });
  } else if (!live && input.bookAgainUrl) {
    buttons.push({ label: t("email.booking.bookAgain"), url: input.bookAgainUrl });
  }
  const body = render({
    paragraphs,
    details: details(t, meeting, settings, locale, true, null),
    buttons,
    footer: input.brandingHidden ? null : t("email.booking.madeWith", { appName: APP_NAME }),
  });
  return {
    subject: t(`email.booking.guest.${input.kind}.subject`, {
      ...values,
      when: formatLongMoment(new Date(meeting.startsAt), settings, locale),
    }),
    ...body,
  };
}

export function hostBookingEmail(input: {
  kind: HostMailKind;
  meeting: MailMeeting;
  locale: string;
  settings: FormatSettings;
  country: string | null;
  /** The booking in the app (approve, decline, move, cancel). */
  appUrl: string;
  answers: readonly string[];
  reason?: string | null;
  previousStartsAt?: string | null;
  reminderMinutes?: number;
}): BookingMail {
  const t = serverTranslator(input.locale);
  const { meeting, settings, locale } = input;
  const values = {
    type: meeting.typeName,
    guest: meeting.guestName,
    when: when(meeting, settings, locale),
    minutes: input.reminderMinutes ?? 0,
  };
  const paragraphs = [t(`email.booking.host.${input.kind}.intro`, values)];
  if (input.previousStartsAt) {
    paragraphs.push(
      t("email.booking.previous", {
        when: formatLongMoment(new Date(input.previousStartsAt), settings, locale),
      }),
    );
  }
  if (input.reason) paragraphs.push(t("email.booking.reason", { reason: input.reason }));
  const guestLines = [
    t("email.booking.guestEmail", { email: meeting.guestEmail }),
    ...(meeting.guestPhone
      ? [t("email.booking.guestPhone", { phone: formatPhone(meeting.guestPhone, input.country) })]
      : []),
    ...(meeting.guestCompany ? [t("email.booking.guestCompany", { company: meeting.guestCompany })] : []),
  ];
  const body = render({
    paragraphs,
    details: [
      ...details(t, meeting, settings, locale, false, input.country),
      ...guestLines,
      ...input.answers,
    ],
    buttons: [
      {
        label:
          input.kind === "approval" ? t("email.booking.host.approval.button") : t("email.booking.openApp"),
        url: input.appUrl,
      },
    ],
    footer: null,
  });
  return {
    subject: t(`email.booking.host.${input.kind}.subject`, values),
    ...body,
  };
}
