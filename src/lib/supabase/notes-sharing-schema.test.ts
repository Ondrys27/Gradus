// @vitest-environment node
//
// Folders and sharing of notes inside a company (step 28.3) in the real
// migrations on PGlite: a folder shared with a group reaches its members,
// a viewer only reads, an editor writes the text but never deletes, pins or
// moves the note out of its folder, a share of the note to one person
// decides for them, "private in this folder", sharing further up to one's
// own role, the whole company, removed people lose access at once and their
// shared notes stay with the company, versions, "remove from mine", search
// and Grady's notes in the active space.

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
let alice: string;
let bob: string;
let carol: string;
let stranger: string;
let aliceWorker: string;
let bobWorker: string;
let team: string;

async function rows<T = Row>(sql: string, params?: unknown[]): Promise<T[]> {
  return (await db.query<T>(sql, params as never)).rows;
}
async function one<T = Row>(sql: string, params?: unknown[]): Promise<T> {
  return (await rows<T>(sql, params))[0] as T;
}
/** Signs in as uid working in `space` (the x-gradus-space header). */
async function asUser(uid: string, space: string = uid) {
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid]);
  await db.query(`select set_config('request.headers', $1, false)`, [
    JSON.stringify({ "x-gradus-space": space }),
  ]);
  await db.exec(`set role authenticated`);
}
async function asServer() {
  await db.exec(
    `reset role; select set_config('request.jwt.claim.sub', '', false); select set_config('request.headers', '', false);`,
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

/** A note of `uid` in the company, optionally in a folder. */
async function addNote(uid: string, title: string, folder: string | null = null) {
  await asUser(uid, owner);
  const { id } = await one<{ id: string }>(
    `insert into notes (user_id, space_id, folder_id, title, content_text)
     values ($1, $2, $3, $4, $4) returning id`,
    [uid, owner, folder, title],
  );
  await asServer();
  return id;
}
async function addFolder(uid: string, name: string, parent: string | null = null) {
  await asUser(uid, owner);
  const { id } = await one<{ id: string }>(
    `insert into note_folders (space_id, name, parent_id) values ($1, $2, $3) returning id`,
    [owner, name, parent],
  );
  await asServer();
  return id;
}
async function share(
  uid: string,
  item: { note?: string; folder?: string },
  kind: "member" | "group" | "space",
  target: string | null,
  role: "viewer" | "editor",
  reshare = false,
) {
  await asUser(uid, owner);
  const { id } = await one<{ id: string }>(
    `select note_share_set($1, $2, $3, $4, $5, $6) as id`,
    [item.note ?? null, item.folder ?? null, kind, target, role, reshare],
  );
  await asServer();
  return id;
}
async function roleOf(uid: string, note: string) {
  await asUser(uid, owner);
  const found = await rows<{ role: string }>(`select role from note_role($1)`, [note]);
  await asServer();
  return found[0]?.role ?? null;
}
async function sees(uid: string, note: string) {
  await asUser(uid, owner);
  const found = await rows(`select id from notes where id = $1`, [note]);
  await asServer();
  return found.length > 0;
}
async function writeText(uid: string, note: string, title: string) {
  await asUser(uid, owner);
  const result = await db.query(
    `update notes set title = $2, content_text = $2 where id = $1`,
    [note, title],
  );
  await asServer();
  return result.affectedRows ?? 0;
}

beforeAll(async () => {
  db = new PGlite({ extensions: PGLITE_EXTENSIONS });
  await db.exec(SUPABASE_STUBS);
  for (const file of readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    await db.exec(readFileSync(path.join(MIGRATIONS_DIR, file), "utf8"));
  }
  // The very first account owns the app; the others are ordinary.
  await createAuthUser();
  owner = await createAuthUser();
  alice = await createAuthUser();
  bob = await createAuthUser();
  carol = await createAuthUser();
  stranger = await createAuthUser();
  aliceWorker = await hire(alice, "Alice");
  bobWorker = await hire(bob, "Bob");
  await hire(carol, "Carol");
  await asServer();
  await db.query(`update profiles set display_name = 'Majitel' where id = $1`, [owner]);
  team = (
    await one<{ id: string }>(
      `insert into worker_groups (owner_id, name) values ($1, 'Obchod') returning id`,
      [owner],
    )
  ).id;
  await db.query(
    `insert into worker_group_members (group_id, worker_id, owner_id) values ($1, $2, $3), ($1, $4, $3)`,
    [team, aliceWorker, owner, bobWorker],
  );
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe("notes sharing: private by default", () => {
  it("keeps every note to its owner until it is shared, the space owner included", async () => {
    const note = await addNote(alice, "Moje soukromá");
    expect(await sees(alice, note)).toBe(true);
    expect(await sees(owner, note)).toBe(false);
    expect(await sees(bob, note)).toBe(false);
    expect(await sees(stranger, note)).toBe(false);
    expect(await roleOf(owner, note)).toBeNull();
  });

  it("puts a note made without a space into the owner's own one", async () => {
    await asUser(alice, owner);
    const { space_id } = await one<{ space_id: string }>(
      `insert into notes (user_id, title) values ($1, 'Bez prostoru') returning space_id`,
      [alice],
    );
    expect(space_id).toBe(alice);
    await asServer();
  });

  it("refuses a note in a space the account does not belong to, or for someone else", async () => {
    await asUser(stranger, owner);
    await expect(
      db.query(`insert into notes (user_id, space_id, title) values ($1, $2, 'Cizí')`, [stranger, owner]),
    ).rejects.toThrow(/row-level security/);
    await expect(
      db.query(`insert into notes (user_id, space_id, title) values ($1, $2, 'Podvržená')`, [alice, owner]),
    ).rejects.toThrow(/row-level security/);
    await asServer();
  });
});

describe("notes sharing: a folder shared with a group", () => {
  let folder: string;
  let inside: string;

  beforeAll(async () => {
    folder = await addFolder(owner, "Obchodní podklady");
    inside = await addNote(owner, "Ceník 2027", folder);
    await share(owner, { folder }, "group", team, "viewer");
  });

  it("reaches the group's members, nobody else", async () => {
    expect(await roleOf(alice, inside)).toBe("viewer");
    expect(await roleOf(bob, inside)).toBe("viewer");
    expect(await roleOf(carol, inside)).toBeNull();
    expect(await sees(carol, inside)).toBe(false);
    expect(await sees(stranger, inside)).toBe(false);
    await asUser(alice, owner);
    const folders = await rows<{ id: string; role: string }>(
      `select id, role from note_folders_list($1)`,
      [owner],
    );
    expect(folders).toEqual([expect.objectContaining({ id: folder, role: "viewer" })]);
    const listed = await rows<{ id: string; role: string; owner_name: string; shared: boolean }>(
      `select id, role, owner_name, shared from notes_list($1)`,
      [owner],
    );
    expect(listed.find((n) => n.id === inside)).toMatchObject({ role: "viewer", shared: true });
    await asServer();
  });

  it("lets a viewer read, never write", async () => {
    expect(await writeText(alice, inside, "Přepsáno")).toBe(0);
    await asServer();
    expect(await one(`select title from notes where id = $1`, [inside])).toEqual({ title: "Ceník 2027" });
  });

  it("an editor writes the text, never deletes, pins, trashes or moves it out", async () => {
    await share(owner, { folder }, "group", team, "editor");
    expect(await roleOf(alice, inside)).toBe("editor");
    expect(await writeText(alice, inside, "Ceník 2027 · upraveno")).toBe(1);
    await asUser(alice, owner);
    await db.query(`update notes set pinned = true, deleted_at = now() where id = $1`, [inside]);
    expect(
      await one(`select pinned, deleted_at from notes where id = $1`, [inside]),
    ).toEqual({ pinned: false, deleted_at: null });
    await expect(
      db.query(`update notes set folder_id = null where id = $1`, [inside]),
    ).rejects.toThrow(/note_owner_only/);
    const deleted = await db.query(`delete from notes where id = $1`, [inside]);
    expect(deleted.affectedRows).toBe(0);
    await asServer();
  });

  it("keeps who saved which version", async () => {
    await asUser(alice, owner);
    const versions = await rows<{ saved_by: string; saved_by_name: string }>(
      `select saved_by, saved_by_name from note_versions_list($1)`,
      [inside],
    );
    expect(versions[0]).toMatchObject({ saved_by: alice, saved_by_name: "Alice" });
    expect(versions.some((v) => v.saved_by === owner)).toBe(true);
    await asServer();
  });

  it("a new note in the folder is shared the same way, made by an editor too", async () => {
    const made = await addNote(bob, "Nápad od Boba", folder);
    expect(await roleOf(alice, made)).toBe("editor");
    // The folder's owner edits what lands in their folder.
    expect(await roleOf(owner, made)).toBe("editor");
    expect(await roleOf(carol, made)).toBeNull();
  });

  it("a note private in this folder drops what the folder gives", async () => {
    const own = await addNote(bob, "Jen moje", folder);
    await asUser(bob, owner);
    await db.query(`update notes set folder_private = true where id = $1`, [own]);
    await asServer();
    expect(await roleOf(alice, own)).toBeNull();
    expect(await roleOf(owner, own)).toBeNull();
    expect(await roleOf(bob, own)).toBe("owner");
  });

  it("a share of the note to one person decides for them, even below the folder", async () => {
    await share(owner, { note: inside }, "member", bob, "viewer");
    expect(await roleOf(bob, inside)).toBe("viewer");
    expect(await roleOf(alice, inside)).toBe("editor");
  });

  it("a viewer can not put a note into the folder", async () => {
    const other = await addFolder(owner, "Jen ke čtení");
    await share(owner, { folder: other }, "member", carol, "viewer");
    await asUser(carol, owner);
    await expect(
      db.query(
        `insert into notes (user_id, space_id, folder_id, title) values ($1, $2, $3, 'X')`,
        [carol, owner, other],
      ),
    ).rejects.toThrow(/note_folder_denied/);
    await asServer();
  });

  it("lists who has access and from where", async () => {
    await asUser(alice, owner);
    const access = await rows<{ entry: string; source: string; target_kind: string; role: string; name: string | null }>(
      `select entry, source, target_kind, role, name from note_access_list($1, null)`,
      [inside],
    );
    expect(access).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ entry: "owner", role: "owner" }),
        expect.objectContaining({ entry: "share", source: "folder", target_kind: "group", name: "Obchod" }),
        expect.objectContaining({ entry: "share", source: "direct", target_kind: "member", name: "Bob" }),
      ]),
    );
    const people = await rows<{ user_id: string; role: string }>(
      `select user_id, role from note_people($1, null)`,
      [inside],
    );
    expect(people.map((p) => p.user_id).sort()).toEqual([owner, alice, bob].sort());
    await asServer();
  });
});

describe("notes sharing: sharing further", () => {
  it("only the owner, or someone allowed to, up to their own role", async () => {
    const note = await addNote(owner, "Strategie");
    await share(owner, { note }, "member", alice, "viewer", true);
    await share(owner, { note }, "member", bob, "editor", false);
    // Bob edits but may not share further.
    await asUser(bob, owner);
    await expect(
      db.query(`select note_share_set($1, null, 'member', $2, 'viewer', false)`, [note, carol]),
    ).rejects.toThrow(/note_share_denied/);
    // Alice may, but only as a viewer.
    await asUser(alice, owner);
    await expect(
      db.query(`select note_share_set($1, null, 'member', $2, 'editor', false)`, [note, carol]),
    ).rejects.toThrow(/note_share_denied/);
    await db.query(`select note_share_set($1, null, 'member', $2, 'viewer', false)`, [note, carol]);
    await asServer();
    expect(await roleOf(carol, note)).toBe("viewer");
  });

  it("only people and groups of the company, never a stranger", async () => {
    const note = await addNote(owner, "Interní");
    await asUser(owner, owner);
    await expect(
      db.query(`select note_share_set($1, null, 'member', $2, 'viewer', false)`, [note, stranger]),
    ).rejects.toThrow(/note_share_target/);
    await expect(
      db.query(`select note_share_set($1, null, 'group', gen_random_uuid(), 'viewer', false)`, [note]),
    ).rejects.toThrow(/note_share_target/);
    await asServer();
    await asUser(stranger, owner);
    await expect(
      db.query(`select note_share_set($1, null, 'space', null, 'editor', false)`, [note]),
    ).rejects.toThrow(/note_share_denied/);
    await asServer();
  });

  it("the whole company reaches it, and every member hears it in the bell", async () => {
    const note = await addNote(owner, "Pro všechny");
    await share(owner, { note }, "space", null, "viewer");
    for (const person of [alice, bob, carol]) expect(await roleOf(person, note)).toBe("viewer");
    expect(await roleOf(stranger, note)).toBeNull();
    const heard = await rows<{ user_id: string }>(
      `select user_id from account_notifications where kind = 'note_shared' and note_id = $1`,
      [note],
    );
    expect(heard.map((n) => n.user_id).sort()).toEqual([alice, bob, carol].sort());
    await asUser(carol, owner);
    const labels = await rows<{ actor_name: string; title: string }>(
      `select actor_name, title from note_notification_labels(array(select id from account_notifications where note_id = $1))`,
      [note],
    );
    expect(labels).toEqual([{ actor_name: "Majitel", title: "Pro všechny" }]);
    await asServer();
  });

  it("removing a share takes the access away at once", async () => {
    const note = await addNote(owner, "Dočasně");
    const id = await share(owner, { note }, "member", carol, "editor");
    expect(await roleOf(carol, note)).toBe("editor");
    await asUser(carol, owner);
    await expect(db.query(`select note_share_remove($1)`, [id])).rejects.toThrow(/note_share_denied/);
    await asUser(owner, owner);
    await db.query(`select note_share_remove($1)`, [id]);
    await asServer();
    expect(await roleOf(carol, note)).toBeNull();
    expect(await writeText(carol, note, "Pozdě")).toBe(0);
  });

  it("nobody writes the shares directly", async () => {
    const note = await addNote(owner, "Přímo");
    await asUser(owner, owner);
    await expect(
      db.query(
        `insert into note_shares (space_id, note_id, target_kind, role) values ($1, $2, 'space', 'editor')`,
        [owner, note],
      ),
    ).rejects.toThrow(/permission denied/);
    await asServer();
  });
});

describe("notes sharing: remove from mine, search and Grady", () => {
  it("a shared note leaves the lists of whoever removes it, not the owner's", async () => {
    const note = await addNote(owner, "Zápis z porady");
    await share(owner, { note }, "member", alice, "viewer");
    await asUser(alice, owner);
    expect(
      (await rows<{ id: string }>(`select id from search_notes('porady', 20, $1)`, [owner])).map((h) => h.id),
    ).toContain(note);
    const grady = await rows<{ id: string; author: string; role: string }>(
      `select id, author, role from jarvis_notes('porada', 12000, $1)`,
      [owner],
    );
    expect(grady.find((n) => n.id === note)).toMatchObject({ role: "viewer" });
    expect(grady.find((n) => n.id === note)?.author).toBe("Majitel");
    await db.query(`insert into note_dismissals (note_id) values ($1)`, [note]);
    expect((await rows<{ id: string }>(`select id from notes_list($1)`, [owner])).map((n) => n.id)).not.toContain(note);
    expect(await rows(`select id from search_notes('porady', 20, $1)`, [owner])).toEqual([]);
    // Its own notes can not be "removed from mine".
    const own = await addNote(alice, "Vlastní");
    await asUser(alice, owner);
    await expect(db.query(`insert into note_dismissals (note_id) values ($1)`, [own])).rejects.toThrow(
      /row-level security/,
    );
    await asServer();
    expect((await rows<{ id: string }>(`select id from notes where id = $1`, [note])).length).toBe(1);
  });

  it("a chip of a record the reader can not open is hidden, not gone", async () => {
    await asServer();
    const { id: contact } = await one<{ id: string }>(
      `insert into contacts (user_id, company_name) values ($1, 'Tajná s.r.o.') returning id`,
      [owner],
    );
    const note = await addNote(owner, "Se zmínkou");
    await asUser(owner, owner);
    await db.query(
      `update notes set content = $2::jsonb where id = $1`,
      [
        note,
        JSON.stringify({
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "mention", attrs: { type: "contact", id: contact, label: "Tajná" } }],
            },
          ],
        }),
      ],
    );
    await asServer();
    await share(owner, { note }, "member", carol, "viewer");
    await asUser(carol, owner);
    expect(await rows(`select id from contacts where id = $1`, [contact])).toEqual([]);
    expect(await rows(`select target_type, target_id from note_mention_states($1)`, [note])).toEqual([
      { target_type: "contact", target_id: contact },
    ]);
    await asUser(stranger, owner);
    expect(await rows(`select * from note_mention_states($1)`, [note])).toEqual([]);
    await asServer();
  });
});

describe("notes sharing: leaving the company", () => {
  it("ends the access at once and hands the shared notes and folders to the owner", async () => {
    const leaver = await createAuthUser();
    const leaverWorker = await hire(leaver, "Dan");
    const folder = await addFolder(leaver, "Danovy podklady");
    const inFolder = await addNote(leaver, "Ve sdílené složce", folder);
    const direct = await addNote(leaver, "Sdílená přímo");
    const secret = await addNote(leaver, "Soukromá");
    const ownersNote = await addNote(owner, "Majitelova");
    await share(leaver, { folder }, "member", alice, "viewer");
    await share(leaver, { note: direct }, "space", null, "viewer");
    await share(owner, { note: ownersNote }, "member", leaver, "editor");
    expect(await roleOf(leaver, ownersNote)).toBe("editor");

    await asServer();
    await db.query(`update workers set status = 'inactive' where id = $1`, [leaverWorker]);

    expect(await sees(leaver, ownersNote)).toBe(false);
    expect(await writeText(leaver, ownersNote, "Po odchodu")).toBe(0);
    await asServer();
    const owners = await rows<{ id: string; user_id: string; folder_id: string | null }>(
      `select id, user_id, folder_id from notes where id = any($1::uuid[])`,
      [[inFolder, direct, secret]],
    );
    const byId = new Map(owners.map((n) => [n.id, n]));
    expect(byId.get(inFolder)).toMatchObject({ user_id: owner, folder_id: folder });
    expect(byId.get(direct)?.user_id).toBe(owner);
    expect(byId.get(secret)?.user_id).toBe(leaver);
    expect(await one(`select user_id from note_folders where id = $1`, [folder])).toEqual({ user_id: owner });
    expect(await roleOf(alice, inFolder)).toBe("viewer");
    expect(
      await one(
        `select kind, item_count, worker_id from account_notifications where user_id = $1 and kind = 'notes_transferred'`,
        [owner],
      ),
    ).toEqual({ kind: "notes_transferred", item_count: 2, worker_id: leaverWorker });
    // The private one stays theirs and out of everyone's reach.
    expect(await sees(owner, secret)).toBe(false);
    expect(await sees(leaver, secret)).toBe(false);
  });
});

describe("notes sharing: folders", () => {
  it("one level of nesting, same owner, only the owner changes a folder", async () => {
    const top = await addFolder(alice, "Horní");
    const sub = await addFolder(alice, "Dolní", top);
    await asUser(alice, owner);
    await expect(
      db.query(`insert into note_folders (space_id, name, parent_id) values ($1, 'Hluboko', $2)`, [owner, sub]),
    ).rejects.toThrow(/note_folder_parent/);
    await expect(db.query(`update note_folders set parent_id = $2 where id = $1`, [top, sub])).rejects.toThrow(
      /note_folder_parent/,
    );
    await asServer();
    await share(alice, { folder: top }, "member", bob, "editor");
    // The share of the top folder reaches its subfolder too.
    await asUser(bob, owner);
    expect(
      (await rows<{ id: string }>(`select id from note_folders_list($1)`, [owner])).map((f) => f.id),
    ).toEqual(expect.arrayContaining([top, sub]));
    const renamed = await db.query(`update note_folders set name = 'Cizí' where id = $1`, [top]);
    expect(renamed.affectedRows).toBe(0);
    await asServer();
  });

  it("deleting a folder leaves its notes, out of any folder", async () => {
    const folder = await addFolder(owner, "Na smazání");
    const note = await addNote(owner, "Zůstane", folder);
    const theirs = await addNote(alice, "Cizí v ní", null);
    await share(owner, { folder }, "member", alice, "editor");
    await asUser(alice, owner);
    await db.query(`update notes set folder_id = $2 where id = $1`, [theirs, folder]);
    await asUser(owner, owner);
    await db.query(`delete from note_folders where id = $1`, [folder]);
    await asServer();
    expect(
      await rows(`select folder_id from notes where id = any($1::uuid[])`, [[note, theirs]]),
    ).toEqual([{ folder_id: null }, { folder_id: null }]);
  });
});
