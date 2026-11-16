// @vitest-environment node
//
// More people on one deal on the real migrations (PGlite): everyone on the
// deal sees and edits it with "only own deals", deals.assignee_id follows the
// list, the whole list at once, a removed worker leaves their open deals.

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
let anna: string; // only own deals, may edit
let ben: string; // only own deals, may edit
let cyril: string; // only own deals, may only look
let annaWorker: string;
let benWorker: string;

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
async function createAuthUser() {
  const { id } = await one<{ id: string }>(
    `insert into auth.users (email, raw_user_meta_data) values ($1, '{"locale":"cs"}') returning id`,
    [`${crypto.randomUUID()}@example.com`],
  );
  return id;
}
async function addWorker(account: string, actions: Record<string, string[]>) {
  const { id } = await one<{ id: string }>(
    `insert into workers (owner_id, user_id, name, status) values ($1, $2, 'W', 'active') returning id`,
    [owner, account],
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
async function openStage() {
  return (
    await one<{ id: string }>(
      `select id from pipeline_stages where user_id = $1 and not is_won and not is_lost
       order by position limit 1`,
      [owner],
    )
  ).id;
}
async function addDeal(title: string, by = owner) {
  const stage = await openStage();
  return as(by, () =>
    one<{ id: string; assignee_id: string | null }>(
      `insert into deals (user_id, stage_id, title) values ($1, $2, $3) returning id, assignee_id`,
      [owner, stage, title],
    ),
  );
}
function people(dealId: string) {
  return rows<{ assignee_id: string }>(
    `select assignee_id from deal_assignees where deal_id = $1 order by created_at, assignee_id`,
    [dealId],
  ).then((list) => list.map((r) => r.assignee_id).sort());
}
async function mirror(dealId: string) {
  return (await one<{ assignee_id: string | null }>(`select assignee_id from deals where id = $1`, [dealId]))
    .assignee_id;
}
const sorted = (...ids: string[]) => [...ids].sort();

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
  ben = await createAuthUser();
  cyril = await createAuthUser();
  const seller = {
    pipeline: ["view", "create", "update", "change_stage"],
    tasks: ["view", "view_all"],
  };
  annaWorker = await addWorker(anna, seller);
  benWorker = await addWorker(ben, seller);
  await addWorker(cyril, { pipeline: ["view"] });
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe("deal_assignees", () => {
  it("starts a new deal with the person who made it, in the list and the mirror", async () => {
    const deal = await addDeal("Web", anna);
    expect(deal.assignee_id).toBe(anna);
    expect(await people(deal.id)).toEqual([anna]);
  });

  it("lets everyone on a deal see and edit it with only own deals", async () => {
    const deal = await addDeal("Shop");
    const seen = () =>
      as(ben, () => rows(`select id from deals where id = $1`, [deal.id])).then((r) => r.length);
    expect(await seen()).toBe(0);

    await as(owner, () => db.query(`select deal_set_assignees($1, $2)`, [deal.id, [owner, ben]]));
    expect(await people(deal.id)).toEqual(sorted(owner, ben));
    expect(await seen()).toBe(1);
    const changed = await as(ben, () =>
      rows(`update deals set title = 'Shop 2' where id = $1 returning id`, [deal.id]),
    );
    expect(changed).toHaveLength(1);
    // The list reads with the deal; a stranger sees none of it.
    expect(await as(ben, () => rows(`select * from deal_assignees where deal_id = $1`, [deal.id]))).toHaveLength(2);
    expect(await as(stranger, () => rows(`select * from deal_assignees where deal_id = $1`, [deal.id]))).toHaveLength(0);
    expect(await as(anna, () => rows(`select * from deal_assignees where deal_id = $1`, [deal.id]))).toHaveLength(0);
  });

  it("shows the tasks of the deal to everyone on it", async () => {
    const deal = await addDeal("Tasks");
    await as(owner, () =>
      db.query(
        `insert into crm_tasks (user_id, title, due_at, deal_id, assignee_id) values ($1, 'Call', now(), $2, $1)`,
        [owner, deal.id],
      ),
    );
    const count = () =>
      as(anna, () => rows(`select id from crm_tasks where deal_id = $1`, [deal.id])).then((r) => r.length);
    expect(await count()).toBe(0);
    await as(owner, () => db.query(`select deal_set_assignees($1, $2)`, [deal.id, [owner, anna]]));
    expect(await count()).toBe(1);
  });

  it("keeps deals.assignee_id on the longest-serving person", async () => {
    const deal = await addDeal("Mirror");
    await as(owner, () => db.query(`select deal_set_assignees($1, $2)`, [deal.id, [owner, anna, ben]]));
    expect(await mirror(deal.id)).toBe(owner);
    await as(owner, () => db.query(`select deal_set_assignees($1, $2)`, [deal.id, [anna, ben]]));
    expect(await people(deal.id)).toEqual(sorted(anna, ben));
    expect([anna, ben]).toContain(await mirror(deal.id));
  });

  it("swaps the person when old code changes deals.assignee_id", async () => {
    const deal = await addDeal("Legacy");
    await as(owner, () => db.query(`select deal_set_assignees($1, $2)`, [deal.id, [owner, anna]]));
    await as(owner, () => db.query(`update deals set assignee_id = $2 where id = $1`, [deal.id, ben]));
    expect(await people(deal.id)).toEqual(sorted(anna, ben));
    expect(await mirror(deal.id)).toBe(ben);
  });

  it("refuses an empty list, a stranger and a worker who may not edit", async () => {
    const deal = await addDeal("Guard");
    await expect(
      as(owner, () => db.query(`select deal_set_assignees($1, $2)`, [deal.id, []])),
    ).rejects.toThrow(/deal_assignees_empty/);
    await expect(
      as(owner, () => db.query(`select deal_set_assignees($1, $2)`, [deal.id, [owner, stranger]])),
    ).rejects.toThrow(/deal_assignee_outside/);
    await as(owner, () => db.query(`select deal_set_assignees($1, $2)`, [deal.id, [owner, cyril]]));
    await expect(
      as(cyril, () => db.query(`select deal_set_assignees($1, $2)`, [deal.id, [cyril]])),
    ).rejects.toThrow(/deal_assignees_forbidden/);
    await expect(
      as(cyril, () =>
        db.query(`insert into deal_assignees (user_id, deal_id, assignee_id) values ($1, $2, $3)`, [
          owner,
          deal.id,
          anna,
        ]),
      ),
    ).rejects.toThrow();
    expect(await people(deal.id)).toEqual(sorted(owner, cyril));
  });

  it("keeps someone who left the space on the deal while the others change", async () => {
    const leaver = await createAuthUser();
    const leaverWorker = await addWorker(leaver, { pipeline: ["view"] });
    const deal = await addDeal("Leaver");
    await as(owner, () => db.query(`select deal_set_assignees($1, $2)`, [deal.id, [owner, leaver]]));
    await db.query(`update workers set status = 'inactive' where id = $1`, [leaverWorker]);
    await as(owner, () =>
      db.query(`select deal_set_assignees($1, $2)`, [deal.id, [owner, leaver, ben]]),
    );
    expect(await people(deal.id)).toEqual(sorted(owner, leaver, ben));
    // Adding them anew is still refused.
    const other = await addDeal("Leaver 2");
    await expect(
      as(owner, () => db.query(`select deal_set_assignees($1, $2)`, [other.id, [owner, leaver]])),
    ).rejects.toThrow(/deal_assignee_outside/);
  });

  it("counts a person's open deals by the list in Company", async () => {
    const deal = await addDeal("Counted");
    await as(owner, () => db.query(`select deal_set_assignees($1, $2)`, [deal.id, [owner, ben]]));
    const tree = await as(owner, () =>
      rows<{ id: string; open_deals: number }>(`select id, open_deals from company_tree()`),
    );
    const benRow = tree.find((r) => r.id === benWorker)!;
    const impact = await as(owner, () =>
      one<{ open_deals: number }>(`select open_deals from company_worker_impact($1)`, [benWorker]),
    );
    expect(benRow.open_deals).toBe(impact.open_deals);
    expect(impact.open_deals).toBeGreaterThan(0);
  });

  it("takes a removed worker off their open deals; one nobody else is on goes to the new person", async () => {
    const shared = await addDeal("Shared");
    const alone = await addDeal("Alone");
    await as(owner, () => db.query(`select deal_set_assignees($1, $2)`, [shared.id, [ben, anna]]));
    await as(owner, () => db.query(`select deal_set_assignees($1, $2)`, [alone.id, [anna]]));
    await as(owner, () => db.query(`select * from company_remove_worker($1, $2)`, [annaWorker, owner]));
    expect(await people(shared.id)).toEqual([ben]);
    expect(await mirror(shared.id)).toBe(ben);
    expect(await people(alone.id)).toEqual([owner]);
    expect(await mirror(alone.id)).toBe(owner);
  });
});
