// @vitest-environment node
//
// Mind map notes (20.3) in the real migrations on an in-process Postgres
// (PGlite): the kind and the shape of the content always agree, the client
// may convert its own note, nobody else's, and a record linked from a node
// is listed like a chip in text.

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


const mapContent = (title: string, link?: unknown) =>
  JSON.stringify({
    type: "mindmap",
    version: 1,
    root: {
      id: "root",
      title,
      children: [{ id: "a", title: "Kavárny", children: [], ...(link ? { link } : {}) }],
    },
  });

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
});

afterAll(async () => {
  await db?.close();
});

async function insertAs(uid: string, kind: string | null, content: string, text = "x") {
  await asUser(uid);
  try {
    const columns = kind === null ? "user_id, title, content, content_text" : "user_id, title, content, content_text, kind";
    const values = kind === null ? "$1, 'Mapa', $2::jsonb, $3" : "$1, 'Mapa', $2::jsonb, $3, $4";
    const params = kind === null ? [uid, content, text] : [uid, content, text, kind];
    return await one<{ id: string; kind: string; updated_at: string }>(
      `insert into notes (${columns}) values (${values}) returning id, kind, updated_at`,
      params,
    );
  } finally {
    await asServer();
  }
}

describe("notes.kind", () => {
  it("is text by default, so every existing note stays as it was", async () => {
    const note = await insertAs(owner, null, '{"type":"doc","content":[]}');
    expect(note.kind).toBe("text");
  });

  it("stores a map only as a map, and a map's content never as text", async () => {
    const map = await insertAs(owner, "mindmap", mapContent("Konkurence"), "Konkurence\n  Kavárny");
    expect(map.kind).toBe("mindmap");
    await expect(insertAs(owner, "mindmap", '{"type":"doc","content":[]}')).rejects.toThrow(
      /notes_kind_content_check/,
    );
    await expect(insertAs(owner, "text", mapContent("x"))).rejects.toThrow(/notes_kind_content_check/);
    await expect(insertAs(owner, "mindmap", '{"type":"mindmap","root":"nope"}')).rejects.toThrow(
      /notes_kind_content_check/,
    );
    await expect(insertAs(owner, "drawing", '{"type":"doc","content":[]}')).rejects.toThrow(
      /notes_kind_check/,
    );
  });

  it("lets the owner turn a note into the other kind, with its content, and nobody else", async () => {
    const note = await insertAs(owner, null, '{"type":"doc","content":[]}', "Plán");
    await asUser(owner);
    await expect(
      db.query(`update notes set kind = 'mindmap' where id = $1`, [note.id]),
    ).rejects.toThrow(/notes_kind_content_check/);
    await db.query(
      `update notes set kind = 'mindmap', content = $2::jsonb, content_text = 'Plán\n  Kavárny' where id = $1`,
      [note.id, mapContent("Plán")],
    );
    await asServer();
    const converted = await one<{ kind: string; updated_at: string }>(
      `select kind, updated_at from notes where id = $1`,
      [note.id],
    );
    expect(converted.kind).toBe("mindmap");

    // Someone else neither sees it nor changes it.
    await asUser(stranger);
    const seen = await rows(`select id from notes where id = $1`, [note.id]);
    expect(seen).toHaveLength(0);
    await db.query(
      `update notes set kind = 'text', content = '{"type":"doc","content":[]}'::jsonb where id = $1`,
      [note.id],
    );
    await asServer();
    expect((await one<{ kind: string }>(`select kind from notes where id = $1`, [note.id])).kind).toBe(
      "mindmap",
    );
  });

  it("lists a contact linked from a node, and only the owner's own", async () => {
    const contact = await one<{ id: string }>(
      `insert into contacts (user_id, first_name, last_name) values ($1, 'Jan', 'Novák') returning id`,
      [owner],
    );
    const foreign = await one<{ id: string }>(
      `insert into contacts (user_id, company_name) values ($1, 'Cizí s.r.o.') returning id`,
      [stranger],
    );
    const link = (id: string) => ({ type: "mention", attrs: { type: "contact", id, label: "Jan" } });
    const mine = await insertAs(owner, "mindmap", mapContent("Lidé", link(contact.id)));
    const forged = await insertAs(owner, "mindmap", mapContent("Lidé", link(foreign.id)));
    const listed = await rows<{ note_id: string; target_id: string }>(
      `select note_id, target_id from note_mentions where note_id in ($1, $2)`,
      [mine.id, forged.id],
    );
    expect(listed).toEqual([{ note_id: mine.id, target_id: contact.id }]);
  });
});
