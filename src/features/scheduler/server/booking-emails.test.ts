// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { guestBookingEmail, hostBookingEmail } = await import("./booking-emails");
const { guestFormatSettings } = await import("../booking/guest-format");

const MEETING = {
  typeName: "Konzultace",
  durationMin: 30,
  startsAt: "2026-11-17T13:00:00Z",
  locationKind: "video" as const,
  locationText: null,
  videoLink: "https://meet.jit.si/ondrej",
  hostName: "Ondřej Otava",
  guestName: "Jan <b>Novák</b>",
  guestEmail: "jan@example.com",
  guestPhone: "+420777123456",
  guestCompany: null,
  confirmationNote: "Těším se.",
};

describe("the guest's e-mails", () => {
  it("a confirmation in the guest's language and zone, with the video link and the links to move or cancel", () => {
    const mail = guestBookingEmail({
      kind: "confirmed",
      meeting: MEETING,
      locale: "cs",
      settings: guestFormatSettings("cs", "Europe/Prague"),
      manageUrl: "https://gradus.test/s/r/token",
      bookAgainUrl: null,
      brandingHidden: false,
    });
    expect(mail.subject).toContain("Konzultace");
    expect(mail.subject).toContain("14:00");
    expect(mail.text).toContain("https://meet.jit.si/ondrej");
    expect(mail.text).toContain("https://gradus.test/s/r/token?cancel=1");
    expect(mail.text).toContain("Těším se.");
    expect(mail.text).toContain("Europe/Prague");
    expect(mail.text).toMatch(/Gradus/);
  });

  it("without branding no Gradus; a pending one has no video link yet", () => {
    const mail = guestBookingEmail({
      kind: "pending",
      meeting: { ...MEETING, videoLink: null },
      locale: "en",
      settings: guestFormatSettings("en", "America/New_York"),
      manageUrl: "https://gradus.test/s/r/token",
      bookAgainUrl: null,
      brandingHidden: true,
    });
    expect(mail.text).not.toMatch(/Gradus/);
    expect(mail.text).not.toContain("meet.jit.si");
    expect(mail.text).toContain("08:00");
    expect(mail.subject).toMatch(/^Waiting for confirmation/);
  });

  it("a declined one offers to book again, never the old links", () => {
    const mail = guestBookingEmail({
      kind: "declined",
      meeting: MEETING,
      locale: "cs",
      settings: guestFormatSettings("cs", "Europe/Prague"),
      manageUrl: null,
      bookAgainUrl: "https://gradus.test/s/ondrej/konzultace",
      reason: "Jsem na cestách",
      alternative: "2026-11-18T09:00:00Z",
      brandingHidden: false,
    });
    expect(mail.text).toContain("Jsem na cestách");
    expect(mail.text).toContain("https://gradus.test/s/ondrej/konzultace");
    expect(mail.text).toContain("10:00");
    expect(mail.text).not.toContain("/s/r/");
  });
});

describe("the host's e-mails", () => {
  it("the HTML never carries the guest's markup", () => {
    const mail = hostBookingEmail({
      kind: "approval",
      meeting: MEETING,
      locale: "cs",
      settings: guestFormatSettings("cs", "Europe/Prague"),
      country: "CZ",
      appUrl: "https://gradus.test/app/planovac?tab=bookings&booking=1",
      answers: ["Co chcete probrat?: <script>"],
    });
    expect(mail.html).not.toContain("<b>Novák</b>");
    expect(mail.html).not.toContain("<script>");
    expect(mail.text).toContain("https://gradus.test/app/planovac?tab=bookings&booking=1");
    expect(mail.subject).toContain("Jan");
  });
});
