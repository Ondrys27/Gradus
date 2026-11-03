// @vitest-environment node
//
// Company management (19.2) on the real migrations (PGlite): the hierarchy
// refuses cycles and keeps a subtree together, groups belong to the owner, and
// a worker reads only their own branch, never writing any of it.

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
let stranger: string;
/** Accounts of the workers B and D. */
let accountB: string;
let accountD: string;
const ids: Record<string, string> = {};

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
async function rows<T = Row>(sql: string, params?: unknown[]): Promise<T[]> {
  return (await db.query<T>(sql, params as never)).rows;
}
async function createAuthUser() {
  const [row] = await rows<{ id: string }>(
    `insert into auth.users (email, raw_user_meta_data) values ($1, '{"locale":"cs"}') returning id`,
    [`${crypto.randomUUID()}@example.com`],
  );
  return row!.id;
}
async function addWorker(ownerId: string, name: string, manager: string | null, account?: string) {
  const [row] = await rows<{ id: string }>(
    `insert into workers (owner_id, user_id, name, status, manager_id)
     values ($1, $2, $3, $4, $5) returning id`,
    [ownerId, account ?? null, name, account ? "active" : "invited", manager],
  );
  return row!.id;
}
async function managerOf(name: string) {
  const [row] = await rows<{ manager_id: string | null }>(
    `select manager_id from workers where id = $1`,
    [ids[name]],
  );
  return row!.manager_id;
}
function move(uid: string, name: string, manager: string | null) {
  return as(uid, () =>
    db.query(`update workers set manager_id = $2 where id = $1`, [ids[name], manager]),
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
  owner = await createAuthUser();
  other = await createAuthUser();
  stranger = await createAuthUser();
  accountB = await createAuthUser();
  accountD = await createAuthUser();
  // A · └ B · └ C · D (under the owner)
  ids.A = await addWorker(owner, "Anna", null);
  ids.B = await addWorker(owner, "Bára", ids.A, accountB);
  ids.C = await addWorker(owner, "Cyril", ids.B);
  ids.D = await addWorker(owner, "Dan", null, accountD);
  ids.X = await addWorker(other, "Xaver", null);
});

afterAll(async () => {
  await db?.close();
});

describe("hierarchy", () => {
  it("refuses a manager that is the worker or anyone below them", async () => {
    await expect(move(owner, "A", ids.A)).rejects.toThrow(/worker_manager_cycle/);
    await expect(move(owner, "A", ids.B)).rejects.toThrow(/worker_manager_cycle/);
    await expect(move(owner, "A", ids.C)).rejects.toThrow(/worker_manager_cycle/);
    expect(await managerOf("A")).toBeNull();
  });

  it("moves a worker with everything below them", async () => {
    await move(owner, "B", ids.D);
    expect(await managerOf("B")).toBe(ids.D);
    // C stays under B, so it went along.
    expect(await managerOf("C")).toBe(ids.B);
    // Now D is above B and C: D under C would close a circle.
    await expect(move(owner, "D", ids.C)).rejects.toThrow(/worker_manager_cycle/);
    await move(owner, "B", null);
    expect(await managerOf("B")).toBeNull();
    await move(owner, "B", ids.A);
  });

  it("takes a manager only from the same owner, never sets it for someone else's worker", async () => {
    await expect(move(owner, "A", ids.X)).rejects.toThrow(/foreign key|violates/);
    const result = await move(other, "A", ids.X);
    expect(result.affectedRows).toBe(0);
    expect(await managerOf("A")).toBeNull();
  });

  it("is read only for a worker: their own manager and their branch stay put", async () => {
    expect((await move(accountB, "C", null)).affectedRows).toBe(0);
    expect((await move(accountB, "B", null)).affectedRows).toBe(0);
    expect(await managerOf("C")).toBe(ids.B);
    expect(await managerOf("B")).toBe(ids.A);
  });

  it("keeps the tree in a read-only space", async () => {
    const triggers = await rows<{ tgname: string }>(
      `select tgname from pg_trigger
       where tgrelid = 'public.workers'::regclass and not tgisinternal`,
    );
    expect(triggers.map((row) => row.tgname)).toContain("workers_manager_writable");
  });

  it("puts the people below a deleted manager right under the owner", async () => {
    const temp = await addWorker(owner, "Temp", null);
    const below = await addWorker(owner, "Below", temp);
    await db.query(`delete from workers where id = $1`, [temp]);
    const [row] = await rows<{ manager_id: string | null }>(
      `select manager_id from workers where id = $1`,
      [below],
    );
    expect(row!.manager_id).toBeNull();
    await db.query(`delete from workers where id = $1`, [below]);
  });
});

describe("groups", () => {
  let sales: string;

  it("are the owner's: created, joined and read by them alone", async () => {
    const [group] = await as(owner, () =>
      rows<{ id: string }>(
        `insert into worker_groups (name, color) values ('Obchod', 'teal') returning id`,
      ),
    );
    sales = group!.id;
    await as(owner, () =>
      db.query(`insert into worker_group_members (group_id, worker_id) values ($1, $2), ($1, $3)`, [
        sales,
        ids.C,
        ids.D,
      ]),
    );
    expect(await as(stranger, () => rows(`select id from worker_groups`))).toEqual([]);
    expect(await as(accountB, () => rows(`select id from worker_groups`))).toEqual([]);
    expect(await as(accountB, () => rows(`select group_id from worker_group_members`))).toEqual([]);
  });

  it("refuse a colour that is not a design tone and a second group of the same name", async () => {
    await expect(
      as(owner, () =>
        db.query(`insert into worker_groups (name, color) values ('Hex', '#ff0000')`),
      ),
    ).rejects.toThrow(/check/);
    await expect(
      as(owner, () => db.query(`insert into worker_groups (name) values ('obchod')`)),
    ).rejects.toThrow(/duplicate|unique/);
  });

  it("never take a member from another space, nor let anyone else add one", async () => {
    await expect(
      as(owner, () =>
        db.query(`insert into worker_group_members (group_id, worker_id) values ($1, $2)`, [
          sales,
          ids.X,
        ]),
      ),
    ).rejects.toThrow(/foreign key|violates/);
    await expect(
      as(other, () =>
        db.query(
          `insert into worker_group_members (group_id, worker_id, owner_id) values ($1, $2, $3)`,
          [sales, ids.A, owner],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
    await expect(
      as(accountB, () =>
        db.query(
          `insert into worker_group_members (group_id, worker_id, owner_id) values ($1, $2, $3)`,
          [sales, ids.B, owner],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("are deleted with their memberships, never with the workers", async () => {
    const [group] = await as(owner, () =>
      rows<{ id: string }>(`insert into worker_groups (name) values ('Dočasná') returning id`),
    );
    await as(owner, () =>
      db.query(`insert into worker_group_members (group_id, worker_id) values ($1, $2)`, [
        group!.id,
        ids.A,
      ]),
    );
    await as(owner, () => db.query(`delete from worker_groups where id = $1`, [group!.id]));
    expect(
      await rows(`select 1 from worker_group_members where group_id = $1`, [group!.id]),
    ).toEqual([]);
    expect(await rows(`select 1 from workers where id = $1`, [ids.A])).toHaveLength(1);
  });

  it("hold back writes of a read-only space", async () => {
    const triggers = await rows<{ tgname: string }>(
      `select tgname from pg_trigger
       where tgrelid in ('public.worker_groups'::regclass, 'public.worker_group_members'::regclass)
         and not tgisinternal`,
    );
    const names = triggers.map((row) => row.tgname);
    expect(names).toContain("worker_groups_writable");
    expect(names).toContain("worker_group_members_writable");
  });
});

describe("company_tree() and company_groups()", () => {
  type TreeRow = {
    id: string;
    manager_id: string | null;
    open_tasks: number;
    open_deals: number;
    group_ids: string[];
  };

  it("give the owner every worker with groups and what is open in their care", async () => {
    await db.query(
      `insert into worker_tasks (owner_id, worker_id, title) values ($1, $2, 'Zavolat'), ($1, $2, 'Hotovo')`,
      [owner, ids.B],
    );
    await db.query(`update worker_tasks set status = 'done' where title = 'Hotovo'`);
    const [stage] = await rows<{ id: string }>(
      `select id from pipeline_stages where user_id = $1 and not is_won and not is_lost order by position limit 1`,
      [owner],
    );
    const [won] = await rows<{ id: string }>(
      `select id from pipeline_stages where user_id = $1 and is_won limit 1`,
      [owner],
    );
    await db.query(
      `insert into deals (user_id, stage_id, title, assignee_id) values ($1, $2, 'Otevřený', $4), ($1, $3, 'Vyhraný', $4)`,
      [owner, stage!.id, won!.id, accountB],
    );

    const tree = await as(owner, () => rows<TreeRow>(`select * from company_tree()`));
    expect(tree.map((row) => row.id).sort()).toEqual([ids.A, ids.B, ids.C, ids.D].sort());
    const b = tree.find((row) => row.id === ids.B)!;
    expect(b.manager_id).toBe(ids.A);
    expect(b.open_tasks).toBe(1);
    expect(b.open_deals).toBe(1);
    expect(tree.find((row) => row.id === ids.D)!.group_ids).toHaveLength(1);

    const groups = await as(owner, () =>
      rows<{ name: string; member_count: number }>(`select * from company_groups()`),
    );
    expect(groups).toEqual([expect.objectContaining({ name: "Obchod", member_count: 2 })]);
  });

  it("give a worker only their branch, its top without a manager, and only its groups", async () => {
    const tree = await as(accountB, () => rows<TreeRow>(`select * from company_tree()`));
    expect(tree.map((row) => row.id).sort()).toEqual([ids.B, ids.C].sort());
    expect(tree.find((row) => row.id === ids.B)!.manager_id).toBeNull();
    expect(tree.find((row) => row.id === ids.C)!.manager_id).toBe(ids.B);

    // C is in Obchod, so B sees the group, counting only the people of the branch.
    const groups = await as(accountB, () =>
      rows<{ name: string; member_count: number }>(`select * from company_groups()`),
    );
    expect(groups).toEqual([expect.objectContaining({ name: "Obchod", member_count: 1 })]);

    // D has nobody below and sees only themself.
    const alone = await as(accountD, () => rows<TreeRow>(`select * from company_tree()`));
    expect(alone.map((row) => row.id)).toEqual([ids.D]);
  });

  it("give nothing to someone outside the company or to a deactivated worker", async () => {
    expect(await as(stranger, () => rows(`select * from company_tree()`))).toEqual([]);
    expect(await as(stranger, () => rows(`select * from company_groups()`))).toEqual([]);
    await db.query(`update workers set status = 'inactive' where id = $1`, [ids.B]);
    expect(await as(accountB, () => rows(`select * from company_tree()`))).toEqual([]);
    await db.query(`update workers set status = 'active' where id = $1`, [ids.B]);
  });

  it("are not callable without signing in", async () => {
    await db.exec(`set role anon;`);
    try {
      await expect(db.query(`select * from company_tree()`)).rejects.toThrow(/permission/);
    } finally {
      await db.exec(`reset role;`);
    }
  });
});
