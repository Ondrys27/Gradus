// @vitest-environment node
//
// Live writing of notes (step 28.4) in the real migrations on PGlite: the
// Yjs state is saved only through note_collab_save with the version lock
// (a stale base gets the stored state back, never overwrites it), a viewer
// and a stranger can not save it even by calling the function directly, the
// client can not write the state itself, any other change of the text drops
// it, live saves of several people share a version with every author, the
// close of a note ends the version, and the private channel note:<id> lets
// readers receive while only writers send.

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
type SaveRow = { status: string; version: number | null; ydoc: string | null; kind: string | null };

let db: PGlite;
let owner: string;
let alice: string;
let bob: string;
let stranger: string;
let team: string;
let aliceWorker: string;
let bobWorker: string;

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
async function hire(account: string, name: string) {
  await asServer();
  const { id } = await one<{ id: string }>(
    `insert into workers (owner_id, user_id, name, status) values ($1, $2, $3, 'active') returning id`,
    [owner, account, name],
  );
  return id;
}
async function addNote(uid: string, title: string) {
  await asUser(uid, owner);
  const { id } = await one<{ id: string }>(
    `insert into notes (user_id, space_id, title, content_text) values ($1, $2, $3, $3) returning id`,
    [uid, owner, title],
  );
  await asServer();
  return id;
}
async function share(uid: string, note: string, kind: "member" | "group", target: string, role: string) {
  await asUser(uid, owner);
  await db.query(`select note_share_set($1, null, $2, $3, $4, false)`, [note, kind, target, role]);
  await asServer();
}
/** note_collab_save as `uid`; the state is a few bytes standing for a Yjs update. */
async function save(
  uid: string,
  note: string,
  base: number,
  bytes: string,
  text: string,
  authors: string[] = [],
): Promise<SaveRow> {
  await asUser(uid, owner);
  try {
    return await one<SaveRow>(
      `select status, version, encode(ydoc, 'hex') as ydoc, kind
       from note_collab_save($1, $2, decode($3, 'hex'), 'text', $4, $5::jsonb, $4, $6::uuid[])`,
      [note, base, bytes, text, JSON.stringify({ type: "doc", content: [] }), authors],
    );
  } finally {
    await asServer();
  }
}
async function stored(note: string) {
  return one<{ ydoc: string | null; ydoc_version: number; content_text: string }>(
    `select encode(ydoc, 'hex') as ydoc, ydoc_version, content_text from notes where id = $1`,
    [note],
  );
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
  stranger = await createAuthUser();
  aliceWorker = await hire(alice, "Alice");
  bobWorker = await hire(bob, "Bob");
  await asServer();
  await db.query(`update profiles set display_name = 'Majitel' where id = $1`, [owner]);
  team = (
    await one<{ id: string }>(
      `insert into worker_groups (owner_id, name) values ($1, 'Obchod') returning id`,
      [owner],
    )
  ).id;
  await db.query(
    `insert into worker_group_members (group_id, worker_id, owner_id) values ($1, $2, $3)`,
    [team, aliceWorker, owner],
  );
  expect(bobWorker).toBeTruthy();
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe("notes live: the version lock", () => {
  let note: string;

  beforeAll(async () => {
    note = await addNote(owner, "Společný plán");
    await share(owner, note, "member", alice, "editor");
    await share(owner, note, "member", bob, "viewer");
  });

  it("starts without a state at version 0", async () => {
    expect(await stored(note)).toMatchObject({ ydoc: null, ydoc_version: 0 });
  });

  it("saves the owner's and an editor's state, one version up each time", async () => {
    expect(await save(owner, note, 0, "0101", "A")).toMatchObject({ status: "saved", version: 1 });
    expect(await save(alice, note, 1, "0102", "AB")).toMatchObject({ status: "saved", version: 2 });
    expect(await stored(note)).toEqual({ ydoc: "0102", ydoc_version: 2, content_text: "AB" });
  });

  it("never overwrites a newer state: a stale base gets the stored one back", async () => {
    const answer = await save(owner, note, 1, "0199", "stale");
    expect(answer).toEqual({ status: "conflict", version: 2, ydoc: "0102", kind: "text" });
    expect(await stored(note)).toMatchObject({ ydoc: "0102", ydoc_version: 2, content_text: "AB" });
  });

  it("refuses a viewer and a stranger, also when they call the function directly", async () => {
    expect(await save(bob, note, 2, "0666", "viewer")).toMatchObject({ status: "denied" });
    expect(await save(stranger, note, 2, "0666", "stranger")).toMatchObject({ status: "denied" });
    expect(await stored(note)).toMatchObject({ ydoc: "0102", ydoc_version: 2 });
  });

  it("does not let the client write the state or the version itself", async () => {
    await asUser(owner, owner);
    await expect(db.query(`update notes set ydoc = '\\x07' where id = $1`, [note])).rejects.toThrow(
      /permission denied/,
    );
    await expect(db.query(`update notes set ydoc_version = 9 where id = $1`, [note])).rejects.toThrow(
      /permission denied/,
    );
    await asServer();
  });

  it("drops the state when the text changes any other way, and moves the version", async () => {
    await asUser(owner, owner);
    await db.query(`update notes set content_text = 'jinak', title = 'jinak' where id = $1`, [note]);
    await asServer();
    expect(await stored(note)).toMatchObject({ ydoc: null, ydoc_version: 3 });
    // A browser still on version 2 hears about it instead of saving over it.
    expect(await save(alice, note, 2, "0103", "old")).toMatchObject({
      status: "conflict",
      version: 3,
      ydoc: null,
    });
  });

  it("keeps the state when only the pin changes", async () => {
    expect(await save(owner, note, 3, "0104", "znovu")).toMatchObject({ status: "saved", version: 4 });
    await asUser(owner, owner);
    await db.query(`update notes set pinned = true where id = $1`, [note]);
    await asServer();
    expect(await stored(note)).toMatchObject({ ydoc: "0104", ydoc_version: 4 });
  });

  it("answers missing for no note and deleted for one in the trash", async () => {
    expect(await save(owner, crypto.randomUUID(), 0, "01", "x")).toMatchObject({ status: "missing" });
    const gone = await addNote(owner, "Smazaná");
    await asUser(owner, owner);
    await db.query(`update notes set deleted_at = now() where id = $1`, [gone]);
    await asServer();
    expect(await save(owner, gone, 0, "01", "x")).toMatchObject({ status: "deleted" });
  });

  it("refuses the save in a read-only space", async () => {
    const frozen = await addNote(owner, "Zamrzlá");
    await asServer();
    await db.query(
      `update subscriptions set status = 'trialing', trial_ends_at = now() - interval '1 day',
         current_period_end = now() - interval '1 day' where user_id = $1`,
      [owner],
    );
    await expect(save(owner, frozen, 0, "01", "x")).rejects.toThrow(/read_only/);
    await db.query(
      `update subscriptions set trial_ends_at = now() + interval '10 days',
         current_period_end = now() + interval '10 days' where user_id = $1`,
      [owner],
    );
  });
});

describe("notes live: versions with every author", () => {
  it("keeps live saves of two people in one version with both names, a close starts the next", async () => {
    const note = await addNote(owner, "Porada");
    await share(owner, note, "member", alice, "editor");
    expect(await save(owner, note, 0, "01", "Porada 1", [owner, alice])).toMatchObject({ status: "saved" });
    expect(await save(alice, note, 1, "02", "Porada 2", [alice])).toMatchObject({ status: "saved" });
    // A forged author outside the company is left out.
    expect(await save(alice, note, 2, "03", "Porada 3", [stranger])).toMatchObject({ status: "saved" });

    await asUser(owner, owner);
    const versions = await rows<{ author_names: string[]; excerpt: string }>(
      `select author_names, excerpt from note_versions_list($1, 50)`,
      [note],
    );
    expect(versions).toHaveLength(1);
    expect(versions[0].excerpt).toBe("Porada 3");
    expect(versions[0].author_names).toEqual(["Alice", "Majitel"]);

    await db.query(`select note_version_checkpoint($1)`, [note]);
    await asServer();
    expect(await save(owner, note, 3, "04", "Porada 4")).toMatchObject({ status: "saved" });
    await asUser(owner, owner);
    expect(await rows(`select id from note_versions_list($1, 50)`, [note])).toHaveLength(2);
    await asServer();
  });

  it("lets a viewer read the history but not close a version", async () => {
    const note = await addNote(owner, "Čtení");
    await share(owner, note, "member", bob, "viewer");
    expect(await save(owner, note, 0, "01", "Čtení 1")).toMatchObject({ status: "saved" });
    await asUser(bob, owner);
    expect(await rows(`select id from note_versions_list($1, 50)`, [note])).toHaveLength(1);
    await db.query(`select note_version_checkpoint($1)`, [note]);
    await asServer();
    const { closed } = await one<{ closed: boolean }>(
      `select closed from note_versions where note_id = $1`,
      [note],
    );
    expect(closed).toBe(false);
  });
});

describe("notes live: the private channel", () => {
  let note: string;

  beforeAll(async () => {
    note = await addNote(owner, "Kanál");
    await share(owner, note, "group", team, "editor");
    await share(owner, note, "member", bob, "viewer");
  });

  async function onTopic(uid: string, topic: string, extension: "broadcast" | "presence") {
    await asUser(uid, owner);
    await db.query(`select set_config('realtime.topic', $1, false)`, [topic]);
    try {
      const received = await rows(`select id from realtime.messages where topic = $1 and extension = $2`, [
        topic,
        extension,
      ]);
      let sent = true;
      try {
        await db.query(`insert into realtime.messages (topic, extension) values ($1, $2)`, [topic, extension]);
      } catch {
        sent = false;
      }
      return { received: received.length, sent };
    } finally {
      await asServer();
    }
  }

  beforeAll(async () => {
    await asServer();
    await db.query(
      `insert into realtime.messages (topic, extension) values ($1, 'broadcast'), ($1, 'presence')`,
      [`note:${note}`],
    );
  });

  it("lets the owner and an editor from a group send and receive changes", async () => {
    expect(await onTopic(owner, `note:${note}`, "broadcast")).toMatchObject({ sent: true });
    expect(await onTopic(alice, `note:${note}`, "broadcast")).toMatchObject({ received: expect.any(Number), sent: true });
    expect((await onTopic(alice, `note:${note}`, "broadcast")).received).toBeGreaterThan(0);
  });

  it("lets a viewer receive and be present, never send a change", async () => {
    const changes = await onTopic(bob, `note:${note}`, "broadcast");
    expect(changes.received).toBeGreaterThan(0);
    expect(changes.sent).toBe(false);
    expect(await onTopic(bob, `note:${note}`, "presence")).toMatchObject({ sent: true });
  });

  it("keeps a stranger and other topics out", async () => {
    expect(await onTopic(stranger, `note:${note}`, "broadcast")).toEqual({ received: 0, sent: false });
    expect(await onTopic(stranger, `note:${note}`, "presence")).toEqual({ received: 0, sent: false });
    expect(await onTopic(alice, `note:not-a-uuid`, "broadcast")).toEqual({ received: 0, sent: false });
    expect(await onTopic(alice, `chat:${note}`, "broadcast")).toEqual({ received: 0, sent: false });
  });

  it("ends the access as soon as the share is gone", async () => {
    await asServer();
    await db.query(`delete from note_shares where note_id = $1 and target_kind = 'member' and target_user_id = $2`, [
      note,
      bob,
    ]);
    expect(await onTopic(bob, `note:${note}`, "broadcast")).toEqual({ received: 0, sent: false });
  });
});
