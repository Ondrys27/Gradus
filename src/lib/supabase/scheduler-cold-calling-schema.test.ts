// @vitest-environment node
//
// 30.4 on the real migrations (PGlite): the scheduler's own calendars
// (calendar_sources, the same validity as calendar-sources.ts), a time held
// and booked from the app (Cold Calling: no e-mail needed, "book anyway"
// over a busy time but never the same start twice, the host's
// notification), the owner's Cold Calling settings (the space reads, only
// the owner writes), move_contact() without a second meeting next to the
// booking's, the right "schedule meetings for others", and a booked meeting
// queued for a calendar the scheduler may write to.

import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { validCalendarSources } from "@/features/scheduler/calendar-sources";
import { PGLITE_EXTENSIONS } from "./pglite-extensions";

const MIGRATIONS_DIR = path.resolve(__dirname, "../../../supabase/migrations");

const SUPABASE_STUBS = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create role supabase_auth_admin nologin;
create schema auth;
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb not null default '{}'
);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
create schema extensions;
create schema storage;
create table storage.buckets (
  id text primary key, name text not null, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[]
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid
);
create function storage.foldername(name text) returns text[] language plpgsql as $$
declare _parts text[];
begin
  _parts := string_to_array(name, '/');
  return _parts[1:array_length(_parts, 1) - 1];
end $$;
alter table storage.objects enable row level security;
grant all on storage.objects, storage.buckets to authenticated;
grant usage on schema public, auth, storage, extensions to anon, authenticated, service_role, supabase_auth_admin;
alter default privileges in schema public grant all on tables to authenticated, service_role;
alter default privileges in schema public grant all on functions to authenticated, service_role;
alter default privileges in schema public grant all on sequences to authenticated, service_role;
`;

type Row = Record<string, unknown>;

let db: PGlite;
let owner: string;
let caller: string; // a worker of owner: cold calling
let stranger: string;
let ownerProfile: string;
let ownerType: string;

async function rows<T = Row>(sql: string, params?: unknown[]): Promise<T[]> {
  return (await db.query<T>(sql, params as never)).rows;
}
async function one<T = Row>(sql: string, params?: unknown[]): Promise<T> {
  return (await rows<T>(sql, params))[0] as T;
}
async function asUser(uid: string, space?: string) {
  const headers = JSON.stringify(space ? { "x-gradus-space": space } : {});
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid]);
  await db.query(`select set_config('request.headers', $1, false)`, [headers]);
  await db.exec(`set role authenticated`);
}
async function asServer() {
  await db.exec(
    `reset role; select set_config('request.jwt.claim.sub', '', false); select set_config('request.headers', '', false);`,
  );
}
async function as<T>(uid: string, run: () => Promise<T>, space?: string): Promise<T> {
  await asUser(uid, space);
  try {
    return await run();
  } finally {
    await asServer();
  }
}
async function attempt(
  uid: string,
  sql: string,
  params?: unknown[],
  space?: string,
): Promise<string> {
  return as(
    uid,
    () =>
      db.query(sql, params as never).then(
        (result) => `ok:${result.affectedRows || result.rows.length}`,
        (error: { message?: string; code?: string }) => error.message ?? error.code ?? "error",
      ),
    space,
  );
}
async function createAuthUser() {
  const { id } = await one<{ id: string }>(
    `insert into auth.users (email) values ($1) returning id`,
    [`${crypto.randomUUID()}@example.com`],
  );
  await db.query(`select initialize_user($1, 'cs')`, [id]);
  return id;
}
async function hire(space: string, account: string, rights: Array<[string, string]>) {
  const { id } = await one<{ id: string }>(
    `insert into workers (owner_id, user_id, name, status) values ($1, $2, 'Jana', 'active') returning id`,
    [space, account],
  );
  for (const [section, action] of rights) {
    await db.query(
      `insert into worker_permission_grants (owner_id, worker_id, section, action, allowed)
       values ($1, $2, $3, $4, true)
       on conflict (worker_id, section, action) do update set allowed = true`,
      [space, id, section, action],
    );
  }
  return id;
}

const TOKEN = (n: number) => n.toString(16).padStart(64, "0");
function tomorrowAt(hour: number, minute = 0): string {
  const day = new Date(Date.now() + 86_400_000);
  day.setUTCHours(hour, minute, 0, 0);
  return day.toISOString();
}

beforeAll(async () => {
  db = new PGlite({ extensions: PGLITE_EXTENSIONS });
  await db.exec(SUPABASE_STUBS);
  for (const file of readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    await db.exec(readFileSync(path.join(MIGRATIONS_DIR, file), "utf8"));
  }
  await createAuthUser();
  owner = await createAuthUser();
  caller = await createAuthUser();
  stranger = await createAuthUser();
  await asServer();
  await hire(owner, caller, [
    ["contacts", "view"],
    ["cold_calling", "view"],
    ["cold_calling", "call"],
  ]);
  ownerProfile = await as(
    owner,
    async () =>
      (
        await one<{ id: string }>(
          `insert into scheduler_profiles (space_id, handle, time_zone) values ($1, 'majitel-304', 'Europe/Prague') returning id`,
          [owner],
        )
      ).id,
  );
  ownerType = await as(
    owner,
    async () =>
      (
        await one<{ id: string }>(
          `insert into event_types (profile_id, slug, name) values ($1, 'schuzka', 'Schůzka') returning id`,
          [ownerProfile],
        )
      ).id,
  );
}, 120_000);

afterAll(async () => {
  await db?.close();
});

async function holdApp(start: string, token: string, force = false, release: string | null = null) {
  await asServer();
  return db
    .query<{ result: { id: string } }>(
      `select scheduler_hold_app($1, $2::timestamptz, $3, $4, 'cold_calling', $5, $6) as result`,
      [ownerType, start, token, caller, force, release],
    )
    .then(
      (result) => result.rows[0].result.id,
      (error: { message?: string }) => `error:${error.message ?? ""}`,
    );
}

describe("the scheduler's own calendars", () => {
  const id = "00000000-0000-4000-8000-000000000001";
  const samples: unknown[] = [
    null,
    { gradus: true, calendars: [], subscriptions: [] },
    { gradus: false, calendars: [id], subscriptions: [id], write: id },
    { gradus: true, calendars: [], subscriptions: [], write: null },
    { gradus: true, calendars: [] },
    { gradus: "yes", calendars: [], subscriptions: [] },
    { gradus: true, calendars: ["nope"], subscriptions: [] },
    { gradus: true, calendars: [], subscriptions: [], write: "nope" },
    { gradus: true, calendars: [], subscriptions: [], other: 1 },
    { gradus: true, calendars: Array.from({ length: 201 }, () => id), subscriptions: [] },
    [],
  ];

  it("the database and calendar-sources.ts agree on what is valid", async () => {
    await asServer();
    for (const sample of samples) {
      const { ok } = await one<{ ok: boolean }>(
        `select scheduler_calendar_sources_valid($1::jsonb) as ok`,
        [sample === null ? null : JSON.stringify(sample)],
      );
      expect(ok, JSON.stringify(sample)).toBe(validCalendarSources(sample));
    }
  });

  it("a new profile starts with Gradus only; the person changes their own, nobody else's", async () => {
    const { calendar_sources } = await one<{ calendar_sources: unknown }>(
      `select calendar_sources from scheduler_profiles where id = $1`,
      [ownerProfile],
    );
    expect(calendar_sources).toEqual({ gradus: true, calendars: [], subscriptions: [] });
    const value = JSON.stringify({ gradus: false, calendars: [], subscriptions: [], write: null });
    expect(
      await attempt(owner, `update scheduler_profiles set calendar_sources = $1 where id = $2`, [
        value,
        ownerProfile,
      ]),
    ).toBe("ok:1");
    expect(
      await attempt(stranger, `update scheduler_profiles set calendar_sources = $1 where id = $2`, [
        JSON.stringify({ gradus: true, calendars: [], subscriptions: [] }),
        ownerProfile,
      ]),
    ).toBe("ok:0");
    expect(
      await attempt(
        owner,
        `update scheduler_profiles set calendar_sources = '{"gradus":1}' where id = $1`,
        [ownerProfile],
      ),
    ).toMatch(/calendar_sources_valid|check/);
    expect(
      await attempt(owner, `update event_types set calendar_sources = $1 where id = $2`, [
        value,
        ownerType,
      ]),
    ).toBe("ok:1");
    await db.query(`update event_types set calendar_sources = null where id = $1`, [ownerType]);
  });

  it("nobody but the server reads the live cache", async () => {
    expect(await attempt(owner, `select * from scheduler_busy_cache`)).toMatch(/permission denied/);
  });
});

describe("a time held and booked from the app", () => {
  it("holds a free time; a busy one only with force, never the same start twice", async () => {
    const first = await holdApp(tomorrowAt(9), TOKEN(301));
    expect(first).not.toMatch(/^error/);
    expect(await holdApp(tomorrowAt(9, 15), TOKEN(302))).toMatch(/slot_taken/);
    expect(await holdApp(tomorrowAt(9, 15), TOKEN(303), true)).not.toMatch(/^error/);
    expect(await holdApp(tomorrowAt(9), TOKEN(304), true)).toMatch(/slot_taken/);
    const row = await one<{ source: string; created_by: string }>(
      `select source, created_by from bookings where id = $1`,
      [first],
    );
    expect(row).toEqual({ source: "cold_calling", created_by: caller });
  });

  it("is renewed while the dialog is open; the client calls none of it", async () => {
    const held = await holdApp(tomorrowAt(14), TOKEN(310));
    await asServer();
    const before = await one<{ hold_expires_at: string }>(
      `select hold_expires_at from bookings where id = $1`,
      [held],
    );
    await db.query(
      `update bookings set hold_expires_at = now() + interval '1 minute' where id = $1`,
      [held],
    );
    await db.query(`select scheduler_hold_extend($1, $2)`, [held, TOKEN(310)]);
    const after = await one<{ hold_expires_at: string }>(
      `select hold_expires_at from bookings where id = $1`,
      [held],
    );
    expect(Date.parse(after.hold_expires_at)).toBeGreaterThan(Date.now() + 4 * 60_000);
    expect(before).toBeTruthy();
    await expect(
      db.query(`select scheduler_hold_extend($1, $2)`, [held, TOKEN(999)]),
    ).rejects.toThrow(/hold_expired/);
    for (const sql of [
      `select scheduler_hold_app('${ownerType}', now() + interval '2 days', '${TOKEN(311)}', '${caller}', 'app')`,
      `select scheduler_hold_extend('${held}', '${TOKEN(310)}')`,
      `select scheduler_book_app('${held}', '${TOKEN(310)}', '${TOKEN(312)}', 'Jan', '', '', '', 'Europe/Prague', 'cs', null)`,
    ]) {
      expect(await attempt(caller, sql, [], owner)).toMatch(/permission denied/);
    }
  });

  it("books without an e-mail, tells the host who booked it, and only the host reads that", async () => {
    await asServer();
    const { id: contact } = await one<{ id: string }>(
      `insert into contacts (user_id, first_name, last_name) values ($1, 'Jan', 'Bez Mailu') returning id`,
      [owner],
    );
    const held = await holdApp(tomorrowAt(16), TOKEN(320));
    await asServer();
    const { result } = await one<{ result: { status: string } }>(
      `select scheduler_book_app($1, $2, $3, 'Jan Bez Mailu', '', '', '', 'Europe/Prague', 'cs', $4) as result`,
      [held, TOKEN(320), TOKEN(321), contact],
    );
    expect(result.status).toBe("confirmed");
    const booking = await one<Row>(
      `select status, guest_email, contact_id, confirmed_at is not null as confirmed from bookings where id = $1`,
      [held],
    );
    expect(booking).toEqual({
      status: "confirmed",
      guest_email: null,
      contact_id: contact,
      confirmed: true,
    });

    const note = await one<{ id: string; kind: string; actor_id: string }>(
      `select id, kind, actor_id from account_notifications where user_id = $1 and booking_id = $2`,
      [owner, held],
    );
    expect(note).toMatchObject({ kind: "booking_scheduled", actor_id: caller });
    const labels = await as(owner, () =>
      rows<{ actor_name: string; guest_name: string }>(
        `select * from booking_notification_labels($1)`,
        [[note.id]],
      ),
    );
    expect(labels[0]).toMatchObject({ actor_name: "Jana", guest_name: "Jan Bez Mailu" });
    expect(
      await as(stranger, () => rows(`select * from booking_notification_labels($1)`, [[note.id]])),
    ).toHaveLength(0);
  });

  it("a booking from the public page still needs the guest's e-mail", async () => {
    await asServer();
    const { id } = await one<{ id: string }>(
      `insert into bookings (event_type_id, host_user_id, space_id, starts_at, ends_at, status, guest_name)
       values ($1, $2, $2, now() + interval '3 days', now() + interval '3 days 30 minutes', 'held', null) returning id`,
      [ownerType, owner],
    );
    await expect(
      db.query(`update bookings set status = 'confirmed', guest_name = 'X' where id = $1`, [id]),
    ).rejects.toThrow(/bookings_guest_known/);
    await db.query(`delete from bookings where id = $1`, [id]);
  });
});

describe("Cold Calling: the meeting the scheduler booked is the contact's meeting", () => {
  it("move_contact() makes no second event next to the booking's; without one it still books", async () => {
    await asServer();
    const { id: table } = await one<{ id: string }>(
      `select id from contact_tables where user_id = $1 and system_key = 'meeting_scheduled'`,
      [owner],
    );
    const { id: field } = await one<{ id: string }>(
      `select id from contact_table_fields where table_id = $1 and system_key = 'meeting_at'`,
      [table],
    );
    const [{ id: booked }, { id: plain }] = await rows<{ id: string }>(
      `insert into contacts (user_id, first_name) values ($1, 'S rezervací'), ($1, 'Bez rezervace') returning id`,
      [owner],
    );
    const start = tomorrowAt(10);
    const held = await holdApp(start, TOKEN(330));
    await asServer();
    await db.query(
      `select scheduler_book_app($1, $2, $3, 'S rezervací', '', '', '', 'Europe/Prague', 'cs', $4)`,
      [held, TOKEN(330), TOKEN(331), booked],
    );
    const answers = JSON.stringify({ [field]: start });
    for (const contact of [booked, plain]) {
      expect(
        await attempt(
          owner,
          `select move_contact($1, $2, $3::jsonb)`,
          [contact, table, answers],
          owner,
        ),
      ).toBe("ok:1");
    }
    const events = await rows<{ contact_id: string }>(
      `select contact_id from calendar_events where source = 'contact_move' and contact_id = any($1)`,
      [[booked, plain]],
    );
    expect(events.map((event) => event.contact_id)).toEqual([plain]);
  });
});

describe("the owner's Cold Calling settings", () => {
  it("the owner writes them, the company reads them, nobody else", async () => {
    expect(
      await attempt(
        owner,
        `insert into cold_calling_meeting_settings (space_id, host_mode, event_type_id, type_locked, ignore_notice)
         values ($1, 'owner', $2, true, true)`,
        [owner, ownerType],
        owner,
      ),
    ).toBe("ok:1");
    const seen = await as(
      caller,
      () =>
        rows(
          `select host_mode, type_locked from cold_calling_meeting_settings where space_id = $1`,
          [owner],
        ),
      owner,
    );
    expect(seen).toEqual([{ host_mode: "owner", type_locked: true }]);
    expect(
      await attempt(
        caller,
        `update cold_calling_meeting_settings set host_mode = 'caller' where space_id = $1`,
        [owner],
        owner,
      ),
    ).toBe("ok:0");
    expect(
      await attempt(caller, `insert into cold_calling_meeting_settings (space_id) values ($1)`, [
        caller,
      ]),
    ).toBe("ok:1");
    expect(
      await as(stranger, () =>
        rows(`select 1 from cold_calling_meeting_settings where space_id = $1`, [owner]),
      ),
    ).toHaveLength(0);
  });

  it("names only a person and a type of the space", async () => {
    expect(
      await attempt(
        owner,
        `update cold_calling_meeting_settings set host_mode = 'person', host_user_id = $1 where space_id = $2`,
        [stranger, owner],
        owner,
      ),
    ).toMatch(/not_found/);
    expect(
      await attempt(
        owner,
        `update cold_calling_meeting_settings set host_mode = 'person', host_user_id = $1 where space_id = $2`,
        [caller, owner],
        owner,
      ),
    ).toBe("ok:1");
    const { id: foreignProfile } = await as(stranger, () =>
      one<{ id: string }>(
        `insert into scheduler_profiles (space_id, handle) values ($1, 'cizi-304') returning id`,
        [stranger],
      ),
    );
    const { id: foreignType } = await as(stranger, () =>
      one<{ id: string }>(
        `insert into event_types (profile_id, slug, name) values ($1, 'x', 'X') returning id`,
        [foreignProfile],
      ),
    );
    expect(
      await attempt(
        owner,
        `update cold_calling_meeting_settings set event_type_id = $1 where space_id = $2`,
        [foreignType, owner],
      ),
    ).toMatch(/not_found/);
  });
});

describe("rights and the calendar to write to", () => {
  it("the catalog has cold_calling.schedule_others", async () => {
    await asServer();
    expect(
      await rows(
        `select kind from permission_catalog() where section = 'cold_calling' and action = 'schedule_others'`,
      ),
    ).toEqual([{ kind: "write" }]);
  });

  it("a booked meeting is queued for a writable calendar even when nothing is the general one", async () => {
    await asServer();
    await db.query(
      `update app_settings set value = jsonb_set(value, '{mode}', '"everyone"') where key = 'calendar_sync'`,
    );
    const { id: connection } = await one<{ id: string }>(
      `insert into calendar_connections (user_id, provider, secret_cipher) values ($1, 'google', 'v1.sealed') returning id`,
      [owner],
    );
    await db.query(
      `insert into calendar_connection_calendars (connection_id, external_id, name, can_write, read, write)
       values ($1, 'team', 'Team', true, false, false)`,
      [connection],
    );
    const [{ id: booking }, { id: manual }] = await rows<{ id: string }>(
      `insert into calendar_events (user_id, actor_id, title, kind, starts_at, source)
       values ($1, $1, 'Schůzka', 'meeting', now() + interval '2 days', 'booking'),
              ($1, $1, 'Moje', 'meeting', now() + interval '2 days', 'manual')
       returning id`,
      [owner],
    );
    const queued = await rows<{ event_id: string }>(
      `select event_id from calendar_sync_outbox where event_id = any($1)`,
      [[booking, manual]],
    );
    expect(queued.map((row) => row.event_id)).toEqual([booking]);
  });
});
