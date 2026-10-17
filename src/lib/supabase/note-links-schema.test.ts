// @vitest-environment node
//
// Links between notes and tasks or milestones, the prepared outline on path
// steps and what Jarvis may read of the notes, on the real migrations (PGlite).

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
type JarvisNote = {
  id: string;
  title: string;
  pinned: boolean;
  recent: boolean;
  links: { kind: string; title: string }[];
  match_rank: number | null;
  body: string | null;
};

let db: PGlite;
let owner: string;
let stranger: string;
let workerUser: string;

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
async function addNote(uid: string, title: string, body = "", pinned = false) {
  return one<{ id: string }>(
    `insert into notes (user_id, title, content_text, pinned) values ($1, $2, $3, $4) returning id`,
    [uid, title, body ? `${title}\n${body}` : title, pinned],
  );
}
async function addMilestone(uid: string, title: string, status = "active") {
  return one<{ id: string }>(
    `insert into milestones (user_id, title, status) values ($1, $2, $3) returning id`,
    [uid, title, status],
  );
}
async function addTask(uid: string, milestone: string, title: string, status = "todo") {
  return one<{ id: string }>(
    `insert into tasks (user_id, milestone_id, title, status) values ($1, $2, $3, $4) returning id`,
    [uid, milestone, title, status],
  );
}
async function link(uid: string, note: string, target: { task?: string; milestone?: string }) {
  await asUser(uid);
  try {
    return await one<{ id: string; user_id: string }>(
      `insert into note_links (note_id, task_id, milestone_id) values ($1, $2, $3) returning id, user_id`,
      [note, target.task ?? null, target.milestone ?? null],
    );
  } finally {
    await asServer();
  }
}
async function jarvisNotes(uid: string, query: string | null) {
  await asUser(uid);
  const result = await rows<JarvisNote>(`select * from jarvis_notes($1)`, [query]);
  await asServer();
  return result;
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
  stranger = await createAuthUser();
  workerUser = await createAuthUser();
  const { id: worker } = await one<{ id: string }>(
    `insert into workers (owner_id, user_id, name, status) values ($1, $2, 'Caller', 'active') returning id`,
    [owner, workerUser],
  );
  await db.query(
    `insert into worker_permissions (owner_id, worker_id, section, can_view, can_edit)
     values ($1, $2, 'milestones', true, true)`,
    [owner, worker],
  );
});

afterAll(async () => {
  await db?.close();
});

describe("note links: access", () => {
  it("links the caller's note to the caller's task and milestone", async () => {
    const note = await addNote(owner, "Ideální zákazník");
    const milestone = await addMilestone(owner, "Nabídka a ceník");
    const task = await addTask(owner, milestone.id, "Popiš ideálního zákazníka");
    const toTask = await link(owner, note.id, { task: task.id });
    const toMilestone = await link(owner, note.id, { milestone: milestone.id });
    expect(toTask.user_id).toBe(owner);
    expect(toMilestone.user_id).toBe(owner);

    // The same pair twice is refused.
    await expect(link(owner, note.id, { task: task.id })).rejects.toThrow(/duplicate key/);
    // Exactly one target.
    await expect(link(owner, note.id, {})).rejects.toThrow(/check constraint/);
    await expect(link(owner, note.id, { task: task.id, milestone: milestone.id })).rejects.toThrow(
      /check constraint/,
    );
  });

  it("refuses a stranger's note or a stranger's task", async () => {
    const mine = await addNote(owner, "Ceník");
    const theirs = await addNote(stranger, "Cizí");
    const milestone = await addMilestone(owner, "Můj milník");
    const task = await addTask(owner, milestone.id, "Můj úkol");
    const theirMilestone = await addMilestone(stranger, "Cizí milník");

    await expect(link(stranger, mine.id, { milestone: theirMilestone.id })).rejects.toThrow(
      /row-level security/,
    );
    await expect(link(stranger, theirs.id, { task: task.id })).rejects.toThrow(
      /row-level security/,
    );
    await expect(link(stranger, theirs.id, { milestone: milestone.id })).rejects.toThrow(
      /row-level security/,
    );
  });

  it("does not let a worker tie their note to the owner's task they may edit", async () => {
    const workerNote = await addNote(workerUser, "Pracovníkova poznámka");
    const milestone = await addMilestone(owner, "Sdílený milník");
    const task = await addTask(owner, milestone.id, "Sdílený úkol");
    // The worker sees the task through their rights…
    await asUser(workerUser);
    expect(await rows(`select id from tasks where id = $1`, [task.id])).toHaveLength(1);
    await asServer();
    // …but a link needs both sides to be their own.
    await expect(link(workerUser, workerNote.id, { task: task.id })).rejects.toThrow(
      /row-level security/,
    );
  });

  it("shows links only to their owner, never changes them and removes them with either side", async () => {
    const note = await addNote(owner, "Skript");
    const milestone = await addMilestone(owner, "Oslovení");
    const task = await addTask(owner, milestone.id, "Napiš skript");
    const { id } = await link(owner, note.id, { task: task.id });

    await asUser(stranger);
    expect(await rows(`select id from note_links where id = $1`, [id])).toEqual([]);
    await db.query(`delete from note_links where id = $1`, [id]);
    await asUser(workerUser);
    expect(await rows(`select id from note_links where id = $1`, [id])).toEqual([]);
    await asUser(owner);
    await expect(
      db.query(`update note_links set task_id = null where id = $1`, [id]),
    ).rejects.toThrow(/permission denied/);
    await expect(
      db.query(`insert into note_links (user_id, note_id, task_id) values ($1, $2, $3)`, [
        owner,
        note.id,
        task.id,
      ]),
    ).rejects.toThrow(/permission denied/);
    expect(await rows(`select id from note_links where id = $1`, [id])).toHaveLength(1);
    await asServer();

    await db.query(`delete from tasks where id = $1`, [task.id]);
    expect(await rows(`select id from note_links where id = $1`, [id])).toEqual([]);
  });

  it("lets the owner unlink, and nothing for a visitor", async () => {
    const note = await addNote(owner, "Konkurence");
    const milestone = await addMilestone(owner, "Trh");
    const { id } = await link(owner, note.id, { milestone: milestone.id });
    await db.exec(`select set_config('request.jwt.claim.sub', '', false); set role anon;`);
    await expect(db.query(`select id from note_links`)).rejects.toThrow(/permission denied/);
    await asUser(owner);
    await db.query(`delete from note_links where id = $1`, [id]);
    expect(await rows(`select id from note_links where id = $1`, [id])).toEqual([]);
    await asServer();
  });
});

describe("path steps with a prepared outline", () => {
  it("marks text steps on every path with a known template key", async () => {
    const tagged = await rows<{ path_key: string; template: string }>(
      `select pm.path_key, pt.note_template as template
       from path_tasks pt join path_milestones pm on pm.id = pt.path_milestone_id
       where pt.note_template is not null`,
    );
    const paths = await rows<{ key: string }>(`select key from paths`);
    for (const { key } of paths) {
      expect(tagged.some((row) => row.path_key === key), key).toBe(true);
    }
    expect(new Set(tagged.map((row) => row.template))).toEqual(
      new Set(["idealCustomer", "offer", "pricing", "competition", "salesScript"]),
    );
    const { title } = await one<{ title: { en: string } }>(
      `select pt.title from path_tasks pt join path_milestones pm on pm.id = pt.path_milestone_id
       where pm.path_key = 'general' and pm.key = 'offer_pricing' and pt.note_template = 'idealCustomer'`,
    );
    expect(title.en).toMatch(/ideal customer/i);
  });

  it("reaches a user's copied task through its template", async () => {
    const user = await createAuthUser();
    await asUser(user);
    await db.query(`select choose_path('general')`);
    const tagged = await rows<{ title: string; note_template: string }>(
      `select t.title, pt.note_template from tasks t join path_tasks pt on pt.id = t.template_id
       where t.user_id = $1 and pt.note_template is not null`,
      [user],
    );
    await asServer();
    expect(tagged.map((row) => row.note_template)).toContain("salesScript");
    expect(tagged.length).toBeGreaterThanOrEqual(5);
  });

  it("refuses an unknown template key", async () => {
    await expect(
      db.query(`update path_tasks set note_template = 'poem' where position = 1`),
    ).rejects.toThrow(/check constraint/);
  });
});

describe("jarvis_notes", () => {
  it("lists the newest titles, with the text only of pinned, linked or matching notes", async () => {
    const user = await createAuthUser();
    const plain = await addNote(user, "Nákupní seznam", "mléko a chleba");
    const pinned = await addNote(user, "Ceník", "Konzultace 1 500 Kč", true);
    const linked = await addNote(user, "Ideální zákazník", "Majitelé kaváren v Brně");
    const match = await addNote(user, "Konkurence", "Kavárna Šťastná má levnější espresso");
    const doneLink = await addNote(user, "Starý skript", "Dobrý den, volám z…");
    const milestone = await addMilestone(user, "Nabídka");
    const task = await addTask(user, milestone.id, "Popiš zákazníka");
    const doneTask = await addTask(user, milestone.id, "Hotový úkol", "done");
    await link(user, linked.id, { task: task.id });
    await link(user, doneLink.id, { task: doneTask.id });

    const notes = await jarvisNotes(user, "Kolik bere Šťastná za espresso?");
    const byId = new Map(notes.map((n) => [n.id, n]));
    expect(notes).toHaveLength(5);
    expect(notes.every((n) => n.recent)).toBe(true);
    expect(byId.get(plain.id)?.body).toBeNull();
    expect(byId.get(pinned.id)?.body).toBe("Ceník\nKonzultace 1 500 Kč");
    expect(byId.get(linked.id)?.links).toEqual([{ kind: "task", title: "Popiš zákazníka" }]);
    expect(byId.get(linked.id)?.body).toContain("kaváren");
    expect(byId.get(match.id)?.match_rank).toBeGreaterThan(0);
    expect(byId.get(match.id)?.body).toContain("espresso");
    // A finished task no longer pulls its note in.
    expect(byId.get(doneLink.id)?.links).toEqual([]);
    expect(byId.get(doneLink.id)?.body).toBeNull();
  });

  it("names linked open milestones and leaves out finished ones and the trash", async () => {
    const user = await createAuthUser();
    const open = await addNote(user, "Plán");
    const closed = await addNote(user, "Hotový plán");
    const trashed = await addNote(user, "V koši", "", true);
    const active = await addMilestone(user, "Rozjezd");
    const finished = await addMilestone(user, "Hotovo");
    await link(user, open.id, { milestone: active.id });
    await link(user, closed.id, { milestone: finished.id });
    await addTask(user, finished.id, "Jediný úkol", "done");
    await db.query(`update milestones set status = 'completed' where id = $1`, [finished.id]);
    await db.query(`update notes set deleted_at = now() where id = $1`, [trashed.id]);

    const notes = await jarvisNotes(user, null);
    expect(notes.map((n) => n.title).sort()).toEqual(["Hotový plán", "Plán"]);
    expect(notes.find((n) => n.id === open.id)?.links).toEqual([
      { kind: "milestone", title: "Rozjezd" },
    ]);
    expect(notes.find((n) => n.id === closed.id)?.links).toEqual([]);
  });

  it("keeps to 50 newest titles, at most 3 matches and the cut text", async () => {
    const user = await createAuthUser();
    for (let i = 0; i < 55; i += 1) await addNote(user, `Poznámka ${i}`, `obsah číslo ${i}`);
    await addNote(user, "Dlouhá", "x".repeat(20_000), true);
    const notes = await jarvisNotes(user, "obsah");
    expect(notes.filter((n) => n.recent)).toHaveLength(50);
    expect(notes.filter((n) => n.match_rank !== null)).toHaveLength(3);
    const long = notes.find((n) => n.title === "Dlouhá");
    expect(long?.body?.length).toBe(12_000);
  });

  it("returns nothing of another account and nothing to a worker from the owner", async () => {
    await addNote(owner, "Tajná strategie", "jen pro majitele", true);
    const theirs = await jarvisNotes(stranger, "strategie");
    expect(theirs.some((n) => n.title === "Tajná strategie")).toBe(false);
    const worker = await jarvisNotes(workerUser, "strategie");
    expect(worker.some((n) => n.title === "Tajná strategie")).toBe(false);
    await db.exec(`select set_config('request.jwt.claim.sub', '', false); set role anon;`);
    await expect(db.query(`select * from jarvis_notes('x')`)).rejects.toThrow(
      /permission denied/,
    );
    await asServer();
  });
});
