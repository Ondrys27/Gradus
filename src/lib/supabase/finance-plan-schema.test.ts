// @vitest-environment node
//
// The finance month plan (21.1) on the real migrations (PGlite): weeks of a
// month, who reads and writes the plan (owner, workers by the finance rights,
// strangers never), what the guards keep fixed, the closed month, writing a
// whole month at once without doubling it, and the transactions the plan reads.

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
let other: string;
let viewer: string; // finance: view
let writer: string; // finance: view + write
let outsider: string; // works for the owner without finance
let stranger: string;

async function rows<T = Row>(sql: string, params?: unknown[]): Promise<T[]> {
  return (await db.query<T>(sql, params as never)).rows;
}
async function one<T = Row>(sql: string, params?: unknown[]): Promise<T> {
  return (await rows<T>(sql, params))[0] as T;
}
async function asUser(uid: string, space?: string) {
  const headers = JSON.stringify(space ? { "x-gradus-space": space } : {});
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid]);
  await db.query(`select set_config('request.headers', $1, false)`, [headers]);
  await db.exec(`set role authenticated`);
}
async function asServer() {
  await db.exec(
    `reset role; select set_config('request.jwt.claim.sub', '', false); select set_config('request.headers', '', false);`,
  );
}
async function as<T>(uid: string, run: () => Promise<T>, space?: string): Promise<T> {
  await asUser(uid, space);
  try {
    return await run();
  } finally {
    await asServer();
  }
}
async function createAuthUser() {
  const { id } = await one<{ id: string }>(
    `insert into auth.users (email) values ($1) returning id`,
    [`${crypto.randomUUID()}@example.com`],
  );
  await db.query(`select initialize_user($1, 'cs')`, [id]);
  return id;
}
async function hire(space: string, account: string, rights: Array<[string, string]>) {
  const { id } = await one<{ id: string }>(
    `insert into workers (owner_id, user_id, name, status) values ($1, $2, 'Member', 'active') returning id`,
    [space, account],
  );
  for (const [section, action] of rights) {
    await db.query(
      `insert into worker_permission_grants (owner_id, worker_id, section, action, allowed)
       values ($1, $2, $3, $4, true)
       on conflict (worker_id, section, action) do update set allowed = true`,
      [space, id, section, action],
    );
  }
}

async function makeMonth(space: string, month: string) {
  return as(space, async () => {
    const m = await one<{ id: string }>(
      `insert into finance_plan_months (user_id, month, opening_capital) values ($1, $2, 8500) returning id`,
      [space, month],
    );
    const r = await one<{ id: string }>(
      `insert into finance_plan_rows (user_id, month, kind, label, position) values ($1, $2, 'income', 'Grid', 0) returning id`,
      [space, month],
    );
    await db.query(
      `insert into finance_plan_cells (user_id, row_id, week, planned) values ($1, $2, 2, 40000)`,
      [space, r.id],
    );
    return { month: m.id, row: r.id };
  });
}

beforeAll(async () => {
  db = new PGlite({ extensions: PGLITE_EXTENSIONS });
  await db.exec(SUPABASE_STUBS);
  for (const file of readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    await db.exec(readFileSync(path.join(MIGRATIONS_DIR, file), "utf8"));
  }
  // The very first account owns the application; the plan is about the next ones.
  await createAuthUser();
  owner = await createAuthUser();
  other = await createAuthUser();
  viewer = await createAuthUser();
  writer = await createAuthUser();
  outsider = await createAuthUser();
  stranger = await createAuthUser();
  await hire(owner, viewer, [["finance", "view"]]);
  await hire(owner, writer, [
    ["finance", "view"],
    ["finance", "write"],
  ]);
  await hire(owner, outsider, [["contacts", "view"]]);
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe("weeks of a month", () => {
  it("counts the Mondays: 4 or 5, across the turn of the year", async () => {
    const weeks = await rows<{ m: string; n: number }>(
      `select m, finance_month_weeks(m) as n from unnest(array['2026-11','2026-12','2027-01','2026-06','2026-02','2026-03']) m`,
    );
    expect(Object.fromEntries(weeks.map((w) => [w.m, w.n]))).toEqual({
      "2026-11": 5,
      "2026-12": 4,
      "2027-01": 4,
      "2026-06": 5,
      "2026-02": 4,
      "2026-03": 5,
    });
  });
});

describe("who reads and writes the plan", () => {
  let row: string;

  beforeAll(async () => {
    ({ row } = await makeMonth(owner, "2026-11"));
  });

  it("the owner and workers with finance see it; others nothing", async () => {
    const count = (uid: string) =>
      as(
        uid,
        async () =>
          (
            await one<{ n: number }>(
              `select (select count(*) from finance_plan_months where user_id = $1)
                    + (select count(*) from finance_plan_rows where user_id = $1)
                    + (select count(*) from finance_plan_cells where user_id = $1) as n`,
              [owner],
            )
          ).n,
        owner,
      );
    expect(Number(await count(owner))).toBe(3);
    expect(Number(await count(viewer))).toBe(3);
    expect(Number(await count(writer))).toBe(3);
    expect(Number(await count(outsider))).toBe(0);
    expect(Number(await count(stranger))).toBe(0);
  });

  it("only finance write may change it", async () => {
    await expect(
      as(viewer, () => db.query(`update finance_plan_cells set planned = 1 where row_id = $1`, [row]), owner),
    ).resolves.toMatchObject({ affectedRows: 0 });
    await expect(
      as(
        viewer,
        () =>
          db.query(`insert into finance_plan_rows (user_id, month, kind, label) values ($1, '2026-11', 'expense', 'Nájem')`, [
            owner,
          ]),
        owner,
      ),
    ).rejects.toThrow(/row-level security/);
    await as(
      writer,
      () =>
        db.query(
          `insert into finance_plan_cells (user_id, row_id, week, planned) values ($1, $2, 3, 24500)
           on conflict (row_id, week) do update set planned = excluded.planned`,
          [owner, row],
        ),
      owner,
    );
    const { n } = await one<{ n: number }>(`select count(*)::int as n from finance_plan_cells where row_id = $1`, [row]);
    expect(n).toBe(2);
    await expect(
      as(
        stranger,
        () => db.query(`insert into finance_plan_cells (user_id, row_id, week, planned) values ($1, $2, 4, 1)`, [owner, row]),
        owner,
      ),
    ).rejects.toThrow();
  });

  it("the client never writes the actual column", async () => {
    await expect(
      as(owner, () => db.query(`update finance_plan_cells set actual = 5 where row_id = $1`, [row])),
    ).rejects.toThrow(/permission denied/);
  });

  it("refuses a fifth week in a four-week month and fixes the row's month and block", async () => {
    await makeMonth(owner, "2026-12");
    const { id } = await one<{ id: string }>(
      `select id from finance_plan_rows where user_id = $1 and month = '2026-12'`,
      [owner],
    );
    await expect(
      as(owner, () =>
        db.query(`insert into finance_plan_cells (user_id, row_id, week, planned) values ($1, $2, 5, 1)`, [owner, id]),
      ),
    ).rejects.toThrow(/finance_plan_week_invalid/);
    await expect(
      as(owner, () => db.query(`update finance_plan_rows set kind = 'expense' where id = $1`, [id])),
    ).rejects.toThrow(/permission denied/);
  });

  it("one name per block of a month", async () => {
    await expect(
      as(owner, () =>
        db.query(`insert into finance_plan_rows (user_id, month, kind, label) values ($1, '2026-11', 'income', ' grid ')`, [
          owner,
        ]),
      ),
    ).rejects.toThrow(/finance_plan_rows_label_idx/);
  });

  it("a source must be a record of the same space", async () => {
    const payment = await as(other, () =>
      one<{ id: string }>(
        `insert into recurring_payments (user_id, type, amount, description, frequency, next_due_on)
         values ($1, 'expense', 12000, 'Nájem', 'monthly', '2026-11-05') returning id`,
        [other],
      ),
    );
    await expect(
      as(owner, () =>
        db.query(
          `insert into finance_plan_rows (user_id, month, kind, label, source, source_id)
           values ($1, '2026-11', 'expense', 'Nájem', 'recurring', $2)`,
          [owner, payment.id],
        ),
      ),
    ).rejects.toThrow(/finance_plan_source_invalid/);
  });

  it("a closed month stays as it is until it is opened again", async () => {
    await as(owner, () => db.query(`update finance_plan_months set closed = true where user_id = $1 and month = '2026-11'`, [owner]));
    await expect(
      as(owner, () => db.query(`update finance_plan_cells set planned = 2 where row_id = $1`, [row])),
    ).rejects.toThrow(/finance_plan_month_closed/);
    await expect(
      as(owner, () => db.query(`update finance_plan_months set opening_capital = 1 where user_id = $1 and month = '2026-11'`, [owner])),
    ).rejects.toThrow(/finance_plan_month_closed/);
    await as(owner, () => db.query(`update finance_plan_months set closed = false where user_id = $1 and month = '2026-11'`, [owner]));
    await as(owner, () => db.query(`update finance_plan_cells set planned = 41000 where row_id = $1 and week = 2`, [row]));
  });

  it("a read-only space keeps its plan as it is", async () => {
    const space = await createAuthUser();
    await makeMonth(space, "2026-11");
    await db.query(`update subscriptions set trial_ends_at = now() - interval '1 minute' where user_id = $1`, [space]);
    await expect(
      as(space, () => db.query(`update finance_plan_months set opening_capital = 1 where user_id = $1`, [space])),
    ).rejects.toThrow(/read_only/);
  });
});

describe("a whole month at once", () => {
  const plan = JSON.stringify([
    { kind: "income", label: "Grid", position: 0, source: "manual", cells: [{ week: 2, planned: 40000 }] },
    { kind: "expense", label: "Nájem", position: 0, source: "manual", cells: [{ week: 1, planned: 12000 }, { week: 3, planned: 0 }] },
  ]);
  const write = (uid: string, replace = false, space = owner) =>
    as(
      uid,
      () =>
        one<{ id: string }>(
          `select finance_plan_write_month($1, '2027-01', 17000, null, 'CZK', $2::jsonb, $3) as id`,
          [space, plan, replace],
        ),
      space,
    );

  it("writes the month, its rows and only the non-zero cells", async () => {
    await write(owner);
    const cells = await rows<{ label: string; week: number; planned: string }>(
      `select r.label, c.week, c.planned from finance_plan_rows r join finance_plan_cells c on c.row_id = r.id
       where r.user_id = $1 and r.month = '2027-01' order by r.label, c.week`,
      [owner],
    );
    expect(cells.map((c) => [c.label, c.week, Number(c.planned)])).toEqual([
      ["Grid", 2, 40000],
      ["Nájem", 1, 12000],
    ]);
  });

  it("twice is refused, never doubled; replacing swaps the rows", async () => {
    await expect(write(owner)).rejects.toThrow(/month_exists/);
    await write(owner, true);
    const { n } = await one<{ n: number }>(
      `select count(*)::int as n from finance_plan_rows where user_id = $1 and month = '2027-01'`,
      [owner],
    );
    expect(n).toBe(2);
  });

  it("goes by row level security: a viewer or a stranger writes nothing", async () => {
    await expect(write(viewer, false, owner)).rejects.toThrow();
    await expect(write(stranger, true, owner)).rejects.toThrow();
  });
});

describe("transactions the plan reads", () => {
  it("brings the contact of the deal, only of the caller's space", async () => {
    const contact = await as(owner, () =>
      one<{ id: string }>(`insert into contacts (user_id, company_name) values ($1, 'Grid s.r.o.') returning id`, [owner]),
    );
    const stage = await one<{ id: string }>(
      `select id from pipeline_stages where user_id = $1 and not is_won and not is_lost order by position limit 1`,
      [owner],
    );
    const deal = await as(owner, () =>
      one<{ id: string }>(
        `insert into deals (user_id, title, stage_id, contact_id) values ($1, 'Web', $2, $3) returning id`,
        [owner, stage.id, contact.id],
      ),
    );
    await db.query(
      `insert into transactions (user_id, type, amount, occurred_on, deal_id, category) values ($1, 'income', 40000, '2026-11-10', $2, 'sales')`,
      [owner, deal.id],
    );
    const mine = await as(owner, () =>
      rows<{ contact_id: string | null }>(`select * from finance_plan_transactions($1, '2026-11-02', '2026-12-06')`, [owner]),
    );
    expect(mine).toHaveLength(1);
    expect(mine[0].contact_id).toBe(contact.id);
    const theirs = await as(stranger, () =>
      rows(`select * from finance_plan_transactions($1, '2026-11-02', '2026-12-06')`, [owner]),
    );
    expect(theirs).toHaveLength(0);
  });
});
