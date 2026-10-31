// @vitest-environment node
//
// Pipeline health (17.3) on the real migrations (PGlite): the stages a new
// space starts with, and when the last task of each open deal was finished,
// seen only by whoever may see the deal and its tasks.

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
let viewer: string; // worker who may see the pipeline
let doer: string; // worker without any section

async function rows<T = Row>(sql: string, params?: unknown[]): Promise<T[]> {
  return (await db.query<T>(sql, params as never)).rows;
}
async function one<T = Row>(sql: string, params?: unknown[]): Promise<T> {
  return (await rows<T>(sql, params))[0] as T;
}
async function as<T>(uid: string, run: () => Promise<T>): Promise<T> {
  await db.exec(
    `select set_config('request.jwt.claim.sub', '${uid}', false); set role authenticated;`,
  );
  try {
    return await run();
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
  }
}
async function createAuthUser(locale = "cs") {
  const { id } = await one<{ id: string }>(
    `insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id`,
    [`${crypto.randomUUID()}@example.com`, JSON.stringify({ locale })],
  );
  return id;
}
async function addWorker(ownerId: string, userId: string, sections: [string, boolean, boolean][]) {
  const { id } = await one<{ id: string }>(
    `insert into workers (owner_id, user_id, name, status) values ($1, $2, 'Worker', 'active') returning id`,
    [ownerId, userId],
  );
  for (const [section, view, edit] of sections) {
    await db.query(
      `insert into worker_permissions (owner_id, worker_id, section, can_view, can_edit)
       values ($1, $2, $3, $4, $5)`,
      [ownerId, id, section, view, edit],
    );
  }
}
async function stageId(uid: string, key: string) {
  return (
    await one<{ id: string }>(
      `select id from pipeline_stages where user_id = $1 and system_key = $2`,
      [uid, key],
    )
  ).id;
}
async function addDeal(uid: string, title: string, stageKey = "lead") {
  return (
    await one<{ id: string }>(
      `insert into deals (user_id, stage_id, title) values ($1, $2, $3) returning id`,
      [uid, await stageId(uid, stageKey), title],
    )
  ).id;
}
async function addTask(space: string, dealId: string, done: boolean, completedAt?: string) {
  const { id } = await one<{ id: string }>(
    `insert into crm_tasks (user_id, title, due_at, deal_id, assignee_id)
     values ($1, 'Zavolat', now() + interval '1 day', $2, $1) returning id`,
    [space, dealId],
  );
  if (done) {
    await db.query(`update crm_tasks set status = 'done' where id = $1`, [id]);
    // The guard stamps the finish; a test moves it into the past by hand.
    if (completedAt) {
      await db.query(`alter table crm_tasks disable trigger user`);
      await db.query(`update crm_tasks set completed_at = $2 where id = $1`, [id, completedAt]);
      await db.query(`alter table crm_tasks enable trigger user`);
    }
  }
  return id;
}
function lastDone(uid: string, space: string) {
  return as(uid, () =>
    rows<{ deal_id: string; last_done_at: string }>(
      `select deal_id, last_done_at::text from deal_tasks_last_done($1) order by deal_id`,
      [space],
    ),
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
  viewer = await createAuthUser();
  doer = await createAuthUser();
  await addWorker(owner, viewer, [["pipeline", true, false]]);
  await addWorker(owner, doer, []);
});

afterAll(async () => {
  await db?.close();
});

describe("stages of a new space", () => {
  it("starts with Nový lead · Schůzka · Koncept nabídky · Nabídka odeslána · Vyhráno · Ztraceno", async () => {
    const stages = await rows<{
      name: string;
      system_key: string;
      is_won: boolean;
      is_lost: boolean;
    }>(
      `select name, system_key, is_won, is_lost from pipeline_stages where user_id = $1 order by position`,
      [owner],
    );
    expect(stages).toEqual([
      { name: "Nový lead", system_key: "lead", is_won: false, is_lost: false },
      { name: "Schůzka", system_key: "meeting", is_won: false, is_lost: false },
      { name: "Koncept nabídky", system_key: "offer_draft", is_won: false, is_lost: false },
      { name: "Nabídka odeslána", system_key: "offer", is_won: false, is_lost: false },
      { name: "Vyhráno", system_key: "won", is_won: true, is_lost: false },
      { name: "Ztraceno", system_key: "lost", is_won: false, is_lost: true },
    ]);
  });

  it("names them in English for an English account and seeds nothing twice", async () => {
    const english = await createAuthUser("en");
    await db.exec(`select initialize_user('${english}', 'en')`);
    const names = await rows<{ name: string }>(
      `select name from pipeline_stages where user_id = $1 order by position`,
      [english],
    );
    expect(names.map((row) => row.name)).toEqual([
      "New lead",
      "Meeting",
      "Offer draft",
      "Offer sent",
      "Won",
      "Lost",
    ]);
  });
});

describe("deal_tasks_last_done", () => {
  let fresh: string;
  let worked: string;
  let won: string;

  beforeAll(async () => {
    fresh = await addDeal(owner, "Bez úkolů");
    worked = await addDeal(owner, "S hotovými úkoly");
    won = await addDeal(owner, "Vyhraný", "won");
    await addTask(owner, worked, true, "2026-10-01T08:00:00Z");
    await addTask(owner, worked, true, "2026-10-20T08:00:00Z");
    await addTask(owner, worked, false);
    await addTask(owner, won, true, "2026-10-25T08:00:00Z");
  });

  it("gives the owner the latest finish of each open deal, never of a won one", async () => {
    const result = await lastDone(owner, owner);
    expect(result.map((row) => row.deal_id)).toEqual([worked]);
    expect(Date.parse(result[0]!.last_done_at)).toBe(Date.parse("2026-10-20T08:00:00Z"));
    expect(result.some((row) => row.deal_id === fresh || row.deal_id === won)).toBe(false);
  });

  it("gives a worker with the pipeline the same, and nobody else anything", async () => {
    expect((await lastDone(viewer, owner)).map((row) => row.deal_id)).toEqual([worked]);
    expect(await lastDone(doer, owner)).toEqual([]);
    expect(await lastDone(stranger, owner)).toEqual([]);
  });

  it("is not callable without signing in", async () => {
    await db.exec(`select set_config('request.jwt.claim.sub', '', false); set role anon;`);
    try {
      await expect(db.query(`select * from deal_tasks_last_done($1)`, [owner])).rejects.toThrow(
        /permission denied/,
      );
    } finally {
      await db.exec(`reset role;`);
    }
  });
});
