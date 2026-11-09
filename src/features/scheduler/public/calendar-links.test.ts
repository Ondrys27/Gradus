import { describe, expect, it } from "vitest";
import { googleCalendarUrl, icsDataUrl, outlookCalendarUrl } from "./calendar-links";

const event = {
  title: "Konzultace s Ondřej Novák",
  start: "2026-11-10T13:00:00.000Z",
  end: "2026-11-10T13:30:00.000Z",
  location: "https://meet.jit.si/gradus",
};

describe("calendar links", () => {
  it("fills Google's template with the UTC range and the place", () => {
    const url = new URL(googleCalendarUrl(event));
    expect(url.hostname).toBe("calendar.google.com");
    expect(url.searchParams.get("action")).toBe("TEMPLATE");
    expect(url.searchParams.get("text")).toBe(event.title);
    expect(url.searchParams.get("dates")).toBe("20261110T130000Z/20261110T133000Z");
    expect(url.searchParams.get("location")).toBe(event.location);
    expect(url.searchParams.has("details")).toBe(false);
  });

  it("fills Outlook's compose link with ISO instants", () => {
    const url = new URL(outlookCalendarUrl(event));
    expect(url.hostname).toBe("outlook.live.com");
    expect(url.searchParams.get("rru")).toBe("addevent");
    expect(url.searchParams.get("startdt")).toBe("2026-11-10T13:00:00.000Z");
    expect(url.searchParams.get("enddt")).toBe("2026-11-10T13:30:00.000Z");
    expect(url.searchParams.get("subject")).toBe(event.title);
  });

  it("writes the .ics with the e-mail's UID, tentative while pending", () => {
    const now = new Date("2026-11-09T10:00:00Z");
    const confirmed = decodeURIComponent(
      icsDataUrl({ ...event, uid: "booking-abc", pending: false, now }).replace("data:text/calendar;charset=utf-8,", ""),
    );
    expect(confirmed).toContain("UID:booking-abc");
    expect(confirmed).toContain("DTSTART:20261110T130000Z");
    expect(confirmed).toContain("STATUS:CONFIRMED");
    expect(confirmed).toContain("URL:https://meet.jit.si/gradus");
    const pending = decodeURIComponent(
      icsDataUrl({ ...event, uid: "booking-abc", pending: true, now, product: "Booking" }).replace(
        "data:text/calendar;charset=utf-8,",
        "",
      ),
    );
    expect(pending).toContain("STATUS:TENTATIVE");
    expect(pending).toContain("PRODID:-//Booking//Booking//EN");
  });
});
