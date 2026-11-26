// @vitest-environment node
//
// A worker's tutorial in a company (30.2) on the real migrations in PGlite:
// the sample data goes into the company only in the sections the worker's
// rights open, ending it removes exactly those rows (the owner's own samples
// and everything else stay), the owner's tutorial is not blocked by a
// worker's samples, and space_tutorials is each person's own, only in
// companies they are an active member of.

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

async function rows<T = Row>(sql: string, params?: unknown[]): Promise<T[]> {
  return (await db.query<T>(sql, params as never)).rows;
}
async function one<T = Row>(sql: string, params?: unknown[]): Promise<T> {
  return (await rows<T>(sql, params))[0] as T;
}
async function asUser(uid: string, space?: string) {
  const headers = JSON.stringify(space === undefined ? {} : { "x-gradus-space": space });
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid]);
  await db.query(`select set_config('request.headers', $1, false)`, [headers]);
  await db.exec(`set role authenticated`);
}
async function asServer() {
  await db.exec(
    `reset role; select set_config('request.jwt.claim.sub', '', false); select set_config('request.headers', '', false);`,
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

/** A worker record of `owner` for `account` with exactly these rights. */
async function hire(owner: string, account: string, rights: "all" | Array<[string, string]>) {
  await asServer();
  const { id } = await one<{ id: string }>(
    `insert into workers (owner_id, user_id, name, status) values ($1, $2, 'Member', 'active') returning id`,
    [owner, account],
  );
  await db.query(
    `insert into worker_permission_grants (owner_id, worker_id, section, action, allowed)
     select $1, $2, c.section, c.action, $3 from permission_catalog() c
     on conflict (worker_id, section, action) do update set allowed = excluded.allowed`,
    [owner, id, rights === "all"],
  );
  if (rights !== "all") {
    for (const [section, action] of rights) {
      await db.query(
        `update worker_permission_grants set allowed = true where worker_id = $1 and section = $2 and action = $3`,
        [id, section, action],
      );
    }
  }
  return id;
}

const inDays = (days: number, hour = 9) => {
  const at = new Date();
  at.setUTCDate(at.getUTCDate() + days);
  at.setUTCHours(hour, 0, 0, 0);
  return at.toISOString();
};

const PAYLOAD = {
  contacts: [
    { first_name: "Jana", last_name: "Ukázková", company_name: "Kavárna U Mlýna", email: "jana@example.com", city: "Brno" },
    { first_name: "Petr", last_name: "Vzorový", company_name: "Pekárna Klas", email: "petr@example.com", city: "Olomouc" },
    { first_name: "Eva", last_name: "Testovací", company_name: "Květiny Eva", email: "eva@example.com", city: "Praha" },
  ],
  deal: { title: "Kavárna U Mlýna — web", value: 25000, expected_close_date: inDays(-3).slice(0, 10) },
  milestone: { title: "Ukázka: první zakázka", tasks: [{ title: "Připravit nabídku", children: ["Ceník"] }] },
  crm_tasks: [
    { title: "Poslat nabídku", due_at: inDays(1), duration_minutes: 30 },
    { title: "Zavolat Petrovi", due_at: inDays(2) },
  ],
  meeting: { title: "Schůzka v kavárně", starts_at: inDays(2, 10) },
  note: {
    title: "Ideální zákazník",
    content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Ideální zákazník" }] }] },
    content_text: "Ideální zákazník",
  },
};

async function call<T = Row>(uid: string, space: string, sql: string, params: unknown[] = []) {
  await asUser(uid, space);
  try {
    return await one<T>(sql, params);
  } finally {
    await asServer();
  }
}

async function demoIn(space: string) {
  await asServer();
  const count = async (sql: string) => (await one<{ n: number }>(sql, [space])).n;
  return {
    contacts: await count(`select count(*)::int as n from contacts where user_id = $1 and is_demo`),
    deals: await count(`select count(*)::int as n from deals where user_id = $1 and is_demo`),
    milestones: await count(`select count(*)::int as n from milestones where user_id = $1 and is_demo`),
    crm_tasks: await count(`select count(*)::int as n from crm_tasks where user_id = $1 and is_demo`),
    events: await count(`select count(*)::int as n from calendar_events where user_id = $1 and is_demo`),
    notes: await count(`select count(*)::int as n from notes where space_id = $1 and is_demo`),
  };
}

let owner: string;
let caller: string;
let seller: string;
let stranger: string;

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
  caller = await createAuthUser();
  seller = await createAuthUser();
  stranger = await createAuthUser();
  // A cold caller: Cold Calling and their own tasks, nothing else.
  await hire(owner, caller, [
    ["cold_calling", "view"],
    ["cold_calling", "call"],
    ["tasks", "view"],
    ["tasks", "create"],
  ]);
  await hire(owner, seller, "all");
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe("tutorial_seed_worker_demo", () => {
  it("puts a cold caller's samples only where their rights open: contacts, their tasks, their note", async () => {
    const result = await call<{ r: { created: boolean; sections: string[] } }>(
      caller,
      owner,
      `select tutorial_seed_worker_demo($1::jsonb) as r`,
      [JSON.stringify(PAYLOAD)],
    );
    expect(result.r.created).toBe(true);
    expect(result.r.sections).toEqual(["contacts"]);
    expect(await demoIn(owner)).toEqual({ contacts: 3, deals: 0, milestones: 0, crm_tasks: 2, events: 0, notes: 1 });
    await asServer();
    const tasks = await rows<{ assignee_id: string; created_by: string; deal_id: string | null; contact_id: string | null }>(
      `select assignee_id, created_by, deal_id, contact_id from crm_tasks where user_id = $1 and is_demo`,
      [owner],
    );
    expect(tasks.every((task) => task.assignee_id === caller && task.created_by === caller)).toBe(true);
    expect(tasks.every((task) => task.deal_id === null && task.contact_id !== null)).toBe(true);
    const note = await one<{ user_id: string }>(`select user_id from notes where space_id = $1 and is_demo`, [owner]);
    expect(note.user_id).toBe(caller);
    // A second call adds nothing.
    const again = await call<{ r: { created: boolean } }>(caller, owner, `select tutorial_seed_worker_demo($1::jsonb) as r`, [
      JSON.stringify(PAYLOAD),
    ]);
    expect(again.r.created).toBe(false);
    expect((await demoIn(owner)).contacts).toBe(3);
    // The cold caller sees the sample contacts and the tasks given to them.
    await asUser(caller, owner);
    const visible = await one<{ n: number }>(`select count(*)::int as n from crm_tasks where user_id = $1 and is_demo`, [owner]);
    expect(visible.n).toBe(2);
    await asServer();
  });

  it("gives a worker with every right the deal, milestone and meeting, theirs", async () => {
    await call(seller, owner, `select tutorial_seed_worker_demo($1::jsonb) as r`, [JSON.stringify(PAYLOAD)]);
    await asServer();
    const deal = await one<{ assignee_id: string; created_by: string }>(
      `select assignee_id, created_by from deals where user_id = $1 and is_demo`,
      [owner],
    );
    expect(deal).toEqual({ assignee_id: seller, created_by: seller });
    const event = await one<{ actor_id: string }>(`select actor_id from calendar_events where user_id = $1 and is_demo`, [owner]);
    expect(event.actor_id).toBe(seller);
    expect((await demoIn(owner)).milestones).toBe(1);
  });

  it("does not block the owner's own samples, and the owner's are not the workers'", async () => {
    await asUser(owner, owner);
    const result = await one<{ r: { created: boolean } }>(`select tutorial_seed_demo($1::jsonb) as r`, [
      JSON.stringify(PAYLOAD),
    ]);
    await asServer();
    expect(result.r.created).toBe(true);
    expect((await demoIn(owner)).deals).toBe(2);
  });

  it("removes exactly the worker's samples at the end; the others' and the owner's stay", async () => {
    const before = await demoIn(owner);
    const { r } = await call<{ r: { deleted: number } }>(caller, owner, `select tutorial_delete_worker_demo() as r`);
    expect(r.deleted).toBeGreaterThan(0);
    const after = await demoIn(owner);
    expect(after.contacts).toBe(before.contacts - 3);
    expect(after.crm_tasks).toBe(before.crm_tasks - 2);
    expect(after.notes).toBe(before.notes - 1);
    expect(after.deals).toBe(before.deals);
    expect(after.milestones).toBe(before.milestones);
    await asServer();
    const left = await one<{ n: number }>(
      `select count(*)::int as n from tutorial_demo_rows where space_id = $1 and user_id = $2`,
      [owner, caller],
    );
    expect(left.n).toBe(0);
    // And a new run seeds again.
    const fresh = await call<{ r: { created: boolean } }>(caller, owner, `select tutorial_seed_worker_demo($1::jsonb) as r`, [
      JSON.stringify(PAYLOAD),
    ]);
    expect(fresh.r.created).toBe(true);
  });

  it("is only for an active worker of the open company", async () => {
    for (const [uid, space] of [
      [owner, owner],
      [stranger, owner],
      [stranger, stranger],
    ] as const) {
      await asUser(uid, space);
      await expect(db.query(`select tutorial_seed_worker_demo('{}'::jsonb)`)).rejects.toThrow(/tutorial_worker_only/);
      await expect(db.query(`select tutorial_delete_worker_demo()`)).rejects.toThrow(/tutorial_worker_only/);
      await asServer();
    }
  });

  it("keeps the list of sample rows away from every client", async () => {
    await asUser(seller, owner);
    await expect(db.query(`select * from tutorial_demo_rows`)).rejects.toThrow();
    await expect(db.query(`select tutorial_worker_space()`)).rejects.toThrow();
    await asServer();
  });
});

describe("space_tutorials", () => {
  const state = JSON.stringify({ mode: "quick", step: null, started_at: "2026-11-26T10:00:00Z" });

  it("is written by the person for a company they work in, never for their own space or another's", async () => {
    await asUser(caller, owner);
    await db.query(`insert into space_tutorials (space_id, state, known_sections) values ($1, $2::jsonb, $3)`, [
      owner,
      state,
      ["dashboard", "coldCalling"],
    ]);
    await db.query(`update space_tutorials set known_sections = $2 where space_id = $1`, [
      owner,
      ["dashboard", "coldCalling", "finance"],
    ]);
    await expect(
      db.query(`insert into space_tutorials (space_id, state) values ($1, $2::jsonb)`, [caller, state]),
    ).rejects.toThrow();
    await expect(
      db.query(`insert into space_tutorials (space_id, state) values ($1, $2::jsonb)`, [stranger, state]),
    ).rejects.toThrow();
    await expect(
      db.query(`insert into space_tutorials (user_id, space_id, state) values ($1, $2, $3::jsonb)`, [seller, owner, state]),
    ).rejects.toThrow();
    // Not a state: refused.
    await expect(
      db.query(`update space_tutorials set state = '{"mode":"later"}'::jsonb where space_id = $1`, [owner]),
    ).rejects.toThrow();
    await asServer();
  });

  it("is read only by the person", async () => {
    await asUser(seller, owner);
    expect((await rows(`select * from space_tutorials`)).length).toBe(0);
    await asUser(owner, owner);
    expect((await rows(`select * from space_tutorials`)).length).toBe(0);
    await asUser(caller, owner);
    const mine = await rows<{ known_sections: string[] }>(`select known_sections from space_tutorials`);
    expect(mine).toEqual([{ known_sections: ["dashboard", "coldCalling", "finance"] }]);
    await asServer();
  });
});
