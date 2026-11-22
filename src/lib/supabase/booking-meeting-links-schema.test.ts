// @vitest-environment node
//
// The call's link of a booking (27.5) on the real migrations (PGlite): every
// booking has its own room on Jitsi (two bookings never the same), the host's
// own link of one meeting only through the server's function, only for a live
// video meeting and only https, the "send the link" task made once on the
// booking's contact for the host, the type's choice of a room, and that the
// client reads the link of its own bookings but calls none of it.

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
let ownerType: string;
let phoneType: string;

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
  ownerType = await makeType(owner, ownerProfile, "konzultace");
  phoneType = await makeType(owner, ownerProfile, "telefon");
  await asServer();
  await db.query(`update event_types set location_kind = 'phone' where id = $1`, [phoneType]);
}, 120_000);

afterAll(async () => {
  await db?.close();
});

const TOKEN = (n: number) => n.toString(16).padStart(64, "0");
const VISITOR = (n: number) => n.toString(16).padStart(16, "a");
function tomorrowAt(hour: number, minute = 0): string {
  const day = new Date(Date.now() + 86_400_000);
  day.setUTCHours(hour, minute, 0, 0);
  return day.toISOString();
}

/** A confirmed booking of `type` at `start`, with its contact (the effects). */
async function confirmedBooking(type: string, start: string, n: number): Promise<string> {
  await asServer();
  const { result } = await one<{ result: { id: string } }>(
    `select scheduler_hold($1, $2::timestamptz, $3, $4, 'Europe/Prague', null) as result`,
    [type, start, TOKEN(n), VISITOR(n)],
  );
  await db.query(
    `select scheduler_book($1, $2, $3, 'Jan Novák', $4, null, null, 'Europe/Prague', 'cs', '{}'::jsonb, $5)`,
    [result.id, TOKEN(n), TOKEN(n + 1000), `jan${n}@example.com`, VISITOR(n)],
  );
  await db.query(
    `select scheduler_booking_effects($1, true, 'Konzultace · Jan', '', '', 'Jan', 'CZ')`,
    [result.id],
  );
  return result.id;
}

async function setLink(id: string, link: string | null) {
  await asServer();
  return db.query<{ result: { previous: string | null; link: string | null } }>(
    `select scheduler_set_meeting_link($1, $2) as result`,
    [id, link],
  ).then(
    (out) => out.rows[0]!.result,
    (error: { message?: string }) => error.message ?? "error",
  );
}

describe("a room for every booking", () => {
  it("each booking gets its own room name, never the same twice", async () => {
    const first = await confirmedBooking(ownerType, tomorrowAt(8), 1);
    const second = await confirmedBooking(ownerType, tomorrowAt(9), 2);
    const rooms = await rows<{ video_room: string }>(
      `select video_room from bookings where id in ($1, $2)`,
      [first, second],
    );
    expect(rooms).toHaveLength(2);
    for (const { video_room } of rooms) expect(video_room).toMatch(/^gradus-[a-km-np-z2-9]{12}$/);
    expect(rooms[0]!.video_room).not.toBe(rooms[1]!.video_room);
    // A thousand more names, no two the same.
    const many = await rows<{ room: string }>(
      `select public.scheduler_new_room() as room from generate_series(1, 1000)`,
    );
    expect(new Set(many.map((row) => row.room)).size).toBe(1000);
  });

  it("the type asks for a room only with a known choice, the owner may not change a worker's", async () => {
    expect(
      await fails(owner, `update event_types set video_source = 'jitsi' where id = $1`, [ownerType]),
    ).toBe("ok");
    expect(
      await fails(owner, `update event_types set video_source = 'zoom' where id = $1`, [ownerType]),
    ).toMatch(/check/);
    const workerProfile = await makeProfile(worker, owner, "pepa-novak");
    const workerType = await makeType(worker, workerProfile, "uvod");
    expect(
      await fails(owner, `update event_types set video_source = 'jitsi' where id = $1`, [workerType]),
    ).toMatch(/not_allowed/);
  });
});

describe("the host's own link of one meeting", () => {
  it("only https, an empty one goes back to the type's, the previous one is returned", async () => {
    const id = await confirmedBooking(ownerType, tomorrowAt(10), 3);
    expect(await setLink(id, "http://meet.google.com/abc")).toMatch(/invalid_link/);
    expect(await setLink(id, "https://meet.google.com/abc-defg-hij")).toEqual(
      expect.objectContaining({ previous: null, link: "https://meet.google.com/abc-defg-hij" }),
    );
    expect(await setLink(id, "  ")).toEqual(
      expect.objectContaining({ previous: "https://meet.google.com/abc-defg-hij", link: null }),
    );
    expect(await one(`select meeting_link from bookings where id = $1`, [id])).toEqual({
      meeting_link: null,
    });
  });

  it("only a live video meeting before its end", async () => {
    const phone = await confirmedBooking(phoneType, tomorrowAt(11), 4);
    expect(await setLink(phone, "https://meet.example.com/x")).toMatch(/invalid_state/);
    const cancelled = await confirmedBooking(ownerType, tomorrowAt(12), 5);
    await db.query(`select scheduler_cancel($1, 'guest', null)`, [cancelled]);
    expect(await setLink(cancelled, "https://meet.example.com/x")).toMatch(/invalid_state/);
  });

  it("the client calls none of it and writes no link, but reads its own", async () => {
    const id = await confirmedBooking(ownerType, tomorrowAt(13), 6);
    expect(await fails(owner, `select scheduler_set_meeting_link($1, 'https://a.example.com/x')`, [id])).toMatch(
      /permission denied/,
    );
    expect(await fails(owner, `select scheduler_link_task($1, 't', null, now())`, [id])).toMatch(
      /permission denied/,
    );
    expect(await fails(owner, `select scheduler_new_room()`)).toMatch(/permission denied/);
    expect(
      await fails(owner, `update bookings set meeting_link = 'https://a.example.com/x' where id = $1`, [id]),
    ).toMatch(/permission denied/);
    const seen = await as(owner, () =>
      rows<{ video_room: string | null }>(`select meeting_link, video_room from bookings where id = $1`, [id]),
    );
    expect(seen[0]?.video_room).toMatch(/^gradus-/);
    expect(
      await as(stranger, () => rows(`select video_room from bookings where space_id = $1`, [owner])),
    ).toHaveLength(0);
  });
});

describe("the host's task to send the link", () => {
  it("made once for a confirmed booking, on its contact, for the host", async () => {
    const id = await confirmedBooking(ownerType, tomorrowAt(14), 7);
    const due = tomorrowAt(13);
    const { first } = await one<{ first: string }>(
      `select scheduler_link_task($1, 'Pošli odkaz', 'Otevři rezervaci', $2::timestamptz) as first`,
      [id, due],
    );
    const { again } = await one<{ again: string }>(
      `select scheduler_link_task($1, 'Pošli odkaz', null, $2::timestamptz) as again`,
      [id, due],
    );
    expect(first).toBeTruthy();
    expect(again).toBe(first);
    const task = await one<Row>(
      `select t.user_id, t.assignee_id, t.created_by, t.status, t.duration_minutes, t.contact_id = b.contact_id as on_contact
       from crm_tasks t join bookings b on b.link_task_id = t.id where t.id = $1`,
      [first],
    );
    expect(task).toEqual({
      user_id: owner,
      assignee_id: owner,
      created_by: owner,
      status: "open",
      duration_minutes: 5,
      on_contact: true,
    });
  });

  it("nothing for a booking that is not confirmed", async () => {
    const id = await confirmedBooking(ownerType, tomorrowAt(15), 8);
    await db.query(`select scheduler_cancel($1, 'host', null)`, [id]);
    const { task } = await one<{ task: string | null }>(
      `select scheduler_link_task($1, 'Pošli odkaz', null, now()) as task`,
      [id],
    );
    expect(task).toBeNull();
  });
});
