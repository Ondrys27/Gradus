// @vitest-environment node
//
// Notes in the real migrations on an in-process Postgres (PGlite): own rows
// only, columns the client can not set, timestamps, the size limit, full-text
// search without diacritics, the trash and its daily purge.

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
type Hit = { id: string; title: string; rank: number; data: Record<string, unknown> };

let db: PGlite;
let owner: string;
let stranger: string;

async function rows<T = Row>(sql: string, params?: unknown[]): Promise<T[]> {
  return (await db.query<T>(sql, params as never)).rows;
}
async function one<T = Row>(sql: string, params?: unknown[]): Promise<T> {
  return (await rows<T>(sql, params))[0] as T;
}
async function asUser(uid: string) {
  await db.exec(
    `select set_config('request.jwt.claim.sub', '${uid}', false); set role authenticated;`,
  );
}
async function asServiceRole() {
  await db.exec(`select set_config('request.jwt.claim.sub', '', false); set role service_role;`);
}
async function asServer() {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
}
async function createAuthUser() {
  const { id } = await one<{ id: string }>(
    `insert into auth.users (email, raw_user_meta_data) values ($1, '{"locale":"cs"}') returning id`,
    [`${crypto.randomUUID()}@example.com`],
  );
  return id;
}

/** Inserts a note as its owner, the way the app does. */
async function addNote(uid: string, title: string, body = "", pinned = false) {
  await asUser(uid);
  const note = await one<{ id: string; updated_at: string }>(
    `insert into notes (user_id, title, content_text, pinned) values ($1, $2, $3, $4)
     returning id, updated_at`,
    [uid, title, body ? `${title}\n${body}` : title, pinned],
  );
  await asServer();
  return note;
}

async function search(uid: string, query: string) {
  await asUser(uid);
  const hits = await rows<Hit>(`select * from search_notes($1, 20)`, [query]);
  await asServer();
  return hits;
}

beforeAll(async () => {
  db = new PGlite({ extensions: PGLITE_EXTENSIONS });
  await db.exec(SUPABASE_STUBS);
  for (const file of readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    await db.exec(readFileSync(path.join(MIGRATIONS_DIR, file), "utf8"));
  }
  // The very first account owns the app and has no trial; the others are ordinary.
  await createAuthUser();
  owner = await createAuthUser();
  stranger = await createAuthUser();
});

afterAll(async () => {
  await db?.close();
});

describe("notes: access", () => {
  it("shows every account only its own notes", async () => {
    const mine = await addNote(owner, "Ceník", "Konzultace 1 500 Kč za hodinu");
    await addNote(stranger, "Tajný plán");
    await asUser(stranger);
    expect(await rows(`select id from notes where id = $1`, [mine.id])).toEqual([]);
    await db.query(`update notes set title = 'Hacked' where id = $1`, [mine.id]);
    await db.query(`delete from notes where id = $1`, [mine.id]);
    await asUser(owner);
    expect(await one(`select title from notes where id = $1`, [mine.id])).toEqual({
      title: "Ceník",
    });
    await asServer();
  });

  it("refuses a note created for someone else", async () => {
    await asUser(stranger);
    await expect(
      db.query(`insert into notes (user_id, title) values ($1, 'Podvržená')`, [owner]),
    ).rejects.toThrow(/row-level security/);
    await asServer();
  });

  it("gives a worker no access to the owner's notes", async () => {
    const workerUser = await createAuthUser();
    const { id: worker } = await one<{ id: string }>(
      `insert into workers (owner_id, user_id, name, status) values ($1, $2, 'Caller', 'active') returning id`,
      [owner, workerUser],
    );
    for (const section of ["milestones", "contacts", "pipeline", "calendar", "finance"]) {
      await db.query(
        `insert into worker_permissions (owner_id, worker_id, section, can_view, can_edit)
         values ($1, $2, $3, true, true)`,
        [owner, worker, section],
      );
    }
    await asUser(workerUser);
    expect(await rows(`select id from notes where user_id = $1`, [owner])).toEqual([]);
    await expect(
      db.query(`insert into notes (user_id, title) values ($1, 'Od pracovníka')`, [owner]),
    ).rejects.toThrow(/row-level security/);
    expect(await rows(`select * from search_notes('cenik')`)).toEqual([]);
    await asServer();
  });

  it("does not let the client set owner-only columns", async () => {
    const note = await addNote(owner, "Konkurence");
    await asUser(owner);
    await expect(
      db.query(`update notes set created_at = now() - interval '1 year' where id = $1`, [note.id]),
    ).rejects.toThrow(/permission denied/);
    await expect(
      db.query(`update notes set user_id = $2 where id = $1`, [note.id, stranger]),
    ).rejects.toThrow(/permission denied/);
    await expect(
      db.query(`insert into notes (title, updated_at) values ('Stará', now() - interval '1 year')`),
    ).rejects.toThrow(/permission denied/);
    await asServer();
  });

  it("gives nothing to a visitor who is not signed in", async () => {
    await db.exec(`select set_config('request.jwt.claim.sub', '', false); set role anon;`);
    await expect(db.query(`select id from notes`)).rejects.toThrow(/permission denied/);
    await asServer();
  });
});

describe("notes: saving", () => {
  it("moves updated_at only when the text changes", async () => {
    const note = await addNote(owner, "Prodejní skript");
    // The guard keeps the old value for any write; set it with the trigger off.
    await db.exec(`alter table notes disable trigger notes_guard`);
    await db.query(`update notes set updated_at = now() - interval '1 day' where id = $1`, [
      note.id,
    ]);
    await db.exec(`alter table notes enable trigger notes_guard`);
    const before = await one<{ updated_at: Date }>(`select updated_at from notes where id = $1`, [
      note.id,
    ]);

    await asUser(owner);
    await db.query(`update notes set pinned = true where id = $1`, [note.id]);
    const pinned = await one<{ updated_at: Date }>(`select updated_at from notes where id = $1`, [
      note.id,
    ]);
    expect(pinned.updated_at.getTime()).toBe(before.updated_at.getTime());

    await db.query(
      `update notes set title = 'Prodejní skript v2', content_text = 'Prodejní skript v2' where id = $1`,
      [note.id],
    );
    const edited = await one<{ updated_at: Date }>(`select updated_at from notes where id = $1`, [
      note.id,
    ]);
    expect(edited.updated_at.getTime()).toBeGreaterThan(before.updated_at.getTime());
    await asServer();
  });

  it("keeps the line under the title as the preview", async () => {
    const note = await addNote(owner, "Ideální zákazník", "Majitelé kaváren\nv Brně");
    const { preview } = await one<{ preview: string }>(`select preview from notes where id = $1`, [
      note.id,
    ]);
    expect(preview).toBe("Majitelé kaváren v Brně");
  });

  it("refuses a note over the size limit", async () => {
    await asUser(owner);
    await expect(
      db.query(`insert into notes (title, content_text) values ('Velká', repeat('a', 100001))`),
    ).rejects.toThrow(/check constraint/);
    await expect(
      db.query(
        `insert into notes (title, content) values ('Velká', jsonb_build_object('type', 'doc', 'text', repeat('a', 400001)))`,
      ),
    ).rejects.toThrow(/check constraint/);
    await expect(
      db.query(`insert into notes (title) values (repeat('a', 201))`),
    ).rejects.toThrow(/check constraint/);
    await asServer();
  });
});

describe("notes: search", () => {
  it("finds words without diacritics and by their beginning", async () => {
    await addNote(owner, "Konkurenční přehled", "Kavárna Šťastná má levnější espresso");
    expect((await search(owner, "kavarna stastna")).map((h) => h.title)).toContain(
      "Konkurenční přehled",
    );
    expect((await search(owner, "CEN")).map((h) => h.title)).toContain("Ceník");
    expect((await search(owner, "konzultace hodinu")).map((h) => h.title)).toEqual(["Ceník"]);
    expect(await search(owner, "konzultace pizza")).toEqual([]);
  });

  it("ranks a title match above a body match and returns the preview", async () => {
    await addNote(owner, "Espresso", "Nápady na menu");
    const hits = await search(owner, "espresso");
    expect(hits[0].title).toBe("Espresso");
    expect(hits[0].data.preview).toBe("Nápady na menu");
  });

  it("never finds another account's notes, nor anything for nonsense input", async () => {
    expect(await search(owner, "tajny")).toEqual([]);
    expect((await search(stranger, "tajny")).map((h) => h.title)).toEqual(["Tajný plán"]);
    expect(await search(owner, "   ")).toEqual([]);
    expect(await search(owner, "&|!:*()'")).toEqual([]);
  });
});

describe("notes: trash", () => {
  it("hides a deleted note from search and stamps the time of deleting", async () => {
    const note = await addNote(owner, "Smazaný nápad");
    await asUser(owner);
    await db.query(`update notes set deleted_at = '2000-01-01' where id = $1`, [note.id]);
    const { deleted_at } = await one<{ deleted_at: Date }>(
      `select deleted_at from notes where id = $1`,
      [note.id],
    );
    expect(Date.now() - deleted_at.getTime()).toBeLessThan(60_000);
    await asServer();
    expect(await search(owner, "smazany")).toEqual([]);

    await asUser(owner);
    await db.query(`update notes set deleted_at = null where id = $1`, [note.id]);
    await asServer();
    expect((await search(owner, "smazany")).map((h) => h.title)).toEqual(["Smazaný nápad"]);
  });

  it("purges notes after 30 days in the trash, from the server only", async () => {
    const old = await addNote(owner, "Starý koš");
    const fresh = await addNote(owner, "Nový koš");
    const kept = await addNote(owner, "Živá poznámka");
    await db.exec(`alter table notes disable trigger notes_guard`);
    await db.query(`update notes set deleted_at = now() - interval '31 days' where id = $1`, [
      old.id,
    ]);
    await db.query(`update notes set deleted_at = now() - interval '29 days' where id = $1`, [
      fresh.id,
    ]);
    await db.exec(`alter table notes enable trigger notes_guard`);

    await asUser(owner);
    await expect(db.query(`select purge_deleted_notes()`)).rejects.toThrow(/permission denied/);
    await asServiceRole();
    const { purge_deleted_notes: removed } = await one<{ purge_deleted_notes: number }>(
      `select purge_deleted_notes()`,
    );
    await asServer();
    expect(removed).toBe(1);
    const left = await rows<{ id: string }>(`select id from notes where id = any($1)`, [
      [old.id, fresh.id, kept.id],
    ]);
    expect(left.map((r) => r.id).sort()).toEqual([fresh.id, kept.id].sort());
  });
});

describe("notes: read-only after the trial", () => {
  it("keeps notes readable and refuses changes", async () => {
    const note = await addNote(stranger, "Po zkušebce");
    await db.query(
      `update subscriptions set trial_ends_at = now() - interval '1 minute' where user_id = $1`,
      [stranger],
    );
    await asUser(stranger);
    expect(await rows(`select id from notes where id = $1`, [note.id])).toHaveLength(1);
    await expect(
      db.query(`update notes set title = 'Změna' where id = $1`, [note.id]),
    ).rejects.toThrow(/read_only/);
    await expect(db.query(`insert into notes (title) values ('Nová')`)).rejects.toThrow(
      /read_only/,
    );
    await asServer();
  });
});
