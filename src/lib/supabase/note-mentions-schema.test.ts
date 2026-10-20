// @vitest-environment node
//
// Mentions of contacts, deals, events and workers in notes (note_mentions),
// derived from the note's content by a trigger, on the real migrations (PGlite).

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
type Mention = { type: string; id: string; label: string };

let db: PGlite;
let owner: string;
let stranger: string;
let workerUser: string;
let contact: string;
let strangerContact: string;
let deal: string;
let event: string;
let worker: string;

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

function doc(...mentions: Mention[]) {
  return {
    type: "doc",
    content: [
      { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Plán" }] },
      {
        type: "paragraph",
        content: mentions.flatMap((attrs) => [
          { type: "text", text: "Zavolat " },
          { type: "mention", attrs: { ...attrs, mentionSuggestionChar: "@" } },
        ]),
      },
      // Nested deeper, inside a list.
      {
        type: "bulletList",
        content: [{ type: "listItem", content: [{ type: "paragraph", content: [] }] }],
      },
    ],
  };
}

/** Saves a note as the signed-in user does (insert, then updates of the content). */
async function writeNote(uid: string, content: object, id?: string) {
  await asUser(uid);
  try {
    if (id) {
      await db.query(`update notes set content = $2 where id = $1`, [id, JSON.stringify(content)]);
      return id;
    }
    const inserted = await one<{ id: string }>(
      `insert into notes (user_id, title, content, content_text) values ($1, 'Plán', $2, 'Plán') returning id`,
      [uid, JSON.stringify(content)],
    );
    return inserted.id;
  } finally {
    await asServer();
  }
}

async function mentionsOf(noteId: string) {
  return rows<{ target_type: string; target_id: string; user_id: string }>(
    `select target_type, target_id, user_id from note_mentions where note_id = $1 order by target_type`,
    [noteId],
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
  stranger = await createAuthUser();
  workerUser = await createAuthUser();

  contact = (
    await one<{ id: string }>(
      `insert into contacts (user_id, first_name, last_name) values ($1, 'Jan', 'Novák') returning id`,
      [owner],
    )
  ).id;
  strangerContact = (
    await one<{ id: string }>(
      `insert into contacts (user_id, company_name) values ($1, 'Cizí s.r.o.') returning id`,
      [stranger],
    )
  ).id;
  const stage = await one<{ id: string }>(
    `select id from pipeline_stages where user_id = $1 order by position limit 1`,
    [owner],
  );
  deal = (
    await one<{ id: string }>(
      `insert into deals (user_id, stage_id, title) values ($1, $2, 'Web pro pekárnu') returning id`,
      [owner, stage.id],
    )
  ).id;
  event = (
    await one<{ id: string }>(
      `insert into calendar_events (user_id, actor_id, title, kind, starts_at) values ($1, $1, 'Schůzka', 'meeting', now()) returning id`,
      [owner],
    )
  ).id;
  worker = (
    await one<{ id: string }>(
      `insert into workers (owner_id, user_id, name, status) values ($1, $2, 'Petra', 'active') returning id`,
      [owner, workerUser],
    )
  ).id;
});

afterAll(async () => {
  await db?.close();
});

describe("note mentions: filled from the content", () => {
  it("lists every mentioned record of the owner once", async () => {
    const note = await writeNote(
      owner,
      doc(
        { type: "contact", id: contact, label: "Jan Novák" },
        { type: "contact", id: contact, label: "Jan Novák" },
        { type: "deal", id: deal, label: "Web pro pekárnu" },
        { type: "event", id: event, label: "Schůzka" },
        { type: "worker", id: worker, label: "Petra" },
      ),
    );
    const found = await mentionsOf(note);
    expect(found.map((m) => `${m.target_type}:${m.target_id}`)).toEqual([
      `contact:${contact}`,
      `deal:${deal}`,
      `event:${event}`,
      `worker:${worker}`,
    ]);
    expect(found.every((m) => m.user_id === owner)).toBe(true);
  });

  it("follows the content: a removed chip drops its row, a new one adds it", async () => {
    const note = await writeNote(owner, doc({ type: "contact", id: contact, label: "Jan" }));
    expect(await mentionsOf(note)).toHaveLength(1);

    await writeNote(owner, doc({ type: "deal", id: deal, label: "Web" }), note);
    expect((await mentionsOf(note)).map((m) => m.target_type)).toEqual(["deal"]);

    await writeNote(owner, { type: "doc", content: [] }, note);
    expect(await mentionsOf(note)).toHaveLength(0);
  });

  it("never lists someone else's record, a malformed id or an unknown type", async () => {
    const note = await writeNote(
      owner,
      doc(
        { type: "contact", id: strangerContact, label: "Cizí" },
        { type: "contact", id: "not-a-uuid", label: "?" },
        { type: "invoice", id: contact, label: "?" },
        { type: "contact", id: crypto.randomUUID(), label: "Smazaný" },
        { type: "deal", id: deal, label: "Web" },
      ),
    );
    // Only the valid one of the owner's records; the rest never breaks it.
    expect((await mentionsOf(note)).map((m) => m.target_id)).toEqual([deal]);
    // The note itself was saved normally.
    expect(await one(`select title from notes where id = $1`, [note])).toEqual({ title: "Plán" });
  });

  it("a worker's own note can not list the owner's records", async () => {
    const note = await writeNote(workerUser, doc({ type: "contact", id: contact, label: "Jan" }));
    expect(await mentionsOf(note)).toEqual([]);
  });

  it("goes with the note when it is deleted for good", async () => {
    const note = await writeNote(owner, doc({ type: "contact", id: contact, label: "Jan" }));
    expect(await mentionsOf(note)).toHaveLength(1);
    await db.query(`delete from notes where id = $1`, [note]);
    expect(await mentionsOf(note)).toHaveLength(0);
  });
});

describe("note mentions: access", () => {
  it("shows the owner only their own rows, never anyone else's", async () => {
    const note = await writeNote(owner, doc({ type: "contact", id: contact, label: "Jan" }));
    await asUser(owner);
    const mine = await rows(`select 1 from note_mentions where note_id = $1`, [note]);
    await asServer();
    expect(mine).toHaveLength(1);

    for (const uid of [stranger, workerUser]) {
      await asUser(uid);
      const seen = await rows(`select 1 from note_mentions where note_id = $1`, [note]);
      await asServer();
      expect(seen).toHaveLength(0);
    }
  });

  it("refuses every write from the client", async () => {
    const note = await writeNote(owner, doc({ type: "contact", id: contact, label: "Jan" }));
    await asUser(owner);
    try {
      await expect(
        db.query(
          `insert into note_mentions (user_id, note_id, target_type, target_id) values ($1, $2, 'deal', $3)`,
          [owner, note, deal],
        ),
      ).rejects.toThrow(/permission denied/);
      await expect(
        db.query(`update note_mentions set target_id = $2 where note_id = $1`, [note, deal]),
      ).rejects.toThrow(/permission denied/);
      await expect(db.query(`delete from note_mentions where note_id = $1`, [note])).rejects.toThrow(
        /permission denied/,
      );
    } finally {
      await asServer();
    }
    expect(await mentionsOf(note)).toHaveLength(1);
  });

  it("anon sees nothing", async () => {
    await db.exec(`select set_config('request.jwt.claim.sub', '', false); set role anon;`);
    try {
      await expect(db.query(`select 1 from note_mentions`)).rejects.toThrow(/permission denied/);
    } finally {
      await asServer();
    }
  });
});
