// @vitest-environment node
//
// Activity in the company (step 28.7) on the real migrations (PGlite): the
// database writes "who did what" from the changes themselves, labels steps
// made through Grady, shows the owner everybody and a worker their branch,
// blanks titles and amounts of sections the reader may not see, and nobody
// writes or reads the table directly. Deal attachments: whoever sees the
// deal reads them, whoever may update it adds them.

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
type FeedRow = {
  actor_id: string;
  via: string;
  verb: string;
  object_kind: string;
  summary: Record<string, unknown>;
};

let db: PGlite;
let owner: string;
let stranger: string;
let anna: string; // assistant: no pipeline, no company view of others
let boss: string; // manager of ben, sees the pipeline without amounts
let ben: string;
let annaWorker: string;
let bossWorker: string;

async function rows<T = Row>(sql: string, params?: unknown[]): Promise<T[]> {
  return (await db.query<T>(sql, params as never)).rows;
}
async function one<T = Row>(sql: string, params?: unknown[]): Promise<T> {
  return (await rows<T>(sql, params))[0] as T;
}
async function as<T>(uid: string, run: () => Promise<T>, via?: string): Promise<T> {
  const headers = JSON.stringify(via ? { "x-gradus-via": via } : {});
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid]);
  await db.query(`select set_config('request.headers', $1, false)`, [headers]);
  await db.exec(`set role authenticated`);
  try {
    return await run();
  } finally {
    await db.exec(
      `reset role; select set_config('request.jwt.claim.sub', '', false); select set_config('request.headers', '', false);`,
    );
  }
}
async function createAuthUser() {
  const { id } = await one<{ id: string }>(
    `insert into auth.users (email, raw_user_meta_data) values ($1, '{"locale":"cs"}') returning id`,
    [`${crypto.randomUUID()}@example.com`],
  );
  return id;
}
async function addWorker(account: string, actions: Record<string, string[]>, manager?: string) {
  const { id } = await one<{ id: string }>(
    `insert into workers (owner_id, user_id, name, status, manager_id)
     values ($1, $2, 'W', 'active', $3) returning id`,
    [owner, account, manager ?? null],
  );
  await as(owner, () =>
    db.query(
      `insert into worker_permission_grants (owner_id, worker_id, section, action, allowed)
       select $1, $2, c.section, c.action, coalesce((($3::jsonb) -> c.section) ? c.action, false)
       from permission_catalog() c
       on conflict (worker_id, section, action) do update set allowed = excluded.allowed`,
      [owner, id, JSON.stringify(actions)],
    ),
  );
  return id;
}
async function stage(which: "open" | "won") {
  return (
    await one<{ id: string }>(
      `select id from pipeline_stages where user_id = $1 and ${
        which === "won" ? "is_won" : "not is_won and not is_lost"
      } order by position limit 1`,
      [owner],
    )
  ).id;
}
function feed(uid: string, extra = "") {
  return as(uid, () =>
    rows<FeedRow>(
      `select actor_id, via, verb, object_kind, summary
       from activity_feed($1, now() - interval '1 day', now() + interval '1 day'${extra})`,
      [owner],
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
  anna = await createAuthUser();
  boss = await createAuthUser();
  ben = await createAuthUser();
  annaWorker = await addWorker(anna, {
    milestones: ["view", "update"],
    contacts: ["view", "create", "update"],
    tasks: ["view", "view_all", "create", "update", "assign_others"],
    calendar: ["view", "view_all", "create", "update"],
    company: ["view"],
  });
  bossWorker = await addWorker(boss, {
    pipeline: ["view", "view_all", "create", "update", "change_stage"],
    company: ["view"],
  });
  await addWorker(
    ben,
    { pipeline: ["view", "view_all", "create", "update", "change_stage"], company: ["view"] },
    bossWorker,
  );
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe("activity_log", () => {
  it("records a deal's making, move and win from the changes themselves", async () => {
    const open = await stage("open");
    const won = await stage("won");
    const deal = await as(owner, () =>
      one<{ id: string }>(
        `insert into deals (user_id, stage_id, title, value, currency)
         values ($1, $2, 'Web pro pekárnu', 25000, 'CZK') returning id`,
        [owner, open],
      ),
    );
    await as(owner, () => db.query(`update deals set stage_id = $1 where id = $2`, [won, deal.id]));
    const mine = (await feed(owner)).filter((row) => row.object_kind === "deal");
    expect(mine.map((row) => row.verb)).toEqual(["won", "created"]);
    expect(mine[0].summary).toMatchObject({
      title: "Web pro pekárnu",
      amount: 25000,
      currency: "CZK",
    });
    expect(mine.every((row) => row.actor_id === owner && row.via === "app")).toBe(true);
  });

  it("labels a step made through Grady (the server's own header)", async () => {
    const contact = await as(
      owner,
      () =>
        one<{ id: string }>(
          `insert into contacts (user_id, first_name, last_name) values ($1, 'Jana', 'Nová') returning id`,
          [owner],
        ),
      "grady",
    );
    const row = (await feed(owner)).find(
      (item) => item.object_kind === "contact" && item.verb === "created",
    );
    expect(row?.via).toBe("grady");
    expect(row?.summary.title).toBe("Jana Nová");
    await as(owner, () => db.query(`delete from contacts where id = $1`, [contact.id]));
  });

  it("writes nothing for samples or without a signed-in user", async () => {
    const before = (await one<{ n: number }>(`select count(*)::int as n from activity_log`)).n;
    await db.query(`insert into contacts (user_id, first_name) values ($1, 'Server')`, [owner]);
    // The tutorial's seed: signed in, through the database's own function (not the client's role).
    await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [owner]);
    await db.query(
      `insert into crm_tasks (user_id, title, due_at, contact_id, is_demo, created_by)
       select $1, 'Ukázka', now(), id, true, $1 from contacts where user_id = $1 limit 1`,
      [owner],
    );
    await db.query(`select set_config('request.jwt.claim.sub', '', false)`);
    const after = (await one<{ n: number }>(`select count(*)::int as n from activity_log`)).n;
    expect(after).toBe(before);
  });

  it("shows a worker their own branch: the manager sees ben, ben does not see the manager", async () => {
    const open = await stage("open");
    await as(ben, () =>
      db.query(
        `insert into deals (user_id, stage_id, title, value) values ($1, $2, 'Benův', 100)`,
        [owner, open],
      ),
    );
    await as(boss, () =>
      db.query(
        `insert into deals (user_id, stage_id, title, value) values ($1, $2, 'Šéfův', 200)`,
        [owner, open],
      ),
    );
    const bossSees = new Set((await feed(boss)).map((row) => row.actor_id));
    expect(bossSees.has(ben)).toBe(true);
    expect(bossSees.has(boss)).toBe(true);
    expect(bossSees.has(owner)).toBe(false);
    const benSees = new Set((await feed(ben)).map((row) => row.actor_id));
    expect([...benSees]).toEqual([ben]);
    // The owner sees everybody.
    const ownerSees = new Set((await feed(owner)).map((row) => row.actor_id));
    expect(ownerSees.has(ben) && ownerSees.has(boss) && ownerSees.has(owner)).toBe(true);
  });

  it("blanks amounts without 'see amounts' and titles of sections the reader does not see", async () => {
    const bossRow = (await feed(boss)).find((row) => row.summary.title === "Benův");
    expect(bossRow?.summary.title).toBe("Benův");
    expect(bossRow?.summary.amount).toBeUndefined();
    // Anna (no pipeline) sees only herself; her own deal-less steps keep their titles.
    await as(anna, () =>
      db.query(
        `insert into crm_tasks (user_id, title, due_at, contact_id)
         select $1, 'Zavolat Janě', now(), id from contacts where user_id = $1 limit 1`,
        [owner],
      ),
    );
    const annaRows = await feed(anna);
    expect(annaRows.length).toBeGreaterThan(0);
    expect(annaRows.every((row) => row.actor_id === anna)).toBe(true);
    expect(annaRows[0].summary.title).toBe("Zavolat Janě");
  });

  it("counts a person's day: tasks, deals, calls, meetings", async () => {
    const day = await as(owner, () =>
      rows<{ actor_id: string; deals: number; total: number }>(
        `select * from activity_daily($1, now() - interval '1 day', now() + interval '1 day', 'Europe/Prague')`,
        [owner],
      ),
    );
    const own = day.find((row) => row.actor_id === owner);
    expect(own?.deals).toBeGreaterThanOrEqual(1);
    const benDay = day.find((row) => row.actor_id === ben);
    expect(benDay?.deals).toBe(1);
  });

  it("is closed to clients: no direct read or write, nothing for a stranger", async () => {
    await expect(as(owner, () => db.query(`select * from activity_log`))).rejects.toThrow();
    await expect(
      as(owner, () =>
        db.query(
          `insert into activity_log (space_id, actor_id, verb, object_kind) values ($1, $1, 'won', 'deal')`,
          [owner],
        ),
      ),
    ).rejects.toThrow();
    expect(await feed(stranger)).toEqual([]);
    // A removed worker loses it at once.
    await db.query(`update workers set status = 'inactive' where id = $1`, [annaWorker]);
    expect(await feed(anna)).toEqual([]);
    await db.query(`update workers set status = 'active' where id = $1`, [annaWorker]);
  });

  it("keeps 180 days", async () => {
    await db.query(
      `insert into activity_log (space_id, actor_id, verb, object_kind, created_at)
       values ($1, $1, 'created', 'deal', now() - interval '181 days')`,
      [owner],
    );
    const removed = (await one<{ n: number }>(`select purge_activity_log() as n`)).n;
    expect(removed).toBe(1);
  });
});

describe("deal_attachments", () => {
  it("are added by whoever may update the deal and read by whoever sees it", async () => {
    const open = await stage("open");
    const deal = await as(owner, () =>
      one<{ id: string }>(
        `insert into deals (user_id, stage_id, title) values ($1, $2, 'Přepis') returning id`,
        [owner, open],
      ),
    );
    const added = await as(boss, () =>
      one<{ id: string }>(
        `insert into deal_attachments (user_id, deal_id, name, content)
         values ($1, $2, 'Zápis.txt', 'Jana: Ahoj') returning id`,
        [owner, deal.id],
      ),
    );
    expect(added.id).toBeTruthy();
    const benReads = await as(ben, () =>
      rows(`select id from deal_attachments where deal_id = $1`, [deal.id]),
    );
    expect(benReads.length).toBe(1);
    // No pipeline rights: neither read nor add.
    const annaReads = await as(anna, () =>
      rows(`select id from deal_attachments where deal_id = $1`, [deal.id]),
    );
    expect(annaReads.length).toBe(0);
    await expect(
      as(anna, () =>
        db.query(
          `insert into deal_attachments (user_id, deal_id, name, content) values ($1, $2, 'x', 'y')`,
          [owner, deal.id],
        ),
      ),
    ).rejects.toThrow();
    // Nobody changes one; it can only be removed.
    await expect(
      as(owner, () =>
        db.query(`update deal_attachments set content = 'z' where id = $1`, [added.id]),
      ),
    ).rejects.toThrow();
  });
});
