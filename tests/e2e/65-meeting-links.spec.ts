import { createHash } from "node:crypto";
import type { Browser, Page } from "@playwright/test";
import { admin, e2eEmail, signIn } from "./support/accounts";
import { requiredEnv } from "./support/env";
import { expect, test, watchConsole } from "./support/fixtures";
import { exact, text } from "./support/i18n";
import { dismissCelebrationsAutomatically, openApp } from "./support/ui";

/**
 * 27.5: the call's link of a booking. A guest books the host's Consultation;
 * the confirmation joins through the booking's page, which shows the host's
 * permanent link. The host gives this one meeting a link of its own in the
 * booking's detail: the guest hears of it by e-mail, and the old invitation
 * now leads to the new link. Then the type asks for a unique Jitsi room and
 * two more guests book: each gets a room of their own.
 */

const L = "cs" as const;
const PERMANENT = "https://meet.jit.si/gradus-e2e-permanent";
const OWN = "https://meet.example.com/e2e-own-room";
const ROOM = /^https:\/\/meet\.jit\.si\/gradus-[a-km-np-z2-9]{12}$/;

type Mail = { subject: string; text: string; scheduledAt?: string; cancelled?: boolean };

async function outbox(page: Page, to: string): Promise<Mail[]> {
  const secret = requiredEnv("SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY");
  const key = createHash("sha256").update(`gradus-e2e-outbox:${secret}`).digest("hex");
  const response = await page.request.get(`/api/e2e/outbox?to=${encodeURIComponent(to)}`, {
    headers: { "x-gradus-e2e-key": key },
  });
  expect(response.status()).toBe(200);
  return ((await response.json()) as { mail: Mail[] }).mail;
}

/** The address of "Join the meeting" in the guest's e-mails (the booking's page). */
async function joinUrlOf(page: Page, to: string): Promise<string> {
  const prefix = `${text(L, "email.booking.join")}: `;
  let url = "";
  await expect
    .poll(
      async () => {
        const line = (await outbox(page, to))
          .flatMap((mail) => mail.text.split("\n"))
          .find((item) => item.startsWith(prefix));
        url = line ? line.slice(prefix.length).trim() : "";
        return url;
      },
      { timeout: 20_000 },
    )
    .toMatch(/\/s\/r\/[A-Za-z0-9_-]{43}$/);
  return url;
}

/** A guest in their own browser books the type: the n-th free time of the d-th free day. */
async function book(
  browser: Browser,
  consoleErrors: string[],
  path: string,
  visitor: string,
  email: string,
  day: number,
  index: number,
): Promise<Page> {
  const context = await browser.newContext({
    locale: "cs-CZ",
    timezoneId: "Europe/Prague",
    extraHTTPHeaders: { "x-gradus-e2e-visitor": visitor },
  });
  watchConsole(context, consoleErrors);
  const guest = await context.newPage();
  await guest.goto(path);
  await expect(guest.getByTestId("booking-day").first()).toBeVisible({ timeout: 30_000 });
  await guest.getByTestId("booking-day").nth(day).click();
  await guest.getByTestId("booking-time").nth(index).click();
  await expect(guest.getByTestId("booking-countdown")).toBeVisible();
  await guest.getByLabel(/^Jméno/).fill("Jana Hostová");
  await guest.getByLabel(/^E-mail/).fill(email);
  await guest.getByLabel(/^Telefon/).fill("777123456");
  await guest.getByTestId("booking-submit").click();
  const success = guest.getByTestId("booking-success");
  await expect(success).toBeVisible({ timeout: 20_000 });
  await expect(success).toHaveAttribute("data-status", "confirmed");
  return guest;
}

test("65 · meeting links: an old invitation leads to the new link; every booking its own Jitsi room", async ({
  page,
  browser,
  accounts,
  consoleErrors,
}) => {
  test.setTimeout(240_000);
  const db = admin();
  const host = await accounts.create({ label: "meetinglinks", mode: "tool" });
  await signIn(page, host);
  await dismissCelebrationsAutomatically(page, L);

  await openApp(page, "/app/planovac");
  const guide = page.getByTestId("scheduler-setup");
  await expect(guide).toBeVisible({ timeout: 20_000 });
  const handle = `e2e-${Date.now().toString(36)}`;
  await guide.getByLabel(exact(L, "scheduler.setup.handle")).fill(handle);
  await guide.getByLabel(exact(L, "scheduler.setup.video")).fill(PERMANENT);
  await guide.getByRole("button", { name: exact(L, "scheduler.setup.done") }).click();
  await expect(guide).toHaveCount(0);

  // Consultation books straight away, from now on, every 15 minutes, all day every day.
  const { data: type, error: typeError } = await db
    .from("event_types")
    .update({ requires_approval: false, min_notice_hours: 0, slot_step_min: 15 })
    .eq("user_id", host.id)
    .eq("duration_min", 30)
    .select("id, slug")
    .single();
  if (typeError) throw typeError;
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

  // --- A guest books; the invitation leads to the booking's page --------------
  const guestEmail = e2eEmail("linkguest");
  // Tomorrow or later: more than an hour ahead, so a changed link is e-mailed.
  const guest = await book(browser, consoleErrors, typePath, "links-a", guestEmail, 1, 0);
  const invite = await joinUrlOf(guest, guestEmail);
  expect((await outbox(guest, guestEmail)).some((mail) => mail.text.includes(PERMANENT))).toBe(false);
  await guest.goto(invite);
  await expect(guest.getByTestId("booking-join")).toHaveAttribute("href", PERMANENT);

  // --- The host gives this meeting a link of its own ----------------------------
  const { data: booked } = await db
    .from("bookings")
    .select("id")
    .eq("host_user_id", host.id)
    .eq("status", "confirmed")
    .single();
  await openApp(page, `/app/planovac?tab=bookings&booking=${booked!.id}`);
  const detail = page.getByTestId("booking-detail");
  const link = detail.getByTestId("booking-link");
  await expect(link).toHaveAttribute("data-source", "profile", { timeout: 20_000 });
  await link.getByTestId("booking-link-edit").click();
  await link.getByLabel(exact(L, "scheduler.bookings.link.label")).fill(OWN);
  await link.getByTestId("booking-link-save").click();
  await expect(link.getByTestId("booking-link-saved")).toHaveText(
    text(L, "scheduler.bookings.link.savedEmailed"),
  );
  await expect(link).toHaveAttribute("data-source", "own");
  await expect(link.getByTestId("booking-link-url")).toHaveText(OWN);

  // --- The old invitation now leads to the new link ------------------------------
  await guest.goto(invite);
  await expect(guest.getByTestId("booking-join")).toHaveAttribute("href", OWN);
  const changed = text(L, "email.booking.guest.linkChanged.subject").split("{type}")[0]!;
  await expect
    .poll(async () => (await outbox(guest, guestEmail)).some((mail) => mail.subject.startsWith(changed)), {
      timeout: 15_000,
    })
    .toBe(true);

  // --- A unique Jitsi room for every booking ---------------------------------
  await openApp(page, "/app/planovac");
  await page.getByRole("button", { name: exact(L, "scheduler.presets.consultation") }).click();
  const editor = page.getByRole("dialog");
  await editor.getByTestId("type-video-jitsi").click();
  await expect(editor.getByTestId("type-video-missing")).toHaveCount(0);
  await editor.getByRole("button", { name: exact(L, "scheduler.editor.save") }).click();
  await expect(editor.getByText(text(L, "scheduler.editor.saved"))).toBeVisible();
  const { data: saved } = await db.from("event_types").select("video_source").eq("id", type.id).single();
  expect(saved?.video_source).toBe("jitsi");

  const rooms: string[] = [];
  for (const [visitor, day] of [
    ["links-b", 2],
    ["links-c", 3],
  ] as const) {
    const email = e2eEmail(visitor);
    const other = await book(browser, consoleErrors, typePath, visitor, email, day, 2);
    await other.goto(await joinUrlOf(other, email));
    const href = (await other.getByTestId("booking-join").getAttribute("href")) ?? "";
    expect(href).toMatch(ROOM);
    rooms.push(href);
    await other.context().close();
  }
  expect(rooms[0]).not.toBe(rooms[1]);

  // The first meeting keeps its own link.
  await guest.goto(invite);
  await expect(guest.getByTestId("booking-join")).toHaveAttribute("href", OWN);
  await guest.context().close();
});
