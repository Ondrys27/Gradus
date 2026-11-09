import { createHash } from "node:crypto";
import type { Browser, BrowserContext, Page } from "@playwright/test";
import { admin, e2eEmail, signIn } from "./support/accounts";
import { requiredEnv } from "./support/env";
import { expect, test, watchConsole } from "./support/fixtures";
import { exact } from "./support/i18n";
import { dismissCelebrationsAutomatically, openApp } from "./support/ui";

/**
 * 24.4 in two browsers: a guest books the host's Consultation (approved by
 * hand) on the public page; the host sees it on the dashboard and in the
 * calendar and confirms it; the guest gets the confirmation with reminders
 * scheduled in the mock Resend, moves the meeting through the link of the
 * e-mail, and the reminders are scheduled again. Two more guests click the
 * same time: the second one hears it is no longer free.
 */

const L = "cs" as const;

type Mail = {
  subject: string;
  text: string;
  scheduledAt?: string;
  cancelled?: boolean;
  attachments?: string[];
};

/** The mail the mock Resend kept for a test address (GET /api/e2e/outbox). */
async function outbox(page: Page, to: string): Promise<Mail[]> {
  const secret = requiredEnv("SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY");
  const key = createHash("sha256").update(`gradus-e2e-outbox:${secret}`).digest("hex");
  const response = await page.request.get(`/api/e2e/outbox?to=${encodeURIComponent(to)}`, {
    headers: { "x-gradus-e2e-key": key },
  });
  expect(response.status()).toBe(200);
  return ((await response.json()) as { mail: Mail[] }).mail;
}

/** A guest's own browser: Prague, Czech, its own visitor for the hourly limits. */
async function guestContext(browser: Browser, visitor: string): Promise<BrowserContext> {
  return browser.newContext({
    locale: "cs-CZ",
    timezoneId: "Europe/Prague",
    extraHTTPHeaders: { "x-gradus-e2e-visitor": visitor },
  });
}

async function openType(page: Page, path: string) {
  await page.goto(path);
  await expect(page.getByTestId("booking-day").first()).toBeVisible({ timeout: 30_000 });
}

/** The first free day and its n-th free time; returns the time's start. */
async function pickTime(page: Page, index = 0, day = 0): Promise<string> {
  await page.getByTestId("booking-day").nth(day).click();
  const time = page.getByTestId("booking-time").nth(index);
  await expect(time).toBeVisible();
  const start = (await time.getAttribute("data-start")) ?? "";
  await time.click();
  return start;
}

test("56 · scheduler: a guest books, the host approves, the guest moves it; one time never twice", async ({
  page,
  browser,
  accounts,
  consoleErrors,
}) => {
  test.setTimeout(240_000);
  const db = admin();
  const host = await accounts.create({ label: "bookinghost", mode: "tool" });
  await signIn(page, host);
  await dismissCelebrationsAutomatically(page, L);

  // The first open makes the profile and the three presets; the guide sets the handle.
  await openApp(page, "/app/planovac");
  const guide = page.getByTestId("scheduler-setup");
  await expect(guide).toBeVisible({ timeout: 20_000 });
  const handle = `e2e-${Date.now().toString(36)}`;
  await guide.getByLabel(exact(L, "scheduler.setup.handle")).fill(handle);
  await guide.getByLabel(exact(L, "scheduler.setup.video")).fill("https://meet.jit.si/gradus-e2e");
  await guide.getByRole("button", { name: exact(L, "scheduler.setup.done") }).click();
  await expect(guide).toHaveCount(0);

  // Consultation is approved by hand, can be booked from now on, every 15 minutes.
  const { data: type, error: typeError } = await db
    .from("event_types")
    .update({ requires_approval: true, min_notice_hours: 0, slot_step_min: 15 })
    .eq("user_id", host.id)
    .eq("duration_min", 30)
    .select("id, slug")
    .single();
  if (typeError) throw typeError;
  // Every day 0:00–24:00, so the test finds free times whenever it runs.
  const { data: profile } = await db.from("scheduler_profiles").select("id").eq("user_id", host.id).single();
  await db.from("availability_rules").delete().eq("profile_id", profile!.id);
  await db.from("availability_rules").insert(
    [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
      profile_id: profile!.id,
      user_id: host.id,
      space_id: host.id,
      weekday,
      start_time: "00:00",
      end_time: "24:00",
    })),
  );
  const typePath = `/s/${handle}/${type.slug}`;

  // --- The guest books ------------------------------------------------------
  const guestEmail = e2eEmail("guest");
  const guestBrowser = await guestContext(browser, "guest-a");
  watchConsole(guestBrowser, consoleErrors);
  const guest = await guestBrowser.newPage();
  await openType(guest, typePath);
  // Tomorrow or later: the 24-hour reminder then fits as well as the hour one.
  await pickTime(guest, 0, 1);
  await expect(guest.getByTestId("booking-countdown")).toBeVisible();
  await guest.getByLabel(/^Jméno/).fill("Jana Hostová");
  await guest.getByLabel(/^E-mail/).fill(guestEmail);
  await guest.getByLabel(/^Telefon/).fill("777123456");
  await guest.getByTestId("booking-submit").click();
  const success = guest.getByTestId("booking-success");
  await expect(success).toBeVisible({ timeout: 20_000 });
  await expect(success).toHaveAttribute("data-status", "pending");
  const manageHref = (await guest.getByTestId("booking-manage-link").getAttribute("href")) ?? "";
  expect(manageHref).toMatch(/\/s\/r\/[A-Za-z0-9_-]{43}$/);

  // The waiting e-mail with the invite, no reminder yet (it is not confirmed).
  await expect.poll(async () => (await outbox(guest, guestEmail)).length, { timeout: 15_000 }).toBeGreaterThan(0);
  const waiting = await outbox(guest, guestEmail);
  expect(waiting[0]!.attachments).toEqual(["invite.ics"]);
  expect(waiting.some((mail) => mail.scheduledAt)).toBe(false);

  // --- The host sees it on the dashboard and in the calendar, and confirms --
  const { data: booked } = await db
    .from("bookings")
    .select("id, status, calendar_event_id, contact_id")
    .eq("host_user_id", host.id)
    .eq("status", "pending")
    .single();
  expect(booked?.calendar_event_id).toBeTruthy();
  expect(booked?.contact_id).toBeTruthy();
  const { data: event } = await db
    .from("calendar_events")
    .select("source, kind")
    .eq("id", booked!.calendar_event_id!)
    .single();
  expect(event).toEqual({ source: "booking", kind: "meeting" });

  await openApp(page, "/app");
  const card = page.getByTestId("waiting-booking");
  await expect(card).toBeVisible({ timeout: 20_000 });
  await expect(card).toContainText("Jana Hostová");
  await card.getByTestId("booking-approve").click();
  await expect(card).toHaveCount(0, { timeout: 20_000 });

  // The confirmation with the call's link, and reminders scheduled for the guest.
  await expect
    .poll(async () => (await outbox(guest, guestEmail)).filter((mail) => mail.scheduledAt).length, {
      timeout: 15_000,
    })
    .toBeGreaterThan(0);
  const confirmed = await outbox(guest, guestEmail);
  expect(confirmed.some((mail) => mail.text.includes("https://meet.jit.si/gradus-e2e"))).toBe(true);
  const firstReminders = confirmed.filter((mail) => mail.scheduledAt && !mail.cancelled);
  expect(firstReminders.length).toBeGreaterThan(0);

  // --- The guest moves it through the link of the e-mail --------------------
  await guest.goto(manageHref);
  await expect(guest.getByTestId("booking-manage")).toHaveAttribute("data-status", "confirmed");
  await guest.getByTestId("booking-manage-reschedule").click();
  await expect(guest.getByTestId("booking-day").first()).toBeVisible({ timeout: 20_000 });
  await guest.getByTestId("booking-day").nth(2).click();
  await guest.getByTestId("booking-time").nth(4).click();
  await guest.getByTestId("booking-manage-confirm-move").click();
  await expect(guest.getByTestId("booking-rescheduled")).toBeVisible({ timeout: 20_000 });

  // The old reminders are cancelled and new ones scheduled for the new time.
  await expect
    .poll(
      async () => {
        const mail = await outbox(guest, guestEmail);
        return {
          cancelled: mail.filter((item) => item.scheduledAt && item.cancelled).length,
          live: mail.filter((item) => item.scheduledAt && !item.cancelled).length,
        };
      },
      { timeout: 15_000 },
    )
    .toEqual({ cancelled: firstReminders.length, live: expect.any(Number) });
  const moved = await outbox(guest, guestEmail);
  expect(moved.filter((item) => item.scheduledAt && !item.cancelled).length).toBeGreaterThan(0);
  const { data: after } = await db
    .from("bookings")
    .select("status, reschedule_count")
    .eq("id", booked!.id)
    .single();
  expect(after).toEqual({ status: "confirmed", reschedule_count: 1 });

  // --- Two guests, one time --------------------------------------------------
  const firstContext = await guestContext(browser, "guest-b");
  const secondContext = await guestContext(browser, "guest-c");
  const first = await firstContext.newPage();
  const second = await secondContext.newPage();
  await openType(first, typePath);
  await openType(second, typePath);
  const taken = await pickTime(first, 0, 3);
  await expect(first.getByTestId("booking-countdown")).toBeVisible();
  await second.getByTestId("booking-day").nth(3).click();
  await second.locator(`[data-testid="booking-time"][data-start="${taken}"]`).click();
  await expect(second.getByTestId("booking-notice-taken")).toBeVisible({ timeout: 15_000 });
  await expect(second.getByTestId("booking-countdown")).toHaveCount(0);

  await Promise.all([guestBrowser.close(), firstContext.close(), secondContext.close()]);
});
