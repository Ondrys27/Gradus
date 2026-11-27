// @vitest-environment node
//
// Online status in the company (step 30.5) in the real migrations on PGlite:
// the last moment is written only by presence_touch (at most once a minute,
// nothing for someone who hides their status), read only through
// presence_people (the people of the caller's own spaces, never a former
// worker or a stranger), turning the switch off hides the account both ways
// and forgets its moment, the client can not touch the table, and the
// private channel presence:<space> lets in only members who show their status.

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
create schema realtime;
create table realtime.messages (
  id bigint generated always as identity primary key,
  topic text not null,
  extension text not null,
  payload jsonb
);
create function realtime.topic() returns text language sql stable as $$
  select nullif(current_setting('realtime.topic', true), '')
$$;
alter table realtime.messages enable row level security;
grant usage on schema realtime to authenticated;
grant select, insert on realtime.messages to authenticated;
grant usage on schema public, auth, storage, extensions to anon, authenticated, service_role, supabase_auth_admin;
alter default privileges in schema public grant all on tables to authenticated, service_role;
alter default privileges in schema public grant all on functions to authenticated, service_role;
alter default privileges in schema public grant all on sequences to authenticated, service_role;
`;

type Row = Record<string, unknown>;
type PersonRow = { space_id: string; user_id: string; last_seen_at: string | null };

let db: PGlite;
let owner: string;
let alice: string;
let bob: string;
let former: string;
let stranger: string;
let otherOwner: string;

async function rows<T = Row>(sql: string, params?: unknown[]): Promise<T[]> {
  return (await db.query<T>(sql, params as never)).rows;
}
async function one<T = Row>(sql: string, params?: unknown[]): Promise<T> {
  return (await rows<T>(sql, params))[0] as T;
}
async function asUser(uid: string, space: string = uid) {
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid]);
  await db.query(`select set_config('request.headers', $1, false)`, [
    JSON.stringify({ "x-gradus-space": space }),
  ]);
  await db.exec(`set role authenticated`);
}
async function asServer() {
  await db.exec(
    `reset role; select set_config('request.jwt.claim.sub', '', false); select set_config('request.headers', '', false); select set_config('realtime.topic', '', false);`,
  );
}
async function createAuthUser() {
  const { id } = await one<{ id: string }>(
    `insert into auth.users (email, raw_user_meta_data) values ($1, '{"locale":"cs"}') returning id`,
    [`${crypto.randomUUID()}@example.com`],
  );
  return id;
}
async function hire(company: string, account: string, name: string, status = "active") {
  await asServer();
  await db.query(`insert into workers (owner_id, user_id, name, status) values ($1, $2, $3, $4)`, [
    company,
    account,
    name,
    status,
  ]);
}
async function touch(uid: string, leaving = false) {
  await asUser(uid);
  try {
    await db.query(`select presence_touch($1)`, [leaving]);
  } finally {
    await asServer();
  }
}
async function lastSeen(uid: string): Promise<string | null> {
  await asServer();
  const row = await one<{ at: string | null } | undefined>(
    `select last_seen_at::text as at from presence_last_seen where user_id = $1`,
    [uid],
  );
  return row?.at ?? null;
}
async function ageBy(uid: string, seconds: number) {
  await asServer();
  await db.query(
    `update presence_last_seen set last_seen_at = last_seen_at - make_interval(secs => $2) where user_id = $1`,
    [uid, seconds],
  );
}
async function peopleOf(uid: string): Promise<PersonRow[]> {
  await asUser(uid);
  try {
    return await rows<PersonRow>(
      `select space_id, user_id, last_seen_at::text from presence_people()`,
    );
  } finally {
    await asServer();
  }
}
async function setShown(uid: string, shown: boolean) {
  await asUser(uid);
  try {
    await db.query(`update user_settings set show_online = $2 where user_id = $1`, [uid, shown]);
  } finally {
    await asServer();
  }
}
async function onTopic(uid: string, topic: string, extension: "broadcast" | "presence") {
  await asUser(uid);
  await db.query(`select set_config('realtime.topic', $1, false)`, [topic]);
  try {
    const received = await rows(
      `select id from realtime.messages where topic = $1 and extension = $2`,
      [topic, extension],
    );
    let sent = true;
    try {
      await db.query(`insert into realtime.messages (topic, extension) values ($1, $2)`, [
        topic,
        extension,
      ]);
    } catch {
      sent = false;
    }
    return { received: received.length, sent };
  } finally {
    await asServer();
  }
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
  alice = await createAuthUser();
  bob = await createAuthUser();
  former = await createAuthUser();
  stranger = await createAuthUser();
  otherOwner = await createAuthUser();
  await hire(owner, alice, "Alice");
  await hire(owner, bob, "Bob");
  await hire(owner, former, "Former");
  await asServer();
  await db.query(`update workers set status = 'inactive' where user_id = $1`, [former]);
  await hire(otherOwner, alice, "Alice");
  for (const uid of [owner, alice, bob, former, stranger, otherOwner]) await touch(uid);
  await asServer();
  await db.query(
    `insert into realtime.messages (topic, extension) values ($1, 'presence'), ($1, 'broadcast')`,
    [`presence:${owner}`],
  );
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe("presence: the last moment", () => {
  it("is written by presence_touch, at most once a minute", async () => {
    const first = await lastSeen(bob);
    expect(first).not.toBeNull();
    await touch(bob);
    expect(await lastSeen(bob)).toBe(first);
    await ageBy(bob, 61);
    const aged = await lastSeen(bob);
    await touch(bob);
    expect(await lastSeen(bob)).not.toBe(aged);
  });

  it("is written on leaving after a few seconds, not more often", async () => {
    await ageBy(bob, 3);
    const recent = await lastSeen(bob);
    await touch(bob, true);
    expect(await lastSeen(bob)).toBe(recent);
    await ageBy(bob, 10);
    const older = await lastSeen(bob);
    await touch(bob, true);
    expect(await lastSeen(bob)).not.toBe(older);
  });

  it("is out of the client's reach: no reading, writing or deleting", async () => {
    await asUser(bob);
    await expect(db.query(`select * from presence_last_seen`)).rejects.toThrow(/permission denied/);
    await expect(
      db.query(`insert into presence_last_seen (user_id, last_seen_at) values ($1, now())`, [bob]),
    ).rejects.toThrow(/permission denied/);
    await expect(db.query(`update presence_last_seen set last_seen_at = now()`)).rejects.toThrow(
      /permission denied/,
    );
    await expect(db.query(`delete from presence_last_seen`)).rejects.toThrow(/permission denied/);
    await asServer();
  });

  it("is refused to the anonymous role", async () => {
    await asServer();
    await db.exec(`set role anon`);
    await expect(db.query(`select presence_touch(false)`)).rejects.toThrow(/permission denied/);
    await expect(db.query(`select * from presence_people()`)).rejects.toThrow(/permission denied/);
    await asServer();
  });
});

describe("presence: who sees whom", () => {
  it("gives the owner their company: themselves and the active workers, never a former one", async () => {
    const people = await peopleOf(owner);
    expect(people.every((row) => row.space_id === owner)).toBe(true);
    expect(people.map((row) => row.user_id).sort()).toEqual([owner, alice, bob].sort());
    expect(people.every((row) => row.last_seen_at !== null)).toBe(true);
  });

  it("gives a worker every company they work for and their own space", async () => {
    const people = await peopleOf(alice);
    const spaces = [...new Set(people.map((row) => row.space_id))].sort();
    expect(spaces).toEqual([owner, alice, otherOwner].sort());
    expect(
      people
        .filter((row) => row.space_id === otherOwner)
        .map((row) => row.user_id)
        .sort(),
    ).toEqual([otherOwner, alice].sort());
    // Bob is not in the other company, so nobody there learns about him.
    expect(
      people.filter((row) => row.space_id === otherOwner).some((row) => row.user_id === bob),
    ).toBe(false);
  });

  it("gives a former worker and a stranger only their own space", async () => {
    for (const uid of [former, stranger]) {
      const people = await peopleOf(uid);
      expect(people.map((row) => [row.space_id, row.user_id])).toEqual([[uid, uid]]);
    }
  });
});

describe("presence: the switch", () => {
  it("is on by default", async () => {
    await asServer();
    const row = await one<{ show_online: boolean }>(
      `select show_online from user_settings where user_id = $1`,
      [stranger],
    );
    expect(row.show_online).toBe(true);
  });

  it("off hides the account from everybody, the owner too, and forgets the moment", async () => {
    await setShown(bob, false);
    expect(await lastSeen(bob)).toBeNull();
    expect((await peopleOf(owner)).some((row) => row.user_id === bob)).toBe(false);
    expect((await peopleOf(alice)).some((row) => row.user_id === bob)).toBe(false);
    await touch(bob);
    expect(await lastSeen(bob)).toBeNull();
  });

  it("off shows the account nobody else either", async () => {
    expect(await peopleOf(bob)).toEqual([]);
  });

  it("on again shows the account from the next moment", async () => {
    await setShown(bob, true);
    await touch(bob);
    expect(await lastSeen(bob)).not.toBeNull();
    expect((await peopleOf(owner)).some((row) => row.user_id === bob)).toBe(true);
  });
});

describe("presence: the private channel presence:<space>", () => {
  it("lets the owner and the active workers be present and hear each other", async () => {
    for (const uid of [owner, alice, bob]) {
      const presence = await onTopic(uid, `presence:${owner}`, "presence");
      expect(presence.received).toBeGreaterThan(0);
      expect(presence.sent).toBe(true);
    }
  });

  it("keeps out a former worker, a stranger, broadcasts and other topics", async () => {
    expect(await onTopic(former, `presence:${owner}`, "presence")).toEqual({
      received: 0,
      sent: false,
    });
    expect(await onTopic(stranger, `presence:${owner}`, "presence")).toEqual({
      received: 0,
      sent: false,
    });
    expect(await onTopic(alice, `presence:${owner}`, "broadcast")).toEqual({
      received: 0,
      sent: false,
    });
    expect(await onTopic(alice, `presence:not-a-uuid`, "presence")).toEqual({
      received: 0,
      sent: false,
    });
    expect(await onTopic(alice, `space:${owner}`, "presence")).toEqual({
      received: 0,
      sent: false,
    });
  });

  it("keeps out a member who hides their status", async () => {
    await setShown(alice, false);
    expect(await onTopic(alice, `presence:${owner}`, "presence")).toEqual({
      received: 0,
      sent: false,
    });
    await setShown(alice, true);
    expect((await onTopic(alice, `presence:${owner}`, "presence")).sent).toBe(true);
  });
});
