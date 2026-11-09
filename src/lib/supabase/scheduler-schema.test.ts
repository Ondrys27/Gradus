// @vitest-environment node
//
// The scheduler (24.3) on the real migrations (PGlite): who reads and writes
// profiles, meeting types, hours and exceptions (the person with "scheduler:
// own" in that space; the space's owner reads everyone's and may only switch
// a type off), what the guards keep fixed (person and space from the profile,
// handle format, questions, reminders, the stage of the same space), the plan's
// limit on active types, subscriptions and the feed secret (server only for
// what is secret), and bookings (read only, never the guest's token).

import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
let worker: string; // scheduler: view + own in owner's space
let viewer: string; // works for owner without the scheduler
let stranger: string;

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
async function fails(uid: string, sql: string, params?: unknown[]): Promise<string> {
  return as(uid, () =>
    db.query(sql, params as never).then(
      () => "ok",
      (error: { message?: string; code?: string }) => error.message ?? error.code ?? "error",
    ),
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
    `insert into workers (owner_id, user_id, name, status) values ($1, $2, 'Member', 'active') returning id`,
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
async function makeProfile(user: string, space: string, handle: string) {
  return as(user, async () => {
    const { id } = await one<{ id: string }>(
      `insert into scheduler_profiles (space_id, handle, time_zone) values ($1, $2, 'Europe/Prague') returning id`,
      [space, handle],
    );
    return id;
  });
}
async function makeType(user: string, profile: string, slug: string, active = true) {
  return as(user, async () => {
    const { id } = await one<{ id: string }>(
      `insert into event_types (profile_id, slug, name, active) values ($1, $2, 'Call', $3) returning id`,
      [profile, slug, active],
    );
    return id;
  });
}

let ownerProfile: string;
let workerProfile: string;
let ownerType: string;
let workerType: string;

beforeAll(async () => {
  db = new PGlite({ extensions: PGLITE_EXTENSIONS });
  await db.exec(SUPABASE_STUBS);
  for (const file of readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    await db.exec(readFileSync(path.join(MIGRATIONS_DIR, file), "utf8"));
  }
  // The very first account owns the application; the scheduler is about the next ones.
  await createAuthUser();
  owner = await createAuthUser();
  worker = await createAuthUser();
  viewer = await createAuthUser();
  stranger = await createAuthUser();
  await asServer();
  await hire(owner, worker, [
    ["scheduler", "view"],
    ["scheduler", "own"],
  ]);
  await hire(owner, viewer, [["contacts", "view"]]);
  ownerProfile = await makeProfile(owner, owner, "ondrej");
  workerProfile = await makeProfile(worker, owner, "pepa-novak");
  ownerType = await makeType(owner, ownerProfile, "konzultace");
  workerType = await makeType(worker, workerProfile, "uvodni-hovor");
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe("rights", () => {
  it("the catalog has scheduler.view and scheduler.own", async () => {
    const found = await rows<{ action: string; kind: string }>(
      `select action, kind from permission_catalog() where section = 'scheduler' order by action`,
    );
    expect(found).toEqual([
      { action: "own", kind: "write" },
      { action: "view", kind: "view" },
    ]);
  });
});

describe("profiles", () => {
  it("are their person's: user id from the session, space by the right", async () => {
    await asServer();
    const row = await one<{ user_id: string; space_id: string }>(
      `select user_id, space_id from scheduler_profiles where id = $1`,
      [workerProfile],
    );
    expect(row).toEqual({ user_id: worker, space_id: owner });
    // Without "scheduler: own" in the space there is none.
    expect(
      await fails(
        viewer,
        `insert into scheduler_profiles (space_id, handle) values ($1, 'viewer-x')`,
        [owner],
      ),
    ).toMatch(/row-level security/);
    // Nobody makes one for somebody else.
    expect(
      await fails(
        stranger,
        `insert into scheduler_profiles (user_id, space_id, handle) values ($1, $1, 'stranger-x')`,
        [owner],
      ),
    ).toMatch(/permission denied|row-level security/);
    // Their own space, always.
    expect(
      await fails(
        stranger,
        `insert into scheduler_profiles (space_id, handle) values ($1, 'stranger-own')`,
        [stranger],
      ),
    ).toBe("ok");
  });

  it("checks the handle: format, reserved words, unique without case", async () => {
    for (const bad of ["ab", "-abc", "abc-", "a--b", "Abc", "admin", "ab_c", "x".repeat(31)]) {
      expect(
        await fails(
          stranger,
          `update scheduler_profiles set handle = $1 where user_id = auth.uid()`,
          [bad],
        ),
        bad,
      ).not.toBe("ok");
    }
    expect(
      await fails(
        stranger,
        `update scheduler_profiles set handle = 'ondrej' where user_id = auth.uid()`,
      ),
    ).toMatch(/duplicate|unique/);
    const free = await as(stranger, () =>
      one<{ free: boolean; taken: boolean }>(
        `select scheduler_handle_available('nobody-yet') as free, scheduler_handle_available('Ondrej') as taken`,
      ),
    );
    expect(free).toEqual({ free: true, taken: false });
  });

  it("checks the zone and the video link", async () => {
    expect(
      await fails(
        stranger,
        `update scheduler_profiles set time_zone = 'Mars/Olympus' where user_id = auth.uid()`,
      ),
    ).not.toBe("ok");
    expect(
      await fails(
        stranger,
        `update scheduler_profiles set video_link = 'http://meet.google.com/abc' where user_id = auth.uid()`,
      ),
    ).not.toBe("ok");
    expect(
      await fails(
        stranger,
        `update scheduler_profiles set video_link = 'https://meet.google.com/abc-defg-hij' where user_id = auth.uid()`,
      ),
    ).toBe("ok");
  });

  it("never move to another person or space", async () => {
    expect(
      await fails(worker, `update scheduler_profiles set space_id = $1 where id = $2`, [
        worker,
        workerProfile,
      ]),
    ).not.toBe("ok");
  });

  it("the worker sees only their own; the owner everyone's of the space; others nothing", async () => {
    const seen = async (uid: string) =>
      (
        await as(uid, () =>
          rows<{ id: string }>(`select id from scheduler_profiles where space_id = $1`, [owner]),
        )
      )
        .map((row) => row.id)
        .sort();
    expect(await seen(owner)).toEqual([ownerProfile, workerProfile].sort());
    expect(await seen(worker)).toEqual([workerProfile]);
    expect(await seen(viewer)).toEqual([]);
    expect(await seen(stranger)).toEqual([]);
  });
});

describe("meeting types", () => {
  it("take the person and space from the profile, whatever the client sends", async () => {
    await asServer();
    const row = await one<{ user_id: string; space_id: string }>(
      `select user_id, space_id from event_types where id = $1`,
      [workerType],
    );
    expect(row).toEqual({ user_id: worker, space_id: owner });
    // Not a column the client may write at all.
    expect(
      await fails(
        worker,
        `insert into event_types (profile_id, user_id, slug, name) values ($1, $2, 'x', 'X')`,
        [workerProfile, owner],
      ),
    ).toMatch(/permission denied/);
    // Not under somebody else's profile.
    expect(
      await fails(
        worker,
        `insert into event_types (profile_id, slug, name) values ($1, 'mine', 'Mine')`,
        [ownerProfile],
      ),
    ).toMatch(/row-level security/);
  });

  it("the owner may switch a worker's type off, nothing else", async () => {
    expect(
      await fails(owner, `update event_types set name = 'Mine now' where id = $1`, [workerType]),
    ).toMatch(/not_allowed/);
    expect(
      await fails(owner, `update event_types set active = false where id = $1`, [workerType]),
    ).toBe("ok");
    expect(
      await fails(owner, `update event_types set active = true where id = $1`, [workerType]),
    ).toMatch(/not_allowed/);
    expect(
      await fails(owner, `delete from event_types where id = $1 returning id`, [workerType]),
    ).toBe("ok");
    await asServer();
    expect(await rows(`select 1 from event_types where id = $1`, [workerType])).toHaveLength(1);
    // The worker turns it back on.
    expect(
      await fails(worker, `update event_types set active = true where id = $1`, [workerType]),
    ).toBe("ok");
  });

  it("a worker never touches the owner's type", async () => {
    expect(
      await fails(worker, `update event_types set active = false where id = $1 returning id`, [
        ownerType,
      ]),
    ).toBe("ok");
    await asServer();
    expect(
      (await one<{ active: boolean }>(`select active from event_types where id = $1`, [ownerType]))
        .active,
    ).toBe(true);
  });

  it("checks questions, reminders and the stage", async () => {
    const update = (set: string, params: unknown[] = []) =>
      fails(owner, `update event_types set ${set} where id = $1`, [ownerType, ...params]);
    // Name and e-mail always, required.
    expect(
      await update(`questions = '[{"key":"name","label":null,"type":"text","required":true}]'`),
    ).not.toBe("ok");
    expect(
      await update(
        `questions = '[{"key":"name","label":null,"type":"text","required":true},{"key":"email","label":null,"type":"email","required":false}]'`,
      ),
    ).not.toBe("ok");
    // A custom question needs a label; a select needs options.
    const base = `{"key":"name","label":null,"type":"text","required":true},{"key":"email","label":null,"type":"email","required":true}`;
    expect(
      await update(
        `questions = '[${base},{"key":"budget","label":null,"type":"text","required":false}]'`,
      ),
    ).not.toBe("ok");
    expect(
      await update(
        `questions = '[${base},{"key":"size","label":"Size","type":"select","required":false}]'`,
      ),
    ).not.toBe("ok");
    expect(
      await update(
        `questions = '[${base},{"key":"size","label":"Size","type":"select","required":true,"options":["1–5","6+"]}]'`,
      ),
    ).toBe("ok");
    // Reminders: at most five, distinct, 5 min to 7 days, e-mail.
    expect(await update(`reminders = '[{"offset_minutes":1,"channel":"email"}]'`)).not.toBe("ok");
    expect(
      await update(
        `reminders = '[{"offset_minutes":60,"channel":"email"},{"offset_minutes":60,"channel":"email"}]'`,
      ),
    ).not.toBe("ok");
    expect(await update(`reminders = '[{"offset_minutes":60,"channel":"sms"}]'`)).not.toBe("ok");
    expect(await update(`reminders = '[]'`)).toBe("ok");
    // Step, horizon, length.
    expect(await update(`slot_step_min = 20`)).not.toBe("ok");
    expect(await update(`max_days_ahead = 90`)).not.toBe("ok");
    expect(await update(`duration_min = 2`)).not.toBe("ok");
    // A stage of the same space, not a lost one.
    await asServer();
    const own = await one<{ id: string }>(
      `select id from pipeline_stages where user_id = $1 and not is_lost and not is_won order by position limit 1`,
      [owner],
    );
    const lost = await one<{ id: string }>(
      `select id from pipeline_stages where user_id = $1 and is_lost limit 1`,
      [owner],
    );
    const foreign = await one<{ id: string }>(
      `select id from pipeline_stages where user_id = $1 limit 1`,
      [stranger],
    );
    expect(await update(`deal_stage_id = $2`, [own.id])).toBe("ok");
    expect(await update(`deal_stage_id = $2`, [lost.id])).toMatch(/invalid_stage/);
    expect(await update(`deal_stage_id = $2`, [foreign.id])).not.toBe("ok");
  });

  it("Solo holds one active type; Pro and beta any number", async () => {
    const solo = await createAuthUser();
    await asServer();
    await db.query(
      `update subscriptions set plan_key = 'solo', status = 'active', trial_ends_at = null,
         current_period_end = now() + interval '20 days' where user_id = $1`,
      [solo],
    );
    expect(
      await as(solo, () =>
        one<{ n: number | null }>(`select scheduler_types_limit($1) as n`, [solo]),
      ),
    ).toEqual({
      n: 1,
    });
    const profile = await makeProfile(solo, solo, `solo-${solo.slice(0, 6)}`);
    await makeType(solo, profile, "first");
    // A second active one is refused; inactive is fine and stays off.
    expect(
      await fails(
        solo,
        `insert into event_types (profile_id, slug, name) values ($1, 'second', 'Second')`,
        [profile],
      ),
    ).toMatch(/scheduler_type_limit/);
    const second = await makeType(solo, profile, "second", false);
    expect(
      await fails(solo, `update event_types set active = true where id = $1`, [second]),
    ).toMatch(/scheduler_type_limit/);
    // Pro (the trial of the owner): no limit.
    expect(
      await as(owner, () =>
        one<{ n: number | null }>(`select scheduler_types_limit($1) as n`, [owner]),
      ),
    ).toEqual({
      n: null,
    });
    // Nobody asks for a space they do not belong to.
    expect(await fails(stranger, `select scheduler_types_limit($1)`, [solo])).toMatch(
      /not_allowed/,
    );
  });

  it("a published catalog limit wins over the plans table", async () => {
    await asServer();
    const { payload } = await one<{
      payload: Array<{ key: string; limits: Record<string, unknown> }>;
    }>(`select payload from plan_catalog_versions where status = 'published'`);
    const withLimit = payload.map((plan) => ({
      ...plan,
      limits: { ...plan.limits, scheduler_types: plan.key === "solo" ? 2 : null },
    }));
    expect(
      (
        await one<{ ok: boolean }>(`select valid_plan_catalog($1::jsonb) as ok`, [
          JSON.stringify(withLimit),
        ])
      ).ok,
    ).toBe(true);
    const bad = payload.map((plan) => ({
      ...plan,
      limits: { ...plan.limits, scheduler_types: -1 },
    }));
    expect(
      (
        await one<{ ok: boolean }>(`select valid_plan_catalog($1::jsonb) as ok`, [
          JSON.stringify(bad),
        ])
      ).ok,
    ).toBe(false);
  });
});

describe("hours and exceptions", () => {
  it("belong to the profile's person; a type's own hours only for a type of that profile", async () => {
    expect(
      await fails(
        worker,
        `insert into availability_rules (profile_id, weekday, start_time, end_time) values ($1, 1, '09:00', '17:00')`,
        [workerProfile],
      ),
    ).toBe("ok");
    expect(
      await fails(
        worker,
        `insert into availability_rules (profile_id, event_type_id, weekday, start_time, end_time) values ($1, $2, 1, '09:00', '12:00')`,
        [workerProfile, ownerType],
      ),
    ).not.toBe("ok");
    expect(
      await fails(
        worker,
        `insert into availability_rules (profile_id, weekday, start_time, end_time) values ($1, 1, '09:00', '17:00')`,
        [ownerProfile],
      ),
    ).toMatch(/row-level security/);
    // Until 24:00, never backwards.
    expect(
      await fails(
        owner,
        `insert into availability_rules (profile_id, weekday, start_time, end_time) values ($1, 5, '20:00', '24:00')`,
        [ownerProfile],
      ),
    ).toBe("ok");
    expect(
      await fails(
        owner,
        `insert into availability_rules (profile_id, weekday, start_time, end_time) values ($1, 5, '12:00', '09:00')`,
        [ownerProfile],
      ),
    ).not.toBe("ok");
    // A whole day blocked, or other hours; never half of a pair.
    expect(
      await fails(
        owner,
        `insert into availability_overrides (profile_id, date) values ($1, current_date + 3)`,
        [ownerProfile],
      ),
    ).toBe("ok");
    expect(
      await fails(
        owner,
        `insert into availability_overrides (profile_id, date, start_time) values ($1, current_date + 4, '09:00')`,
        [ownerProfile],
      ),
    ).not.toBe("ok");
    // The owner reads the worker's hours, never changes them.
    const read = await as(owner, () =>
      rows(`select 1 from availability_rules where profile_id = $1`, [workerProfile]),
    );
    expect(read.length).toBeGreaterThan(0);
    expect(
      await fails(
        owner,
        `update availability_rules set start_time = '10:00' where profile_id = $1 returning id`,
        [workerProfile],
      ),
    ).toBe("ok");
    await asServer();
    expect(
      (
        await one<{ t: string }>(
          `select min(start_time)::text as t from availability_rules where profile_id = $1`,
          [workerProfile],
        )
      ).t,
    ).toBe("09:00:00");
  });
});

describe("subscriptions and the feed", () => {
  it("only the server adds a subscription; the client never reads the link", async () => {
    expect(
      await fails(
        owner,
        `insert into calendar_subscriptions (name, url_cipher, url_hint) values ('G', 'v1.x', 'calendar.google.com')`,
      ),
    ).toMatch(/permission denied/);
    await asServer();
    const { id } = await one<{ id: string }>(
      `insert into calendar_subscriptions (user_id, name, url_cipher, url_hint) values ($1, 'Google', 'v1.secret', 'calendar.google.com') returning id`,
      [owner],
    );
    expect(
      await fails(owner, `select url_cipher from calendar_subscriptions where id = $1`, [id]),
    ).toMatch(/permission denied/);
    const mine = await as(owner, () =>
      rows<{ name: string }>(
        `select name, url_hint, busy from calendar_subscriptions where id = $1`,
        [id],
      ),
    );
    expect(mine).toHaveLength(1);
    // Rename and hide yes; the busy times and the status are the server's.
    expect(
      await fails(
        owner,
        `update calendar_subscriptions set name = 'Work', show_in_calendar = false where id = $1`,
        [id],
      ),
    ).toBe("ok");
    expect(
      await fails(owner, `update calendar_subscriptions set busy = '[]' where id = $1`, [id]),
    ).toMatch(/permission denied/);
    expect(
      await fails(owner, `update calendar_subscriptions set last_status = 'ok' where id = $1`, [
        id,
      ]),
    ).toMatch(/permission denied/);
    // Nobody else sees it.
    expect(
      await as(worker, () => rows(`select 1 from calendar_subscriptions where id = $1`, [id])),
    ).toEqual([]);
    expect(await fails(owner, `delete from calendar_subscriptions where id = $1`, [id])).toBe("ok");
  });

  it("at most ten per account", async () => {
    await asServer();
    const account = await createAuthUser();
    for (let i = 0; i < 10; i++) {
      await db.query(
        `insert into calendar_subscriptions (user_id, name, url_cipher, url_hint) values ($1, $2, 'v1.x', 'example.com')`,
        [account, `C${i}`],
      );
    }
    await expect(
      db.query(
        `insert into calendar_subscriptions (user_id, name, url_cipher, url_hint) values ($1, 'C10', 'v1.x', 'example.com')`,
        [account],
      ),
    ).rejects.toThrow(/too_many/);
  });

  it("the feed secret is the server's alone", async () => {
    expect(await fails(owner, `select * from calendar_feed_tokens`)).toMatch(/permission denied/);
    expect(
      await fails(
        owner,
        `insert into calendar_feed_tokens (user_id, token_hash) values (auth.uid(), $1)`,
        ["a".repeat(64)],
      ),
    ).toMatch(/permission denied/);
  });
});

describe("bookings", () => {
  let ownerBooking: string;
  let workerBooking: string;

  beforeAll(async () => {
    await asServer();
    const make = async (host: string, type: string, hours: number) =>
      (
        await one<{ id: string }>(
          `insert into bookings (event_type_id, host_user_id, space_id, starts_at, ends_at, guest_name, guest_email, status, manage_token_hash)
           values ($1, $2, $3, now() + make_interval(hours => $4), now() + make_interval(hours => $4) + interval '30 minutes',
                   'Jana', 'jana@example.com', 'confirmed', $5) returning id`,
          [type, host, owner, hours, crypto.randomUUID().replace(/-/g, "").padEnd(64, "0")],
        )
      ).id;
    ownerBooking = await make(owner, ownerType, 30);
    workerBooking = await make(worker, workerType, 31);
  });

  it("the host reads their own, the owner every one of the space, nobody else any", async () => {
    const seen = async (uid: string) =>
      (
        await as(uid, () =>
          rows<{ id: string }>(`select id from bookings where space_id = $1`, [owner]),
        )
      )
        .map((row) => row.id)
        .sort();
    expect(await seen(owner)).toEqual([ownerBooking, workerBooking].sort());
    expect(await seen(worker)).toEqual([workerBooking]);
    expect(await seen(viewer)).toEqual([]);
    expect(await seen(stranger)).toEqual([]);
  });

  it("the client writes none and never reads the guest's token", async () => {
    expect(
      await fails(owner, `update bookings set status = 'cancelled' where id = $1`, [ownerBooking]),
    ).toMatch(/permission denied/);
    expect(await fails(owner, `delete from bookings where id = $1`, [ownerBooking])).toMatch(
      /permission denied/,
    );
    expect(
      await fails(owner, `select manage_token_hash from bookings where id = $1`, [ownerBooking]),
    ).toMatch(/permission denied/);
    const counts = await as(owner, () =>
      rows<{ event_type_id: string; bookings: number }>(
        `select * from scheduler_booking_counts(now() - interval '30 days') order by event_type_id`,
      ),
    );
    expect(counts.map((row) => row.bookings)).toEqual([1, 1]);
  });

  it("two active bookings never hold the same time of one host", async () => {
    await asServer();
    const { starts_at } = await one<{ starts_at: string }>(
      `select starts_at from bookings where id = $1`,
      [ownerBooking],
    );
    await expect(
      db.query(
        `insert into bookings (host_user_id, space_id, starts_at, ends_at, guest_name, guest_email, status)
         values ($1, $1, $2, $2::timestamptz + interval '30 minutes', 'Petr', 'petr@example.com', 'held')`,
        [owner, starts_at],
      ),
    ).rejects.toThrow(/duplicate|unique/);
    // A cancelled one leaves the time free.
    await db.query(
      `insert into bookings (host_user_id, space_id, starts_at, ends_at, guest_name, guest_email, status)
       values ($1, $1, $2, $2::timestamptz + interval '30 minutes', 'Petr', 'petr@example.com', 'cancelled')`,
      [owner, starts_at],
    );
  });

  it("the worker loses everything with the right", async () => {
    await asServer();
    await db.query(
      `update worker_permission_grants set allowed = false where section = 'scheduler' and owner_id = $1`,
      [owner],
    );
    expect(
      await as(worker, () => rows(`select 1 from bookings where space_id = $1`, [owner])),
    ).toEqual([]);
    expect(
      await as(worker, () => rows(`select 1 from scheduler_profiles where space_id = $1`, [owner])),
    ).toEqual([]);
    expect(
      await fails(worker, `update event_types set name = 'x' where id = $1 returning id`, [
        workerType,
      ]),
    ).toBe("ok");
    expect(
      (await one<{ name: string }>(`select name from event_types where id = $1`, [workerType]))
        .name,
    ).toBe("Call");
  });
});
