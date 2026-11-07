// @vitest-environment node
//
// The tutorial (20.4) in the real migrations on an in-process Postgres
// (PGlite): only the server's functions mark sample data, the samples stay
// in the caller's own space, earn no XP, and deleting them leaves nothing
// marked and nothing hanging only on them, while the user's own rows stay.

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


const DEMO_TABLES = [
  "contacts",
  "deals",
  "milestones",
  "tasks",
  "crm_tasks",
  "calendar_events",
  "notes",
] as const;

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
  milestone: {
    title: "Ukázka: první zakázka",
    tasks: [{ title: "Připravit nabídku", children: ["Ceník", "Reference"] }, { title: "Zavolat" }],
  },
  crm_tasks: [
    { title: "Poslat nabídku", due_at: inDays(1), duration_minutes: 30 },
    { title: "Zavolat Petrovi", due_at: inDays(2) },
  ],
  meeting: { title: "Schůzka v kavárně", starts_at: inDays(2, 10) },
  note: {
    title: "Ideální zákazník",
    content: { type: "doc", content: [{ type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Ideální zákazník" }] }] },
    content_text: "Ideální zákazník",
  },
};


async function seed(uid: string, payload: unknown = PAYLOAD) {
  await asUser(uid);
  try {
    return (await one<{ result: Record<string, unknown> }>(`select tutorial_seed_demo($1::jsonb) as result`, [
      JSON.stringify(payload),
    ])).result;
  } finally {
    await asServer();
  }
}

async function demoCounts(uid: string) {
  await asServer();
  const counts: Record<string, number> = {};
  for (const table of DEMO_TABLES) {
    const { n } = await one<{ n: number }>(
      `select count(*)::int as n from ${table} where user_id = $1 and is_demo`,
      [uid],
    );
    counts[table] = n;
  }
  return counts;
}

async function award(uid: string, reason: string, ref: string | null = null) {
  await asUser(uid);
  try {
    return (await one<{ result: { awarded: boolean; xp: number } }>(`select award_xp($1, $2) as result`, [reason, ref])).result;
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
  stranger = await createAuthUser();
});

afterAll(async () => {
  await db?.close();
});

describe("profiles.tutorial", () => {
  it("takes the choice and the progress from the client, in shape", async () => {
    await asUser(owner);
    try {
      const state = { mode: "full", step: "contactCreate", started_at: new Date().toISOString(), finished_at: null };
      await db.query(`update profiles set tutorial = $2::jsonb where id = $1`, [owner, JSON.stringify(state)]);
      const { tutorial } = await one<{ tutorial: { mode: string } }>(`select tutorial from profiles where id = $1`, [owner]);
      expect(tutorial.mode).toBe("full");
      await expect(
        db.query(`update profiles set tutorial = '{"mode":"everything"}'::jsonb where id = $1`, [owner]),
      ).rejects.toThrow(/profiles_tutorial_check/);
      await expect(
        db.query(`update profiles set tutorial = '{"mode":"quick","step":"<script>"}'::jsonb where id = $1`, [owner]),
      ).rejects.toThrow(/profiles_tutorial_check/);
    } finally {
      await asServer();
    }
  });
});

describe("is_demo", () => {
  it("is never set by the client, on insert or update", async () => {
    await asUser(owner);
    try {
      const contact = await one<{ id: string; is_demo: boolean }>(
        `insert into contacts (user_id, first_name, is_demo) values ($1, 'Skutečný', true) returning id, is_demo`,
        [owner],
      );
      expect(contact.is_demo).toBe(false);
      await db.query(`update contacts set is_demo = true where id = $1`, [contact.id]);
      const after = await one<{ is_demo: boolean }>(`select is_demo from contacts where id = $1`, [contact.id]);
      expect(after.is_demo).toBe(false);
    } finally {
      await asServer();
    }
  });
});

describe("tutorial_seed_demo", () => {
  it("puts the samples into the caller's own space, all marked", async () => {
    const result = await seed(owner);
    expect(result.created).toBe(true);
    expect(await demoCounts(owner)).toEqual({
      contacts: 3,
      deals: 1,
      milestones: 1,
      tasks: 4,
      crm_tasks: 2,
      calendar_events: 1,
      notes: 1,
    });
    // Like any new contact: in the unreached table, and the deal's primary contact.
    const { entries } = await one<{ entries: number }>(
      `select count(*)::int as entries from contact_table_entries e join contacts c on c.id = e.contact_id
       where c.user_id = $1 and c.is_demo`,
      [owner],
    );
    expect(entries).toBe(3);
    const { primary } = await one<{ primary: number }>(
      `select count(*)::int as primary from deal_contacts dc join deals d on d.id = dc.deal_id
       where d.user_id = $1 and d.is_demo and dc.is_primary`,
      [owner],
    );
    expect(primary).toBe(1);
  });

  it("adds nothing the second time", async () => {
    const again = await seed(owner);
    expect(again.created).toBe(false);
    expect((await demoCounts(owner)).contacts).toBe(3);
  });

  it("is not seen by anybody else", async () => {
    await asUser(stranger);
    try {
      const { n } = await one<{ n: number }>(`select count(*)::int as n from contacts where is_demo`);
      expect(n).toBe(0);
    } finally {
      await asServer();
    }
  });

  it("refuses a request without a user and keeps the anon role out", async () => {
    await expect(db.query(`select tutorial_seed_demo('{}'::jsonb)`)).rejects.toThrow(/not_authenticated/);
    await db.exec(`set role anon`);
    try {
      await expect(db.query(`select tutorial_seed_demo('{}'::jsonb)`)).rejects.toThrow(/permission denied/);
      await expect(db.query(`select tutorial_delete_demo()`)).rejects.toThrow(/permission denied/);
    } finally {
      await asServer();
    }
  });
});

describe("XP", () => {
  it("is never given for a sample, and once for a finished tutorial", async () => {
    await asServer();
    const { id: demoTask } = await one<{ id: string }>(
      `select id from tasks where user_id = $1 and is_demo and parent_task_id is null
       and not exists (select 1 from tasks c where c.parent_task_id = tasks.id) limit 1`,
      [owner],
    );
    await asUser(owner);
    await db.query(`update tasks set status = 'done' where id = $1`, [demoTask]);
    await asServer();
    expect((await award(owner, "task_completed", demoTask)).awarded).toBe(false);

    await asUser(owner);
    await db.query(
      `update profiles set tutorial = $2::jsonb where id = $1`,
      [owner, JSON.stringify({ mode: "full", step: null, outcome: "abandoned", finished_at: new Date().toISOString() })],
    );
    await asServer();
    expect((await award(owner, "tutorial_completed")).awarded).toBe(false);

    await asUser(owner);
    await db.query(
      `update profiles set tutorial = $2::jsonb where id = $1`,
      [owner, JSON.stringify({ mode: "full", step: null, outcome: "finished", finished_at: new Date().toISOString() })],
    );
    await asServer();
    const first = await award(owner, "tutorial_completed");
    expect(first).toMatchObject({ awarded: true, xp: 100 });
    expect((await award(owner, "tutorial_completed")).awarded).toBe(false);
  });
});

describe("tutorial_delete_demo", () => {
  it("leaves nothing marked and nothing hanging only on a sample, and keeps the user's own rows", async () => {
    await asServer();
    const { id: demoDeal } = await one<{ id: string }>(`select id from deals where user_id = $1 and is_demo`, [owner]);
    const { id: demoContact } = await one<{ id: string }>(
      `select id from contacts where user_id = $1 and is_demo order by created_at, id limit 1`,
      [owner],
    );
    await asUser(owner);
    // The user's own work around the samples, as in the tutorial.
    const ownTask = await one<{ id: string }>(
      `insert into crm_tasks (user_id, title, due_at, deal_id) values ($1, 'Moje', now() + interval '1 day', $2) returning id`,
      [owner, demoDeal],
    );
    const draft = await one<{ id: string }>(
      `insert into invoices (user_id, amount, deal_id) values ($1, 0, $2) returning id`,
      [owner, demoDeal],
    );
    const ownContact = await one<{ id: string }>(
      `insert into contacts (user_id, first_name) values ($1, 'Opravdový') returning id`,
      [owner],
    );
    const { id: stage } = await one<{ id: string }>(
      `select id from pipeline_stages where user_id = $1 and not is_won and not is_lost order by position limit 1`,
      [owner],
    );
    const ownDeal = await one<{ id: string }>(
      `insert into deals (user_id, stage_id, title, contact_id) values ($1, $2, 'Můj obchod', $3) returning id`,
      [owner, stage, demoContact],
    );
    const result = (await one<{ result: { deleted: number } }>(`select tutorial_delete_demo() as result`)).result;
    expect(result.deleted).toBeGreaterThan(0);
    await asServer();

    expect(Object.values(await demoCounts(owner)).every((n) => n === 0)).toBe(true);
    const left = async (sql: string, id: string) =>
      (await one<{ n: number }>(sql, [id])).n;
    expect(await left(`select count(*)::int as n from crm_tasks where id = $1`, ownTask.id)).toBe(0);
    expect(await left(`select count(*)::int as n from invoices where id = $1`, draft.id)).toBe(0);
    expect(await left(`select count(*)::int as n from contacts where id = $1`, ownContact.id)).toBe(1);
    expect(await left(`select count(*)::int as n from deals where id = $1`, ownDeal.id)).toBe(1);
  });

  it("lets the samples come again afterwards", async () => {
    expect((await seed(owner)).created).toBe(true);
    expect((await demoCounts(owner)).notes).toBe(1);
  });
});
