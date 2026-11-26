import { createHash } from "node:crypto";
import type { Page } from "@playwright/test";
import { admin, e2eEmail, signIn, skipCompanyTutorial } from "./support/accounts";
import { requiredEnv } from "./support/env";
import { expect, test, watchConsole } from "./support/fixtures";
import { exact, text } from "./support/i18n";
import { dismissCelebrationsAutomatically, openApp } from "./support/ui";

const L = "cs" as const;
const t = (key: string, values?: Record<string, string | number>) => text(L, key, values);

test.use({ reducedMotion: "reduce", viewport: { width: 1440, height: 900 } });

type Mail = { subject: string; text: string; attachments?: string[] };

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

/** Tomorrow's date and a wall-clock hour of it in Prague, as an instant (ms). */
function tomorrow(): { day: string; at: (hour: number) => number } {
  const day = new Date(Date.now() + 86_400_000).toLocaleDateString("en-CA", {
    timeZone: "Europe/Prague",
  });
  const probe = new Date(`${day}T12:00:00Z`);
  const offset =
    Number(
      probe.toLocaleString("en-US", {
        timeZone: "Europe/Prague",
        hour: "2-digit",
        hourCycle: "h23",
      }),
    ) - 12;
  return {
    day,
    at: (hour) => Date.parse(`${day}T${String(hour).padStart(2, "0")}:00:00Z`) - offset * 3_600_000,
  };
}

/**
 * 30.4 in two browsers: the owner sends meetings from calls to themselves
 * (Settings → Work → Cold Calling); the caller moves a contact into
 * "Meeting scheduled", sees the owner's Free / Full by the owner's
 * scheduler (a busy time says "full" with "Book anyway"), books a free one
 * with the confirmation e-mail on. The client gets the e-mail with the link
 * to move or cancel, the owner has the meeting in their calendar and hears
 * who booked it in the bell.
 */
test("75 · cold calling: the caller books the owner's free time; full shows Full and Book anyway", async ({
  page,
  browser,
  accounts,
  consoleErrors,
}) => {
  test.setTimeout(180_000);
  const db = admin();
  const owner = await accounts.create({ label: "cc-meet-owner" });
  const caller = await accounts.create({ label: "cc-meet-caller" });

  // The caller works for the owner in Cold Calling, without "schedule meetings for others".
  const { data: worker, error: workerError } = await db
    .from("workers")
    .insert({
      owner_id: owner.id,
      user_id: caller.id,
      name: "E2E Jana",
      email: caller.email,
      status: "active",
    })
    .select("id")
    .single();
  if (workerError) throw workerError;
  const grants = await db.from("worker_permission_grants").insert(
    [
      ["contacts", "view"],
      ["cold_calling", "view"],
      ["cold_calling", "call"],
    ].map(([section, action]) => ({
      owner_id: owner.id,
      worker_id: worker.id,
      section,
      action,
      allowed: true,
    })),
  );
  if (grants.error) throw grants.error;
  await skipCompanyTutorial(caller.id, owner.id);

  // The owner's scheduler: every day 0–24, a 30-minute meeting bookable from now on.
  const { data: profile, error: profileError } = await db
    .from("scheduler_profiles")
    .insert({
      user_id: owner.id,
      space_id: owner.id,
      handle: `e2e-${Date.now().toString(36)}`,
      display_name: "E2E Majitel",
      time_zone: "Europe/Prague",
      setup_done_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (profileError) throw profileError;
  const rules = await db.from("availability_rules").insert(
    [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
      user_id: owner.id,
      space_id: owner.id,
      profile_id: profile.id,
      weekday,
      start_time: "00:00",
      end_time: "24:00",
    })),
  );
  if (rules.error) throw rules.error;
  const type = await db.from("event_types").insert({
    user_id: owner.id,
    space_id: owner.id,
    profile_id: profile.id,
    name: "E2E Schůzka",
    slug: "schuzka",
    duration_min: 30,
    location_kind: "phone",
    min_notice_hours: 0,
    slot_step_min: 30,
    active: true,
  });
  if (type.error) throw type.error;

  // The owner is busy tomorrow 10–11 (their Gradus calendar counts by default).
  const day = tomorrow();
  const busyStart = day.at(10);
  const freeStart = day.at(14);
  const busy = await db.from("calendar_events").insert({
    user_id: owner.id,
    actor_id: owner.id,
    title: "E2E Lékař",
    kind: "meeting",
    starts_at: new Date(busyStart).toISOString(),
    ends_at: new Date(day.at(11)).toISOString(),
  });
  if (busy.error) throw busy.error;

  const clientEmail = e2eEmail("cc-meet-client");
  const company = "E2E Pekárna Novák";
  const { data: contact, error: contactError } = await db
    .from("contacts")
    .insert({
      user_id: owner.id,
      company_name: company,
      first_name: "Petr",
      last_name: "Novák",
      email: clientEmail,
    })
    .select("id")
    .single();
  if (contactError) throw contactError;
  const { data: meetingTable } = await db
    .from("contact_tables")
    .select("id, name")
    .eq("user_id", owner.id)
    .eq("system_key", "meeting_scheduled")
    .single();

  // --- The owner: meetings from calls go to me ------------------------------
  await signIn(page, owner);
  await dismissCelebrationsAutomatically(page, L);
  await openApp(page, "/app/nastaveni/prace");
  await page.getByTestId("settings-cold-calling-host").click();
  await page
    .getByRole("option", { name: t("settings.coldCalling.meetings.hostModes.owner"), exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (
          await db
            .from("cold_calling_meeting_settings")
            .select("host_mode")
            .eq("space_id", owner.id)
            .maybeSingle()
        ).data?.host_mode ?? null,
      { message: "the owner's choice is saved" },
    )
    .toBe("owner");

  // --- The caller moves the contact into "Meeting scheduled" ---------------
  const callerContext = await browser.newContext({ locale: "cs-CZ", timezoneId: "Europe/Prague" });
  watchConsole(callerContext, consoleErrors);
  const callerPage = await callerContext.newPage();
  await signIn(callerPage, caller);
  await dismissCelebrationsAutomatically(callerPage, L);
  await openApp(callerPage, "/app/cold-calling");
  await callerPage
    .getByRole("list")
    .filter({ hasText: company })
    .getByRole("button", { name: new RegExp(company) })
    .click();
  const panel = callerPage.getByRole("dialog", { name: t("coldCalling.panel.title") });
  await panel.getByRole("button", { name: exact(L, "coldCalling.panel.move") }).click();
  const move = callerPage.getByRole("dialog", { name: t("contacts.move.title") });
  await move.getByRole("button", { name: meetingTable!.name }).click();

  // The owner is the host, fixed; the caller sees only Free / Full.
  const form = move.getByTestId("meeting-booking");
  await expect(form).toBeVisible({ timeout: 20_000 });
  await expect(form.getByTestId("meeting-host")).toContainText("E2E");
  await expect(form.getByTestId("meeting-host")).not.toContainText("Jana");
  const picker = form.getByTestId("slot-picker");
  await expect(picker).toBeVisible({ timeout: 20_000 });
  const tomorrowDay = picker.locator(`[data-day="${day.day}"]`);
  if (!(await tomorrowDay.count()))
    await picker.getByRole("button", { name: t("booking.calendar.nextWeek") }).click();
  await expect(tomorrowDay).toBeVisible();
  await expect(picker.getByText("E2E Lékař")).toHaveCount(0);

  // A full time: "That time is already full" and, in the app, "Book anyway".
  const full = picker.locator(`[data-testid="slot-busy"][data-start="${busyStart}"]`);
  await expect(full).toBeVisible();
  await expect(full).toContainText(t("booking.calendar.full"));
  await full.click();
  await expect(form.getByTestId("slot-busy-notice")).toBeVisible();
  await expect(form.getByTestId("slot-busy-notice")).toHaveAttribute("data-state", "busy");
  await expect(form.getByTestId("slot-force")).toBeVisible();
  await expect(form.getByTestId("slot-force")).toHaveText(t("booking.calendar.bookAnyway"));

  // A free time, held while the dialog is open; the confirmation e-mail is on.
  await tomorrowDay.click();
  await picker.locator(`[data-testid="booking-time"][data-start="${freeStart}"]`).click();
  await expect(form.getByTestId("meeting-held")).toHaveAttribute("data-start", String(freeStart), {
    timeout: 15_000,
  });
  const held = await db
    .from("bookings")
    .select("status, source")
    .eq("host_user_id", owner.id)
    .eq("status", "held");
  expect(held.data).toEqual([{ status: "held", source: "cold_calling" }]);
  await expect(form.getByTestId("meeting-email")).toBeChecked();
  await form.getByTestId("meeting-submit").click();

  // The offer of a deal follows the move; the caller has no pipeline, so the dialog closes.
  await expect(move).toBeHidden({ timeout: 20_000 });

  // --- What happened ----------------------------------------------------------
  let bookingId = "";
  await expect
    .poll(
      async () => {
        const { data } = await db
          .from("bookings")
          .select(
            "id, status, source, created_by, host_user_id, contact_id, starts_at, guest_email, calendar_event_id",
          )
          .eq("space_id", owner.id)
          .eq("status", "confirmed");
        if (data?.length === 1) bookingId = data[0]!.id;
        return data?.map((row) => ({
          source: row.source,
          created_by: row.created_by,
          host: row.host_user_id,
          contact: row.contact_id,
          start: Date.parse(row.starts_at),
          email: row.guest_email,
          event: Boolean(row.calendar_event_id),
        }));
      },
      { message: "the booking is made", timeout: 20_000 },
    )
    .toEqual([
      {
        source: "cold_calling",
        created_by: caller.id,
        host: owner.id,
        contact: contact.id,
        start: freeStart,
        email: clientEmail,
        event: true,
      },
    ]);
  // The owner's meeting in their calendar; the contact moved by the caller.
  const { data: events } = await db
    .from("calendar_events")
    .select("actor_id, source, contact_id, starts_at")
    .eq("user_id", owner.id)
    .eq("source", "booking");
  expect(events).toHaveLength(1);
  expect(events![0]).toMatchObject({ actor_id: owner.id, contact_id: contact.id });
  expect(Date.parse(events![0]!.starts_at)).toBe(freeStart);
  const { data: entry } = await db
    .from("contact_table_entries")
    .select("table_id")
    .eq("user_id", owner.id)
    .eq("contact_id", contact.id)
    .single();
  expect(entry?.table_id).toBe(meetingTable!.id);
  const { data: moves } = await db
    .from("contact_table_moves")
    .select("actor_id, source")
    .eq("user_id", owner.id)
    .eq("contact_id", contact.id)
    .eq("to_table_id", meetingTable!.id);
  expect(moves).toEqual([{ actor_id: caller.id, source: null }]);

  // The client's confirmation with the invite and the link to move or cancel.
  await expect
    .poll(async () => (await outbox(page, clientEmail)).length, { timeout: 15_000 })
    .toBeGreaterThan(0);
  const mails = await outbox(page, clientEmail);
  expect(mails.some((mail) => /\/s\/r\//.test(mail.text))).toBe(true);
  expect(mails.some((mail) => (mail.attachments ?? []).length > 0)).toBe(true);

  // The owner hears who booked it.
  await expect
    .poll(
      async () =>
        (
          await db
            .from("account_notifications")
            .select("kind, actor_id")
            .eq("user_id", owner.id)
            .eq("booking_id", bookingId)
        ).data,
    )
    .toEqual([{ kind: "booking_scheduled", actor_id: caller.id }]);
  await page.reload();
  await page.getByTestId("inbox-bell").click();
  await expect(
    page.getByTestId("inbox-notification").filter({ hasText: "E2E Jana" }).first(),
  ).toContainText("Petr Novák");

  await callerContext.close();
});
