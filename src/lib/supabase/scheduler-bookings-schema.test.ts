// @vitest-environment node
//
// Bookings of the scheduler (24.4) on the real migrations (PGlite): a held
// time (one per visitor, never two guests on the same or an overlapping
// time, expired holds cleared, the hourly limits), the booking from a hold
// (its secret, confirmed or pending), what a booking does in the space (the
// contact matched or made, the meeting in the calendar the client cannot
// touch, Meeting scheduled and a deal once confirmed, nothing in the shared
// chart of calling times), the host's decisions, a move and a cancellation,
// and that only the server calls any of it.

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

const TOKEN = (n: number) => n.toString(16).padStart(64, "0");
const VISITOR = (n: number) => n.toString(16).padStart(16, "a");
/** Tomorrow at a whole hour, as ISO. */
function tomorrowAt(hour: number, minute = 0): string {
  const day = new Date(Date.now() + 86_400_000);
  day.setUTCHours(hour, minute, 0, 0);
  return day.toISOString();
}

async function hold(
  type: string,
  start: string,
  token: string,
  visitor: string,
  release: string | null = null,
): Promise<string> {
  await asServer();
  const { result } = await one<{ result: { id: string } }>(
    `select scheduler_hold($1, $2::timestamptz, $3, $4, 'Europe/Prague', $5) as result`,
    [type, start, token, visitor, release],
  );
  return result.id;
}
async function holdFails(type: string, start: string, token: string, visitor: string) {
  await asServer();
  return db
    .query(`select scheduler_hold($1, $2::timestamptz, $3, $4)`, [type, start, token, visitor])
    .then(
      () => "ok",
      (error: { message?: string }) => error.message ?? "error",
    );
}
async function book(id: string, token: string, newToken: string, email: string, visitor = VISITOR(1)) {
  await asServer();
  return one<{ result: { status: string } }>(
    `select scheduler_book($1, $2, $3, 'Jan Novák', $4, '+420777123456', 'Novák s.r.o.', 'Europe/Prague', 'cs', '{"note":"hi"}'::jsonb, $5) as result`,
    [id, token, newToken, email, visitor],
  );
}
async function effects(id: string, confirming: boolean) {
  await asServer();
  return (
    await one<{
      result: {
        contact_id: string;
        calendar_event_id: string | null;
        deal_id: string | null;
        created_contact: boolean;
        moved: boolean;
      };
    }>(
      `select scheduler_booking_effects($1, $2, 'Konzultace · Jan Novák', 'Poznámka: hi', 'https://meet.example.com/x', 'Novák s.r.o.', 'CZ') as result`,
      [id, confirming],
    )
  ).result;
}

describe("holding a time", () => {
  it("two guests never get the same or an overlapping time", async () => {
    const start = tomorrowAt(9);
    await hold(ownerType, start, TOKEN(1), VISITOR(1));
    expect(await holdFails(ownerType, start, TOKEN(2), VISITOR(2))).toMatch(/slot_taken/);
    // 30 minutes long: 9:15 overlaps, 9:30 does not.
    expect(await holdFails(ownerType, tomorrowAt(9, 15), TOKEN(3), VISITOR(2))).toMatch(
      /slot_taken/,
    );
    expect(await hold(ownerType, tomorrowAt(9, 30), TOKEN(4), VISITOR(2))).toBeTruthy();
    // Another host is not affected.
    expect(await hold(workerType, start, TOKEN(5), VISITOR(3))).toBeTruthy();
  });

  it("a visitor's next hold releases their previous one; expired holds go", async () => {
    const first = await hold(ownerType, tomorrowAt(11), TOKEN(10), VISITOR(4));
    const second = await hold(ownerType, tomorrowAt(12), TOKEN(11), VISITOR(4), first);
    expect(second).not.toBe(first);
    expect(await rows(`select 1 from bookings where id = $1`, [first])).toHaveLength(0);
    // Somebody else's id releases nothing.
    await hold(ownerType, tomorrowAt(13), TOKEN(12), VISITOR(5), second);
    expect(await rows(`select 1 from bookings where id = $1`, [second])).toHaveLength(1);

    // An expired hold frees its time.
    await db.query(`update bookings set hold_expires_at = now() - interval '1 minute' where id = $1`, [
      second,
    ]);
    expect(await hold(ownerType, tomorrowAt(12), TOKEN(13), VISITOR(6))).toBeTruthy();
    expect(await rows(`select 1 from bookings where id = $1`, [second])).toHaveLength(0);
  });

  it("never in the past, never for a type that is off", async () => {
    expect(
      await holdFails(ownerType, new Date(Date.now() - 3_600_000).toISOString(), TOKEN(20), VISITOR(7)),
    ).toMatch(/slot_taken/);
    const off = await makeType(owner, ownerProfile, "vypnuty", false);
    expect(await holdFails(off, tomorrowAt(15), TOKEN(21), VISITOR(7))).toMatch(/not_found/);
  });

  it("a visitor holds at most 30 times an hour", async () => {
    const visitor = VISITOR(8);
    let last = "";
    for (let i = 0; i < 30; i++) {
      await asServer();
      await db.query(`insert into scheduler_rate_events (client_hash, kind) values ($1, 'hold')`, [
        visitor,
      ]);
    }
    last = await holdFails(ownerType, tomorrowAt(16), TOKEN(30), visitor);
    expect(last).toMatch(/rate_limited/);
  });
});

describe("booking a held time", () => {
  it("only with the hold's secret, before it expires; pending when the type asks", async () => {
    const id = await hold(ownerType, tomorrowAt(14), TOKEN(40), VISITOR(9));
    const wrong = await db
      .query(
        `select scheduler_book($1, $2, $3, 'X', 'x@example.com', null, null, null, 'en', '{}'::jsonb, $4)`,
        [id, TOKEN(99), TOKEN(41), VISITOR(9)],
      )
      .then(
        () => "ok",
        (error: { message?: string }) => error.message ?? "",
      );
    expect(wrong).toMatch(/hold_expired/);
    const { result } = await book(id, TOKEN(40), TOKEN(41), "JAN@Example.com", VISITOR(9));
    expect(result.status).toBe("confirmed");
    const row = await one<Row>(
      `select status, guest_email, manage_token_hash, hold_expires_at, confirmed_at, locale from bookings where id = $1`,
      [id],
    );
    expect(row).toMatchObject({
      status: "confirmed",
      guest_email: "jan@example.com",
      manage_token_hash: TOKEN(41),
      hold_expires_at: null,
      locale: "cs",
    });
    expect(row.confirmed_at).not.toBeNull();

    await asServer();
    await db.query(`update event_types set requires_approval = true where id = $1`, [workerType]);
    const pendingId = await hold(workerType, tomorrowAt(14), TOKEN(42), VISITOR(10));
    const pending = await book(pendingId, TOKEN(42), TOKEN(43), "eva@example.com", VISITOR(10));
    expect(pending.result.status).toBe("pending");
  });

  it("an expired hold cannot be booked", async () => {
    const id = await hold(ownerType, tomorrowAt(17), TOKEN(50), VISITOR(11));
    await db.query(`update bookings set hold_expires_at = now() - interval '1 second' where id = $1`, [
      id,
    ]);
    const answer = await book(id, TOKEN(50), TOKEN(51), "late@example.com", VISITOR(11)).then(
      () => "ok",
      (error: { message?: string }) => error.message ?? "",
    );
    expect(answer).toMatch(/hold_expired/);
  });
});

describe("what a booking does in the space", () => {
  let booking: string;

  beforeAll(async () => {
    booking = await hold(ownerType, tomorrowAt(18), TOKEN(60), VISITOR(12));
    await book(booking, TOKEN(60), TOKEN(61), "petr@example.com", VISITOR(12));
  });

  it("matches the contact by e-mail, else makes one from the scheduler", async () => {
    await asServer();
    const { id: existing } = await one<{ id: string }>(
      `insert into contacts (user_id, first_name, email) values ($1, 'Petr', 'Petr@Example.com') returning id`,
      [owner],
    );
    const first = await effects(booking, true);
    expect(first.contact_id).toBe(existing);
    expect(first.created_contact).toBe(false);

    const other = await hold(ownerType, tomorrowAt(19), TOKEN(62), VISITOR(13));
    await book(other, TOKEN(62), TOKEN(63), "nova@example.com", VISITOR(13));
    const made = await effects(other, false);
    expect(made.created_contact).toBe(true);
    expect(
      await one<Row>(
        `select first_name, last_name, email, phone, company_name, source, country_code from contacts where id = $1`,
        [made.contact_id],
      ),
    ).toMatchObject({
      first_name: "Jan",
      last_name: "Novák",
      email: "nova@example.com",
      phone: "+420777123456",
      company_name: "Novák s.r.o.",
      source: "scheduler",
      country_code: "CZ",
    });
  });

  it("puts a meeting in the host's calendar that the client cannot change or delete", async () => {
    const { calendar_event_id: event } = await effects(booking, false);
    expect(event).toBeTruthy();
    expect(
      await one<Row>(
        `select kind, source, actor_id, user_id, title, location from calendar_events where id = $1`,
        [event],
      ),
    ).toMatchObject({
      kind: "meeting",
      source: "booking",
      actor_id: owner,
      user_id: owner,
      title: "Konzultace · Jan Novák",
      location: "https://meet.example.com/x",
    });
    expect(
      await fails(owner, `update calendar_events set title = 'x' where id = $1`, [event]),
    ).toMatch(/calendar_event_from_booking/);
    expect(await fails(owner, `delete from calendar_events where id = $1`, [event])).toMatch(
      /calendar_event_from_booking/,
    );
    // The same booking keeps one meeting, however often the effects run.
    expect((await effects(booking, false)).calendar_event_id).toBe(event);
  });

  it("once confirmed: Meeting scheduled (not in the call chart) and a deal in the type's stage", async () => {
    await asServer();
    const { id: stage } = await one<{ id: string }>(
      `select id from pipeline_stages where user_id = $1 and system_key = 'meeting'`,
      [owner],
    );
    await db.query(`update event_types set deal_stage_id = $2 where id = $1`, [ownerType, stage]);
    const other = await hold(ownerType, tomorrowAt(20), TOKEN(64), VISITOR(14));
    await book(other, TOKEN(64), TOKEN(65), "deal@example.com", VISITOR(14));
    const result = await effects(other, true);
    expect(result.moved).toBe(true);
    expect(result.deal_id).toBeTruthy();
    expect(
      await one<Row>(
        `select t.system_key from contact_table_entries e join contact_tables t on t.id = e.table_id
         where e.contact_id = $1`,
        [result.contact_id],
      ),
    ).toMatchObject({ system_key: "meeting_scheduled" });
    expect(
      await one<Row>(`select source, actor_id from contact_table_moves where contact_id = $1`, [
        result.contact_id,
      ]),
    ).toMatchObject({ source: "scheduler", actor_id: owner });
    expect(
      await one<Row>(
        `select stage_id, contact_id, assignee_id, created_by, title from deals where id = $1`,
        [result.deal_id],
      ),
    ).toMatchObject({
      stage_id: stage,
      contact_id: result.contact_id,
      assignee_id: owner,
      created_by: owner,
      title: "Novák s.r.o.",
    });
    expect(
      await one<Row>(`select deal_id from calendar_events where id = $1`, [
        result.calendar_event_id,
      ]),
    ).toMatchObject({ deal_id: result.deal_id });
    // Effects again: no second deal, no second move.
    const again = await effects(other, true);
    expect(again.deal_id).toBe(result.deal_id);
    expect(again.moved).toBe(false);

    // The shared chart: the scheduler's move is no call attempt.
    await asServer();
    await db.query(`update user_settings set country_code = 'CZ' where user_id = $1`, [owner]);
    await db.query(`select refresh_call_time_stats()`);
    const stats = await one<{ n: number }>(
      `select coalesce(sum(attempts), 0)::int as n from call_time_stats`,
    );
    expect(stats.n).toBe(0);
  });

  it("never moves a client out of Clients", async () => {
    await asServer();
    const { id: contact } = await one<{ id: string }>(
      `insert into contacts (user_id, first_name, email) values ($1, 'Klient', 'klient@example.com') returning id`,
      [owner],
    );
    await db.query(
      `update contact_table_entries set table_id = (select id from contact_tables where user_id = $1 and system_key = 'clients')
       where contact_id = $2`,
      [owner, contact],
    );
    const id = await hold(ownerType, tomorrowAt(21), TOKEN(66), VISITOR(15));
    await book(id, TOKEN(66), TOKEN(67), "klient@example.com", VISITOR(15));
    const result = await effects(id, true);
    expect(result.contact_id).toBe(contact);
    expect(result.moved).toBe(false);
  });
});

describe("the host's decisions and the guest's changes", () => {
  it("approve, decline, cancel only from the right state; a cancelled one leaves the calendar", async () => {
    await asServer();
    await db.query(`update event_types set requires_approval = true where id = $1`, [ownerType]);
    const id = await hold(ownerType, tomorrowAt(6), TOKEN(70), VISITOR(16));
    await book(id, TOKEN(70), TOKEN(71), "a@example.com", VISITOR(16));
    await effects(id, false);
    await db.query(`select scheduler_confirm($1)`, [id]);
    const again = await db.query(`select scheduler_confirm($1)`, [id]).then(
      () => "ok",
      (error: { message?: string }) => error.message ?? "",
    );
    expect(again).toMatch(/invalid_state/);
    const declined = await db.query(`select scheduler_decline($1, 'no')`, [id]).then(
      () => "ok",
      (error: { message?: string }) => error.message ?? "",
    );
    expect(declined).toMatch(/invalid_state/);

    const { calendar_event_id: event } = await effects(id, true);
    await db.query(`select scheduler_cancel($1, 'guest', 'Nemoc')`, [id]);
    await effects(id, false);
    expect(await rows(`select 1 from calendar_events where id = $1`, [event])).toHaveLength(0);
    expect(
      await one<Row>(`select status, cancelled_by, cancel_reason, contact_id from bookings where id = $1`, [id]),
    ).toMatchObject({ status: "cancelled", cancelled_by: "guest", cancel_reason: "Nemoc" });
    // Its time is free again.
    expect(await hold(ownerType, tomorrowAt(6), TOKEN(72), VISITOR(17))).toBeTruthy();
    await db.query(`update event_types set requires_approval = false where id = $1`, [ownerType]);
  });

  it("a move keeps the length and never lands on somebody else's time", async () => {
    const a = await hold(ownerType, tomorrowAt(7), TOKEN(80), VISITOR(18));
    await book(a, TOKEN(80), TOKEN(81), "move@example.com", VISITOR(18));
    const b = await hold(ownerType, tomorrowAt(8), TOKEN(82), VISITOR(19));
    await book(b, TOKEN(82), TOKEN(83), "other@example.com", VISITOR(19));
    await asServer();
    const taken = await db.query(`select scheduler_reschedule($1, $2::timestamptz)`, [a, tomorrowAt(8)]).then(
      () => "ok",
      (error: { message?: string }) => error.message ?? "",
    );
    expect(taken).toMatch(/slot_taken/);
    // Moving within its own time is fine (the booking itself does not count).
    await db.query(`select scheduler_reschedule($1, $2::timestamptz)`, [a, tomorrowAt(7, 15)]);
    const row = await one<{ starts_at: Date; ends_at: Date; reschedule_count: number }>(
      `select starts_at, ends_at, reschedule_count from bookings where id = $1`,
      [a],
    );
    expect(row.reschedule_count).toBe(1);
    expect(row.ends_at.getTime() - row.starts_at.getTime()).toBe(30 * 60_000);
  });

  it("a no-show only for a confirmed meeting that has started", async () => {
    const id = await hold(ownerType, tomorrowAt(22), TOKEN(90), VISITOR(20));
    await book(id, TOKEN(90), TOKEN(91), "noshow@example.com", VISITOR(20));
    const early = await db.query(`select scheduler_set_no_show($1, true)`, [id]).then(
      () => "ok",
      (error: { message?: string }) => error.message ?? "",
    );
    expect(early).toMatch(/invalid_state/);
    await db.query(
      `update bookings set starts_at = now() - interval '2 hours', ends_at = now() - interval '90 minutes' where id = $1`,
      [id],
    );
    await db.query(`select scheduler_set_no_show($1, true)`, [id]);
    expect(
      (await one<{ no_show_at: Date | null }>(`select no_show_at from bookings where id = $1`, [id]))
        .no_show_at,
    ).not.toBeNull();
  });
});

describe("only the server", () => {
  it("no client calls the booking functions or reads the visitor counts", async () => {
    for (const sql of [
      `select scheduler_hold('${crypto.randomUUID()}', now(), '${TOKEN(1)}', '${VISITOR(1)}')`,
      `select scheduler_book('${crypto.randomUUID()}', 'x', '${TOKEN(1)}', 'a', 'a@b.c', null, null, null, 'cs', '{}', '${VISITOR(1)}')`,
      `select scheduler_booking_effects('${crypto.randomUUID()}', true, 't', 'd', 'l', 'x')`,
      `select scheduler_confirm('${crypto.randomUUID()}')`,
      `select scheduler_cancel('${crypto.randomUUID()}', 'host', null)`,
      `select scheduler_reschedule('${crypto.randomUUID()}', now())`,
      `select scheduler_set_no_show('${crypto.randomUUID()}', true)`,
      `select scheduler_cleanup()`,
      `select * from scheduler_rate_events`,
      `select client_hash from bookings`,
    ]) {
      expect(await fails(owner, sql)).toMatch(/permission denied/);
    }
  });

  it("the host reads the new columns of their bookings, a stranger nothing", async () => {
    const seen = await as(owner, () =>
      rows(`select locale, confirmed_at, no_show_at, reschedule_count from bookings where space_id = $1`, [owner]),
    );
    expect(seen.length).toBeGreaterThan(0);
    expect(await as(stranger, () => rows(`select id from bookings where space_id = $1`, [owner]))).toHaveLength(0);
    expect(await as(viewer, () => rows(`select id from bookings where space_id = $1`, [owner]))).toHaveLength(0);
  });

  it("a survey names only a booking of its space and deal", async () => {
    await asServer();
    const { id, deal_id } = await one<{ id: string; deal_id: string }>(
      `select id, deal_id from bookings where deal_id is not null limit 1`,
    );
    const { id: otherDeal } = await one<{ id: string }>(
      `insert into deals (user_id, stage_id, title) select $1, id, 'Other' from pipeline_stages where user_id = $1 limit 1 returning id`,
      [owner],
    );
    expect(
      await fails(owner, `insert into meeting_surveys (user_id, deal_id, booking_id) values ($1, $2, $3)`, [
        owner,
        otherDeal,
        id,
      ]),
    ).toMatch(/booking_not_found/);
    expect(
      await fails(owner, `insert into meeting_surveys (user_id, deal_id, booking_id) values ($1, $2, $3)`, [
        owner,
        deal_id,
        id,
      ]),
    ).toBe("ok");
  });
});

describe("clean-up", () => {
  it("removes expired holds", async () => {
    const id = await hold(workerType, tomorrowAt(5), TOKEN(100), VISITOR(21));
    await db.query(`update bookings set hold_expires_at = now() - interval '1 minute' where id = $1`, [id]);
    await db.query(`select scheduler_cleanup()`);
    expect(await rows(`select 1 from bookings where id = $1`, [id])).toHaveLength(0);
  });
});
