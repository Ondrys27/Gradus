// @vitest-environment node
//
// Two-way calendar sync (28.10) on the real migrations (PGlite): the switch
// (who may connect, also against a direct write of the server), secrets the
// client never reads or writes, the outbox filled by changes made in Gradus
// and never by what the server reads in (no loop), the import itself, and
// disconnect (what was read in goes, the person's own events stay).

import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { calendarSyncAllowed, validCalendarSync } from "@/features/calendar/sync/access";
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
  raw_user_meta_data jsonb not null default '{}',
  created_at timestamptz not null default now()
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
let early: string; // made before the switch's date
let late: string; // made after it
let added: string; // made after it, added by hand
let stranger: string;

async function rows<T = Row>(sql: string, params?: unknown[]): Promise<T[]> {
  return (await db.query<T>(sql, params as never)).rows;
}
async function one<T = Row>(sql: string, params?: unknown[]): Promise<T> {
  return (await rows<T>(sql, params))[0] as T;
}
async function asUser(uid: string) {
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid]);
  await db.query(`select set_config('request.headers', '{}', false)`);
  await db.exec(`set role authenticated`);
}
async function asServer() {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
}
async function as<T>(uid: string, run: () => Promise<T>): Promise<T> {
  await asUser(uid);
  try {
    return await run();
  } finally {
    await asServer();
  }
}
async function attempt(uid: string, sql: string, params?: unknown[]): Promise<string> {
  return as(uid, () =>
    db.query(sql, params as never).then(
      () => "ok",
      (error: { message?: string }) => error.message ?? "error",
    ),
  );
}
async function createAuthUser(createdAt: string) {
  const { id } = await one<{ id: string }>(
    `insert into auth.users (email, created_at) values ($1, $2) returning id`,
    [`${crypto.randomUUID()}@example.com`, createdAt],
  );
  await db.query(`select initialize_user($1, 'cs')`, [id]);
  return id;
}
async function connect(user: string, provider = "google") {
  const { id } = await one<{ id: string }>(
    `insert into calendar_connections (user_id, provider, secret_cipher) values ($1, $2, 'v1.sealed') returning id`,
    [user, provider],
  );
  const { id: calendar } = await one<{ id: string }>(
    `insert into calendar_connection_calendars (connection_id, external_id, name, can_write, read, write)
     values ($1, 'primary', 'Primary', true, true, true) returning id`,
    [id],
  );
  return { connection: id, calendar };
}
const outboxOf = (user: string) =>
  rows<{ event_id: string; op: string }>(`select event_id, op from calendar_sync_outbox where user_id = $1 order by id`, [user]);

beforeAll(async () => {
  db = new PGlite({ extensions: PGLITE_EXTENSIONS });
  await db.exec(SUPABASE_STUBS);
  for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort()) {
    await db.exec(readFileSync(path.join(MIGRATIONS_DIR, file), "utf8"));
  }
  await createAuthUser("2026-01-01T00:00:00Z");
  early = await createAuthUser("2026-06-01T00:00:00Z");
  late = await createAuthUser("2099-01-01T00:00:00Z");
  added = await createAuthUser("2099-01-02T00:00:00Z");
  stranger = await createAuthUser("2026-06-02T00:00:00Z");
  await asServer();
  await db.query(`update app_settings set value = $1 where key = 'calendar_sync'`, [
    JSON.stringify({ mode: "allowlist", allow_created_before: "2030-01-01T00:00:00Z", allow_users: [added] }),
  ]);
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe("the switch", () => {
  it("the migration starts as an allowlist of accounts made before it ran", async () => {
    const fresh = new PGlite({ extensions: PGLITE_EXTENSIONS });
    try {
      await fresh.exec(SUPABASE_STUBS);
      for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort()) {
        await fresh.exec(readFileSync(path.join(MIGRATIONS_DIR, file), "utf8"));
      }
      const { value } = (await fresh.query<{ value: { mode: string; allow_created_before: string; allow_users: string[] } }>(
        `select value from app_settings where key = 'calendar_sync'`,
      )).rows[0];
      expect(value.mode).toBe("allowlist");
      expect(value.allow_users).toEqual([]);
      expect(Math.abs(Date.parse(value.allow_created_before) - Date.now())).toBeLessThan(5 * 60_000);
    } finally {
      await fresh.close();
    }
  }, 120_000);

  it("lets in older accounts and hand-added ones, the same as the app's rule", async () => {
    const setting = {
      mode: "allowlist" as const,
      allow_created_before: "2030-01-01T00:00:00Z",
      allow_users: [added],
    };
    for (const [user, createdAt, expected] of [
      [early, "2026-06-01T00:00:00Z", true],
      [late, "2099-01-01T00:00:00Z", false],
      [added, "2099-01-02T00:00:00Z", true],
    ] as const) {
      const { ok } = await one<{ ok: boolean }>(`select calendar_sync_allowed($1) as ok`, [user]);
      expect(ok).toBe(expected);
      expect(calendarSyncAllowed(setting, { id: user, createdAt })).toBe(expected);
    }
  });

  it("an account outside the list gets no connection, not even from the server", async () => {
    await expect(
      db.query(`insert into calendar_connections (user_id, provider, secret_cipher) values ($1, 'google', 'x')`, [late]),
    ).rejects.toThrow(/calendar_sync_not_allowed/);
  });

  it("nobody but the server asks the rule or writes a connection", async () => {
    expect(await attempt(late, `select calendar_sync_allowed($1)`, [late])).toMatch(/permission denied/);
    expect(
      await attempt(early, `insert into calendar_connections (user_id, provider, secret_cipher) values ($1, 'google', 'x')`, [early]),
    ).toMatch(/permission denied/);
  });

  it("everyone: one switch opens it", async () => {
    await db.query(`update app_settings set value = jsonb_set(value, '{mode}', '"everyone"') where key = 'calendar_sync'`);
    expect((await one<{ ok: boolean }>(`select calendar_sync_allowed($1) as ok`, [late])).ok).toBe(true);
    await db.query(`update app_settings set value = jsonb_set(value, '{mode}', '"allowlist"') where key = 'calendar_sync'`);
  });

  it("checks the setting like the app", async () => {
    const good = { mode: "everyone", allow_created_before: null, allow_users: [] };
    const bad = [
      { mode: "all" },
      { mode: "allowlist", allow_users: ["not-a-uuid"] },
      { mode: "allowlist", allow_created_before: "yesterday" },
      { mode: "allowlist", extra: true },
      { mode: "allowlist", allow_users: [added, added] },
    ];
    expect((await one<{ ok: boolean }>(`select valid_calendar_sync($1) as ok`, [JSON.stringify(good)])).ok).toBe(true);
    expect(validCalendarSync(good)).toBe(true);
    for (const value of bad) {
      expect((await one<{ ok: boolean }>(`select valid_calendar_sync($1) as ok`, [JSON.stringify(value)])).ok).toBe(false);
      expect(validCalendarSync(value)).toBe(false);
    }
    await expect(
      db.query(`update app_settings set value = '{"mode":"all"}' where key = 'calendar_sync'`),
    ).rejects.toThrow();
  });
});

describe("secrets and row protection", () => {
  let connection: string;
  beforeAll(async () => {
    ({ connection } = await connect(early));
  });

  it("the person reads the state of their connection, never the secret", async () => {
    const state = await as(early, () =>
      rows(`select id, provider, status from calendar_connections where user_id = $1`, [early]),
    );
    expect(state).toHaveLength(1);
    expect(await attempt(early, `select secret_cipher from calendar_connections`)).toMatch(/permission denied/);
    expect(await attempt(early, `select sync_state from calendar_connection_calendars`)).toMatch(/permission denied/);
    expect(await attempt(early, `update calendar_connections set status = 'error' where id = $1`, [connection])).toMatch(
      /permission denied/,
    );
    expect(await attempt(early, `select id from calendar_sync_outbox`)).toMatch(/permission denied/);
  });

  it("another account sees nothing of it", async () => {
    const seen = await as(stranger, () => rows(`select id from calendar_connections`));
    expect(seen).toEqual([]);
    const calendars = await as(stranger, () => rows(`select id from calendar_connection_calendars`));
    expect(calendars).toEqual([]);
  });
});

describe("the outbox and the import", () => {
  let user: string;
  let calendar: string;
  let connection: string;

  beforeAll(async () => {
    user = await createAuthUser("2026-07-01T00:00:00Z");
    await asServer();
    ({ connection, calendar } = await connect(user));
  });

  it("a change made in Gradus waits to go out (once per event), a delete keeps the link", async () => {
    const { id } = await as(user, () =>
      one<{ id: string }>(
        `insert into calendar_events (user_id, title, kind, starts_at, ends_at) values ($1, 'Coffee', 'meeting', now(), now() + interval '1 hour') returning id`,
        [user],
      ),
    );
    await as(user, () => db.query(`update calendar_events set title = 'Coffee!' where id = $1`, [id]));
    expect(await outboxOf(user)).toEqual([{ event_id: id, op: "upsert" }]);
    // Nothing that matters changed: nothing more.
    await as(user, () => db.query(`update calendar_events set contact_id = null where id = $1`, [id]));
    expect(await outboxOf(user)).toHaveLength(1);

    await db.query(
      `insert into calendar_external_links (event_id, user_id, connection_id, calendar_id, external_id, origin, etag)
       values ($1, $2, $3, $4, 'g1', 'gradus', '"e1"')`,
      [id, user, connection, calendar],
    );
    await db.query(`delete from calendar_sync_outbox where user_id = $1`, [user]);
    await as(user, () => db.query(`delete from calendar_events where id = $1`, [id]));
    const [deleted] = await rows<{ op: string; link: { external_id: string; etag: string } }>(
      `select op, link from calendar_sync_outbox where user_id = $1`,
      [user],
    );
    expect(deleted.op).toBe("delete");
    expect(deleted.link).toMatchObject({ external_id: "g1", etag: '"e1"' });
    await db.query(`delete from calendar_sync_outbox where user_id = $1`, [user]);
  });

  it("what the server reads in never goes back out (no loop)", async () => {
    const result = await one<{ r: { inserted: number } }>(
      `select calendar_sync_apply($1, $2::jsonb) as r`,
      [
        calendar,
        JSON.stringify([
          {
            external_id: "g-ext",
            recurring_id: null,
            etag: '"x1"',
            external_updated_at: "2026-12-01T08:00:00Z",
            title: "From Google",
            description: null,
            location: "Room 1",
            starts_at: "2026-12-02T09:00:00Z",
            ends_at: "2026-12-02T10:00:00Z",
            all_day: false,
            transparent: false,
            conflict: null,
          },
        ]),
      ],
    );
    expect(result.r.inserted).toBe(1);
    const event = await one<{ id: string; source: string; actor_id: string; location: string }>(
      `select e.id, e.source, e.actor_id, e.location from calendar_events e
       join calendar_external_links l on l.event_id = e.id where l.external_id = 'g-ext'`,
    );
    expect(event).toMatchObject({ source: "external", actor_id: user, location: "Room 1" });
    expect(await outboxOf(user)).toEqual([]);
    // Edited in Gradus: written back.
    await as(user, () => db.query(`update calendar_events set title = 'Edited' where id = $1`, [event.id]));
    expect(await outboxOf(user)).toEqual([{ event_id: event.id, op: "upsert" }]);
    // The other side newer: the import answers the waiting change.
    await db.query(`select calendar_sync_apply($1, $2::jsonb)`, [
      calendar,
      JSON.stringify([
        {
          external_id: "g-ext",
          etag: '"x2"',
          title: "Google won",
          starts_at: "2026-12-02T09:00:00Z",
          ends_at: "2026-12-02T10:00:00Z",
          all_day: false,
          conflict: "external",
        },
      ]),
    ]);
    expect(await outboxOf(user)).toEqual([]);
    const link = await one<{ conflict_winner: string; etag: string }>(
      `select conflict_winner, etag from calendar_external_links where event_id = $1`,
      [event.id],
    );
    expect(link).toEqual({ conflict_winner: "external", etag: '"x2"' });
    // The person sees the note.
    const seen = await as(user, () =>
      rows(`select conflict_winner from calendar_external_links where event_id = $1`, [event.id]),
    );
    expect(seen).toEqual([{ conflict_winner: "external" }]);
  });

  it("a whole series goes when its id is deleted; a booked meeting only loses its link", async () => {
    await db.query(`select calendar_sync_apply($1, $2::jsonb)`, [
      calendar,
      JSON.stringify(
        ["a", "b"].map((suffix) => ({
          external_id: `weekly_${suffix}`,
          recurring_id: "weekly",
          title: "Weekly",
          starts_at: "2026-12-07T08:00:00Z",
          ends_at: "2026-12-07T09:00:00Z",
          all_day: false,
        })),
      ),
    ]);
    const { id: booked } = await one<{ id: string }>(
      `insert into calendar_events (user_id, actor_id, title, kind, starts_at, ends_at, source)
       values ($1, $1, 'Booked', 'meeting', now(), now() + interval '30 minutes', 'booking') returning id`,
      [user],
    );
    await db.query(
      `insert into calendar_external_links (event_id, user_id, connection_id, calendar_id, external_id, origin)
       values ($1, $2, $3, $4, 'g-booked', 'gradus')`,
      [booked, user, connection, calendar],
    );
    await db.query(`delete from calendar_sync_outbox where user_id = $1`, [user]);
    await db.query(`select calendar_sync_apply($1, '[]'::jsonb, $2, $3)`, [calendar, ["g-booked"], ["weekly"]]);
    expect(await rows(`select 1 from calendar_external_links where recurring_id = 'weekly'`)).toEqual([]);
    expect(await rows(`select 1 from calendar_events where title = 'Weekly'`)).toEqual([]);
    expect(await rows(`select id from calendar_events where id = $1`, [booked])).toHaveLength(1);
    expect(await rows(`select 1 from calendar_external_links where event_id = $1`, [booked])).toEqual([]);
    expect(await outboxOf(user)).toEqual([]);
  });

  it("disconnect: what was read in goes, the person's own events stay, nothing goes out", async () => {
    const { id: own } = await as(user, () =>
      one<{ id: string }>(
        `insert into calendar_events (user_id, title, kind, starts_at, ends_at) values ($1, 'Mine', 'meeting', now(), now() + interval '1 hour') returning id`,
        [user],
      ),
    );
    await db.query(
      `insert into calendar_external_links (event_id, user_id, connection_id, calendar_id, external_id, origin)
       values ($1, $2, $3, $4, 'g-mine', 'gradus')`,
      [own, user, connection, calendar],
    );
    await db.query(`delete from calendar_sync_outbox where user_id = $1`, [user]);
    const before = await one<{ n: number }>(
      `select count(*)::int as n from calendar_events where user_id = $1 and source = 'external'`,
      [user],
    );
    expect(before.n).toBeGreaterThan(0);
    await db.query(`select calendar_sync_forget($1)`, [connection]);
    await db.query(`delete from calendar_connections where id = $1`, [connection]);
    expect(
      (await one<{ n: number }>(`select count(*)::int as n from calendar_events where user_id = $1 and source = 'external'`, [user])).n,
    ).toBe(0);
    expect(await rows(`select title from calendar_events where id = $1`, [own])).toEqual([{ title: "Mine" }]);
    expect(await outboxOf(user)).toEqual([]);
    // No calendar to write to any more: changes stay in Gradus.
    await as(user, () => db.query(`update calendar_events set title = 'Mine 2' where id = $1`, [own]));
    expect(await outboxOf(user)).toEqual([]);
  });

  it("the client cannot make an event look as if it came from another calendar", async () => {
    const { source } = await as(user, () =>
      one<{ source: string }>(
        `insert into calendar_events (user_id, title, kind, starts_at, source) values ($1, 'Fake', 'meeting', now(), 'external') returning source`,
        [user],
      ),
    );
    expect(source).toBe("manual");
  });
});

describe("claiming the outbox", () => {
  it("takes the oldest change of each event once; a second run gets nothing", async () => {
    const user = await createAuthUser("2026-07-02T00:00:00Z");
    await asServer();
    await connect(user);
    const { id } = await as(user, () =>
      one<{ id: string }>(
        `insert into calendar_events (user_id, title, kind, starts_at) values ($1, 'A', 'meeting', now()) returning id`,
        [user],
      ),
    );
    const first = await rows<{ event_id: string }>(`select event_id from calendar_sync_outbox_claim($1, 10)`, [user]);
    expect(first.map((row) => row.event_id)).toEqual([id]);
    // Changed again while the first run sends it: a new change waits, nobody takes it yet.
    await as(user, () => db.query(`update calendar_events set title = 'B' where id = $1`, [id]));
    expect(await rows(`select 1 from calendar_sync_outbox_claim($1, 10)`, [user])).toEqual([]);
    expect(await attempt(user, `select * from calendar_sync_outbox_claim($1, 10)`, [user])).toMatch(/permission denied/);
  });
});
