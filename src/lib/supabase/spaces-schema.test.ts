// @vitest-environment node
//
// One account, several companies (step 22.4): memberships, the active space
// from the x-gradus-space header and row level security by membership. The
// core of it is the isolation sweep: for EVERY table with row level security
// and an owner column, a row of a space the account does not belong to is
// invisible to it and it can not insert, change or delete one, even with the
// header naming that space. Runs every migration in PGlite with the same
// Supabase stubs as schema.test.ts.

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
/** Signs in as uid; `space` is what the app would send as x-gradus-space. */
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
async function workspace() {
  return (await one<{ ws: string }>(`select current_workspace_id() as ws`)).ws;
}

/** A worker record of `owner` for `account`, with every right of the catalog or the listed ones. */
async function hire(
  owner: string,
  account: string,
  rights: "all" | Array<[string, string]> = "all",
  status: "active" | "inactive" = "active",
) {
  await asServer();
  const { id } = await one<{ id: string }>(
    `insert into workers (owner_id, user_id, name, status) values ($1, $2, 'Member', $3) returning id`,
    [owner, account, status],
  );
  if (rights === "all") {
    await db.query(
      `insert into worker_permission_grants (owner_id, worker_id, section, action, allowed)
       select $1, $2, c.section, c.action, true from permission_catalog() c
       on conflict (worker_id, section, action) do update set allowed = true`,
      [owner, id],
    );
  } else {
    for (const [section, action] of rights) {
      await db.query(
        `insert into worker_permission_grants (owner_id, worker_id, section, action, allowed)
         values ($1, $2, $3, $4, true)
         on conflict (worker_id, section, action) do update set allowed = true`,
        [owner, id, section, action],
      );
    }
  }
  return id;
}

let ownerX: string;
let ownerY: string;
let ownerZ: string;
let member: string;
let workerOfY: string;
let memberInX: string;
let memberInY: string;
/** Never worked anywhere; not the first account either (that one owns the application). */
let stranger: string;

beforeAll(async () => {
  db = new PGlite({ extensions: PGLITE_EXTENSIONS });
  await db.exec(SUPABASE_STUBS);
  for (const file of readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    await db.exec(readFileSync(path.join(MIGRATIONS_DIR, file), "utf8"));
  }
  ownerX = await createAuthUser();
  ownerY = await createAuthUser();
  ownerZ = await createAuthUser();
  member = await createAuthUser();
  workerOfY = await createAuthUser();
  stranger = await createAuthUser();
  // The member works for X with every right, used to work for Y (removed now)
  // and works for Z with only "pipeline: view".
  memberInX = await hire(ownerX, member, "all");
  memberInY = await hire(ownerY, member, "all", "inactive");
  await hire(ownerZ, member, [["pipeline", "view"]]);
  await hire(ownerY, workerOfY, "all");
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe("memberships", () => {
  it("every account owns its space, every worker record is a membership", async () => {
    await asServer();
    const mine = await rows<{ space_id: string; role: string; status: string; worker_id: string | null }>(
      `select space_id, role, status, worker_id from memberships where user_id = $1 order by role, space_id`,
      [member],
    );
    expect(mine.find((m) => m.role === "owner")).toMatchObject({ space_id: member, status: "active" });
    expect(mine.find((m) => m.space_id === ownerX)).toMatchObject({
      role: "worker",
      status: "active",
      worker_id: memberInX,
    });
    expect(mine.find((m) => m.space_id === ownerY)).toMatchObject({
      role: "worker",
      status: "removed",
      worker_id: memberInY,
    });
  });

  it("follows the worker record: deactivated = removed, back again = active", async () => {
    const account = await createAuthUser();
    const id = await hire(ownerX, account, [["contacts", "view"]]);
    const status = async () =>
      (
        await one<{ status: string; left_at: string | null }>(
          `select status, left_at from memberships where user_id = $1 and space_id = $2`,
          [account, ownerX],
        )
      );
    expect((await status()).status).toBe("active");
    await db.query(`update workers set status = 'inactive' where id = $1`, [id]);
    expect(await status()).toMatchObject({ status: "removed" });
    expect((await status()).left_at).not.toBeNull();
    await db.query(`update workers set status = 'active' where id = $1`, [id]);
    expect(await status()).toMatchObject({ status: "active", left_at: null });
    await db.query(`update workers set user_id = null where id = $1`, [id]);
    expect((await status()).status).toBe("removed");
  });

  it("an account may work for several companies", async () => {
    await asServer();
    const { n } = await one<{ n: number }>(
      `select count(*)::int as n from workers where user_id = $1 and status = 'active'`,
      [member],
    );
    expect(n).toBe(2);
  });

  it("the client reads its own memberships and writes none", async () => {
    await asUser(member);
    const seen = await rows<{ space_id: string }>(`select space_id from memberships`);
    expect(new Set(seen.map((m) => m.space_id))).toEqual(new Set([member, ownerX, ownerY, ownerZ]));
    await expect(
      db.query(
        `insert into memberships (user_id, space_id, role, worker_id, status) values ($1, $2, 'worker', $3, 'active')`,
        [member, ownerY, memberInY],
      ),
    ).rejects.toThrow();
    const updated = await db
      .query(`update memberships set status = 'active' where space_id = $1`, [ownerY])
      .catch(() => ({ affectedRows: 0 }));
    expect(updated.affectedRows ?? 0).toBe(0);
    // The owner sees who belongs to their space; nobody else's.
    await asUser(ownerY);
    const ofY = await rows<{ user_id: string }>(`select user_id from memberships where space_id = $1`, [ownerY]);
    expect(new Set(ofY.map((m) => m.user_id))).toEqual(new Set([ownerY, member, workerOfY]));
    expect(
      (await rows(`select 1 from memberships where space_id = $1`, [ownerX])).length,
    ).toBe(0);
    await asServer();
  });
});

describe("the active space", () => {
  it("is the space asked for when the account belongs there, else the default", async () => {
    await asUser(member);
    expect(await workspace()).toBe(ownerX); // the first company, as before 22.4
    await asUser(member, member);
    expect(await workspace()).toBe(member);
    await asUser(member, ownerZ);
    expect(await workspace()).toBe(ownerZ);
    await asUser(member, ownerY); // removed there
    expect(await workspace()).toBe(ownerX);
    await asUser(member, crypto.randomUUID());
    expect(await workspace()).toBe(ownerX);
    await asUser(member, "not-a-uuid");
    expect(await workspace()).toBe(ownerX);
    await asUser(ownerY, ownerX);
    expect(await workspace()).toBe(ownerY);
    await asServer();
  });

  it("an owner without a company to work for stays in their own space", async () => {
    await asUser(ownerX);
    expect(await workspace()).toBe(ownerX);
    await asServer();
  });

  it("the switcher lists the own space and the companies, never a removed one", async () => {
    await asServer();
    await db.query(`update profiles set company_name = 'X s.r.o.' where id = $1`, [ownerX]);
    await asUser(member);
    const spaces = await rows<{ space_id: string; role: string; company_name: string | null }>(
      `select space_id, role, company_name from my_spaces()`,
    );
    expect(spaces[0]).toMatchObject({ space_id: member, role: "owner" });
    expect(spaces.map((s) => s.space_id)).toEqual(expect.arrayContaining([ownerX, ownerZ]));
    expect(spaces.map((s) => s.space_id)).not.toContain(ownerY);
    expect(spaces.find((s) => s.space_id === ownerX)?.company_name).toBe("X s.r.o.");
    await asServer();
  });

  it("no policy depends on the active space any more", async () => {
    await asServer();
    const left = await rows<{ tablename: string; policyname: string }>(
      `select tablename, policyname from pg_policies
       where coalesce(qual, '') like '%current_workspace_id%'
          or coalesce(with_check, '') like '%current_workspace_id%'`,
    );
    expect(left.map((p) => `${p.tablename}.${p.policyname}`)).toEqual([]);
  });
});

describe("rights go with the row's company", () => {
  it("view_all in one company never opens the deals of another", async () => {
    await asServer();
    const stage = (
      await one<{ id: string }>(
        `select id from pipeline_stages where user_id = $1 order by position limit 1`,
        [ownerZ],
      )
    ).id;
    await db.query(
      `insert into deals (user_id, stage_id, title, assignee_id) values ($1, $2, 'Z deal', $1)`,
      [ownerZ, stage],
    );
    // Active in X (all rights there), the row is Z's where only "view" holds.
    await asUser(member, ownerX);
    expect((await rows(`select 1 from deals where user_id = $1`, [ownerZ])).length).toBe(0);
    await asUser(member, ownerZ);
    expect((await rows(`select 1 from deals where user_id = $1`, [ownerZ])).length).toBe(0);
    await asServer();
  });

  it("a worker in a company has only the rights granted there", async () => {
    await asServer();
    await db.query(`insert into contacts (user_id, company_name) values ($1, 'Z client')`, [ownerZ]);
    // Only "pipeline: view" in Z: no contacts, no finance, nothing to write.
    await asUser(member, ownerZ);
    expect(await workspace()).toBe(ownerZ);
    expect((await rows(`select 1 from contacts where user_id = $1`, [ownerZ])).length).toBe(0);
    await expect(
      db.query(`insert into contacts (user_id, company_name) values ($1, 'Mine now')`, [ownerZ]),
    ).rejects.toThrow();
    const stage = await rows(`select id from pipeline_stages where user_id = $1 limit 1`, [ownerZ]);
    expect(stage.length).toBe(1);
    await expect(
      db.query(`insert into deals (user_id, stage_id, title) values ($1, $2, 'Mine now')`, [
        ownerZ,
        (stage[0] as { id: string }).id,
      ]),
    ).rejects.toThrow();
    const rights = async (section: string, action: string) =>
      (await one<{ ok: boolean }>(`select has_permission($1, $2, $3) as ok`, [ownerZ, section, action])).ok;
    expect(await rights("pipeline", "view")).toBe(true);
    expect(await rights("pipeline", "create")).toBe(false);
    expect(await rights("contacts", "view")).toBe(false);
    expect(await rights("finance", "view")).toBe(false);
    await asServer();
  });

  it("a member still reads its company's rows whatever space is active (the app filters)", async () => {
    await asServer();
    await db.query(`insert into contacts (user_id, company_name) values ($1, 'X client')`, [ownerX]);
    await asUser(member, member);
    expect((await rows(`select 1 from contacts where user_id = $1`, [ownerX])).length).toBe(1);
    await asServer();
  });

  it("functions answer for the company of the row", async () => {
    await asUser(member, ownerX);
    const check = async (space: string, section: string, action: string) =>
      (
        await one<{ ok: boolean }>(`select has_permission($1, $2, $3) as ok`, [space, section, action])
      ).ok;
    expect(await check(ownerX, "finance", "view")).toBe(true);
    expect(await check(ownerY, "finance", "view")).toBe(false);
    expect(await check(ownerZ, "pipeline", "view_all")).toBe(false);
    const hasAccess = await one<{ ok: boolean }>(
      `select has_section_access($1, 'contacts', 'view') as ok`,
      [ownerY],
    );
    expect(hasAccess.ok).toBe(false);
    await asServer();
  });
});

describe("short id", () => {
  it("every account gets one: six characters without look-alikes, unique", async () => {
    await asServer();
    const ids = await rows<{ public_id: string }>(`select public_id from profiles`);
    expect(ids.length).toBeGreaterThan(3);
    for (const { public_id } of ids) expect(public_id).toMatch(/^[2-9A-HJKMNP-TV-Z]{6}$/);
    expect(new Set(ids.map((r) => r.public_id)).size).toBe(ids.length);
  });

  it("nobody changes it, not from the app and not from the server", async () => {
    await asServer();
    const { public_id: before } = await one<{ public_id: string }>(
      `select public_id from profiles where id = $1`,
      [ownerX],
    );
    await asUser(ownerX);
    await db.query(`update profiles set public_id = 'ABCDEF' where id = $1`, [ownerX]);
    await asServer();
    await db.query(`update profiles set public_id = 'ABCDEG' where id = $1`, [ownerX]);
    const { public_id: after } = await one<{ public_id: string }>(
      `select public_id from profiles where id = $1`,
      [ownerX],
    );
    expect(after).toBe(before);
  });

  it("the owner names the company; the name is checked", async () => {
    await asUser(ownerZ);
    await db.query(`update profiles set company_name = 'Zeta' where id = $1`, [ownerZ]);
    await expect(
      db.query(`update profiles set company_name = $2 where id = $1`, [ownerZ, "x".repeat(81)]),
    ).rejects.toThrow();
    await asServer();
  });
});

// -----------------------------------------------------------------------------
// The sweep
// -----------------------------------------------------------------------------

type Column = {
  column_name: string;
  data_type: string;
  udt_name: string;
  is_nullable: string;
  column_default: string | null;
  is_generated: string;
  identity_generation: string | null;
};

const OWNER_COLUMNS = ["user_id", "owner_id", "space_id"] as const;

/** One row per account, made with the account: the sweep reads the existing one. */
const ONE_PER_ACCOUNT = new Set(["profiles", "subscriptions", "user_settings"]);

/** A literal that fits a column of this type. */
async function sampleValue(column: Column): Promise<string> {
  if (column.data_type === "ARRAY") return `'{}'`;
  if (column.data_type === "USER-DEFINED") {
    const label = await rows<{ enumlabel: string }>(
      `select e.enumlabel from pg_enum e join pg_type t on t.oid = e.enumtypid
       where t.typname = $1 order by e.enumsortorder limit 1`,
      [column.udt_name],
    );
    if (label[0]) return `'${label[0].enumlabel.replace(/'/g, "''")}'::public.${column.udt_name}`;
    return `null`;
  }
  switch (column.udt_name) {
    case "uuid":
      return "gen_random_uuid()";
    case "text":
    case "varchar":
    case "bpchar":
    case "citext":
      return `'x'`;
    case "int2":
    case "int4":
    case "int8":
    case "numeric":
    case "float4":
    case "float8":
      return "1";
    case "bool":
      return "false";
    case "json":
    case "jsonb":
      return `'{}'`;
    case "timestamptz":
    case "timestamp":
      return "now()";
    case "date":
      return "current_date";
    case "time":
    case "timetz":
      return `'00:00'`;
    case "interval":
      return `'1 hour'`;
    case "bytea":
      return `'\\x00'`;
    case "tsvector":
      return `''`;
    case "inet":
      return `'127.0.0.1'`;
    default:
      return `null`;
  }
}

type Target = {
  table: string;
  ownerColumn: string;
  /**
   * The table names the account in user_id besides the space in ownerColumn
   * (workers, memberships): the person's own rows of a company are theirs to
   * read (CLAUDE.md, tables of workers), so the sweep leaves them out.
   */
  personal: boolean;
  insertSql: (owner: string) => string;
};

async function sweepTargets(): Promise<Target[]> {
  await asServer();
  const tables = await rows<{ table_name: string }>(
    `select c.relname as table_name from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
     order by c.relname`,
  );
  const targets: Target[] = [];
  for (const { table_name: table } of tables) {
    const columns = await rows<Column>(
      `select column_name, data_type, udt_name, is_nullable, column_default, is_generated, identity_generation
       from information_schema.columns where table_schema = 'public' and table_name = $1
       order by ordinal_position`,
      [table],
    );
    const names = columns.map((c) => c.column_name);
    // Every owner column of the table: workers is the account's (user_id) and
    // the company's (owner_id), memberships the account's and the space's.
    const ownerColumns: string[] = OWNER_COLUMNS.filter((name) => names.includes(name));
    if (!ownerColumns.length && table === "profiles") ownerColumns.push("id");
    for (const ownerColumn of ownerColumns) {
      const filled: Array<[string, string]> = [];
      for (const column of columns) {
        if (column.column_name === ownerColumn) continue;
        if (column.is_generated === "ALWAYS" || column.identity_generation === "ALWAYS") continue;
        if (column.is_nullable === "YES" || column.column_default !== null) continue;
        filled.push([column.column_name, await sampleValue(column)]);
      }
      targets.push({
        table,
        ownerColumn,
        personal: ownerColumn !== "user_id" && names.includes("user_id"),
        insertSql: (owner) => {
          const cols = [ownerColumn, ...filled.map(([name]) => name)].map((c) => `"${c}"`).join(", ");
          const values = [`'${owner}'::uuid`, ...filled.map(([, value]) => value)].join(", ");
          return `insert into public."${table}" (${cols}) values (${values})`;
        },
      });
    }
  }
  return targets;
}

/** The rows of space `owner` in a target, without the ones naming `account` itself. */
function ofSpace(target: Target, owner: string, account?: string): string {
  const where = `"${target.ownerColumn}" = '${owner}'::uuid`;
  return target.personal && account ? `${where} and "user_id" is distinct from '${account}'::uuid` : where;
}

const targetName = (target: Target) => `${target.table}.${target.ownerColumn}`;

describe("isolation sweep: a space the account does not belong to", () => {
  let targets: Target[] = [];
  const seeded = new Set<string>();

  beforeAll(async () => {
    targets = await sweepTargets();
    await asServer();
    // A throw-away database: checks off, triggers and foreign keys off for the
    // seed, so every table gets one row of space Y however its rules look.
    const checks = await rows<{ table_name: string; conname: string }>(
      `select c.relname as table_name, k.conname from pg_constraint k
       join pg_class c on c.oid = k.conrelid
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and k.contype = 'c'`,
    );
    for (const { table_name, conname } of checks) {
      await db.exec(`alter table public."${table_name}" drop constraint "${conname}"`);
    }
    await db.exec(`set session_replication_role = replica`);
    for (const target of targets) {
      if (ONE_PER_ACCOUNT.has(target.table) && !target.personal) {
        seeded.add(targetName(target));
        continue;
      }
      try {
        await db.exec(target.insertSql(ownerY));
        seeded.add(targetName(target));
      } catch {
        // Reported by the coverage check below.
      }
    }
    await db.exec(`set session_replication_role = origin`);
  }, 120_000);

  it("covers the tables (the seed did not silently skip them)", () => {
    const missing = targets.map(targetName).filter((name) => !seeded.has(name));
    expect(missing).toEqual([]);
    expect(targets.length).toBeGreaterThan(60);
    // The company side of the tables that also name an account is swept too.
    expect(targets.map(targetName)).toEqual(expect.arrayContaining(["workers.owner_id", "memberships.space_id"]));
  });

  // Removed from Y (a member of X and Z), and a stranger who never worked there.
  it.each([
    ["a removed worker", () => member],
    ["a stranger", () => stranger],
  ])("%s sees nothing, changes nothing, deletes nothing and inserts nothing", async (_who, persona) => {
    const account = persona();
    const leaks: string[] = [];
    for (const target of targets) {
      const where = ofSpace(target, ownerY, account);
      await asServer();
      const before = await rows(`select to_jsonb(t) as row from public."${target.table}" t where ${where}`);
      // Asking for Y.
      await asUser(account, ownerY);
      const visible = await db
        .query<{ n: number }>(`select count(*)::int as n from public."${target.table}" where ${where}`)
        .then((result) => result.rows[0]?.n ?? 0)
        .catch(() => 0);
      if (visible > 0) leaks.push(`${targetName(target)}: select`);
      const updated = await db
        .query(`update public."${target.table}" set "${target.ownerColumn}" = "${target.ownerColumn}" where ${where}`)
        .then((result) => result.affectedRows ?? 0)
        .catch(() => 0);
      if (updated > 0) leaks.push(`${targetName(target)}: update`);
      const deleted = await db
        .query(`delete from public."${target.table}" where ${where}`)
        .then((result) => result.affectedRows ?? 0)
        .catch(() => 0);
      if (deleted > 0) leaks.push(`${targetName(target)}: delete`);
      const inserted = await db
        .query(target.insertSql(ownerY))
        .then(() => "inserted" as const)
        .catch((error: { code?: string }) => error.code ?? "error");
      // A foreign key or uniqueness error means the policies let the row through.
      if (inserted === "inserted" || inserted === "23503" || inserted === "23505") {
        leaks.push(`${targetName(target)}: insert (${inserted})`);
      }
      await asServer();
      const after = await rows(`select to_jsonb(t) as row from public."${target.table}" t where ${where}`);
      if (JSON.stringify(after) !== JSON.stringify(before)) leaks.push(`${targetName(target)}: changed`);
    }
    expect(leaks).toEqual([]);
  }, 120_000);

  it("the space's own people do see the rows (the sweep is not empty-handed)", async () => {
    await asUser(ownerY, ownerY);
    let ownerSees = 0;
    for (const target of targets) {
      const n = await db
        .query<{ n: number }>(
          `select count(*)::int as n from public."${target.table}" where "${target.ownerColumn}" = $1`,
          [ownerY],
        )
        .then((result) => result.rows[0]?.n ?? 0)
        // Server-only tables refuse the client outright.
        .catch(() => 0);
      if (n > 0) ownerSees += 1;
    }
    expect(ownerSees).toBeGreaterThan(40);
    // An active worker of Y with every right sees the shared sections.
    await asUser(workerOfY, ownerY);
    for (const table of ["contacts", "deals", "transactions", "invoices", "calendar_events", "milestones"]) {
      const { n } = await one<{ n: number }>(
        `select count(*)::int as n from public."${table}" where user_id = $1`,
        [ownerY],
      );
      expect(n, table).toBeGreaterThan(0);
    }
    await asServer();
  });

  it("the client's functions refuse the space too, and change nothing there", async () => {
    await asServer();
    const idOf = async (table: string, column = "user_id") =>
      (await one<{ id: string }>(`select id from public."${table}" where "${column}" = $1 limit 1`, [ownerY])).id;
    const yWorker = (
      await one<{ id: string }>(`select id from workers where owner_id = $1 and user_id = $2`, [ownerY, workerOfY])
    ).id;
    const [yInvoice, yContact, yTable, yDeal, yChannel, yGroup, yInvite] = await Promise.all([
      idOf("invoices"),
      idOf("contacts"),
      idOf("contact_tables"),
      idOf("deals"),
      idOf("chat_channels", "owner_id"),
      idOf("worker_groups", "owner_id"),
      idOf("worker_invites", "owner_id"),
    ]);
    const snapshot = async () => {
      await asServer();
      const parts: string[] = [];
      for (const target of targets) {
        const found = await rows(
          `select to_jsonb(t) as row from public."${target.table}" t
           where "${target.ownerColumn}" = '${ownerY}'::uuid order by 1::text`,
        );
        parts.push(`${target.table}:${JSON.stringify(found)}`);
      }
      return parts.join("\n");
    };
    const before = await snapshot();

    // Each call either fails or answers nothing: no row, false, null or zero.
    const calls: Array<[string, unknown[]]> = [
      [`select * from company_worker($1)`, [yWorker]],
      [`select * from company_worker_impact($1)`, [yWorker]],
      [`select * from company_visible_worker_ids_in($1)`, [ownerY]],
      [`select company_can_edit_worker($1)`, [yWorker]],
      [`select worker_documents_own($1)`, [yWorker]],
      [`select crm_task_target_visible($1, $2, $3)`, [ownerY, yDeal, yContact]],
      [`select is_workspace_member($1, $2)`, [ownerY, workerOfY]],
      [`select has_section_access($1, 'finance', 'view')`, [ownerY]],
      [`select has_permission($1, 'contacts', 'view')`, [ownerY]],
      [`select is_space_member($1)`, [ownerY]],
      [`select chat_is_member($1)`, [yChannel]],
      [`select * from worker_seats($1)`, [ownerY]],
      [`select * from my_worker_invites($1)`, [ownerY]],
      [`select company_update_worker($1, '{"job_title": "Taken"}'::jsonb)`, [yWorker]],
      [`select company_set_group_member($1, $2, true)`, [yWorker, yGroup]],
      [`select * from company_remove_worker($1, null)`, [yWorker]],
      [`select record_worker_payment($1, 1, now(), null)`, [yWorker]],
      [`select start_work_session($1)`, [yWorker]],
      [`select pause_work_session($1)`, [yWorker]],
      [`select issue_invoice($1)`, [yInvoice]],
      [`select mark_invoice_paid($1)`, [yInvoice]],
      [`select cancel_invoice($1)`, [yInvoice]],
      [`select move_contact($1, $2, '{}'::jsonb)`, [yContact, yTable]],
      [`select remove_contact_table($1, null)`, [yTable]],
      [`select link_deal_to_booked_meeting($1)`, [yDeal]],
      [`select chat_mark_read($1, now())`, [yChannel]],
      [`select chat_set_member_flags($1, true, true)`, [yChannel]],
      [`select chat_set_muted_all($1, true)`, [yChannel]],
      [`select chat_open_direct($1)`, [yWorker]],
      [`select space_leave($1)`, [ownerY]],
      [`select worker_invite_respond($1, true)`, [yInvite]],
      [`select chat_member_token($1)`, [ownerY]],
      [`select chat_direct_peer_gone($1)`, [yChannel]],
      // Storage: the files of the space by their path.
      [`select invoice_pdf_readable($1)`, [`${ownerY}/${yInvoice}.pdf`]],
      [`select worker_document_object_access($1, false)`, [`${ownerY}/${yWorker}/${yInvoice}`]],
      [`select worker_document_object_access($1, true)`, [`${ownerY}/${yWorker}/${yInvoice}`]],
      [`select worker_avatar_writable($1)`, [`${ownerY}/${yWorker}/avatar`]],
      [`select chat_attachment_uploadable($1)`, [`${ownerY}/${crypto.randomUUID()}/${crypto.randomUUID()}`]],
    ];
    const nothing = (value: unknown) =>
      value === null || value === false || value === 0 || value === "" ||
      (Array.isArray(value) && value.length === 0);
    const leaks: string[] = [];
    // Removed from Y, and a stranger who never worked there.
    for (const account of [member, stranger]) {
      for (const [sql, params] of calls) {
        await asUser(account, ownerY);
        const answer = await db
          .query<Row>(sql, params as never)
          .then((result) => result.rows)
          .catch(() => null);
        if (answer && answer.some((row) => Object.values(row).some((value) => !nothing(value)))) {
          leaks.push(`${account === member ? "removed" : "stranger"}: ${sql} → ${JSON.stringify(answer)}`);
        }
      }
    }
    expect(leaks).toEqual([]);
    expect(await snapshot()).toBe(before);
  }, 120_000);

  it("the space's files in storage stay closed too", async () => {
    await asServer();
    const yWorker = (
      await one<{ id: string }>(`select id from workers where owner_id = $1 and user_id = $2`, [ownerY, workerOfY])
    ).id;
    const yMessage = (await one<{ id: string }>(`select id from chat_messages where owner_id = $1 limit 1`, [ownerY]))
      .id;
    const buckets = await rows<{ id: string; public: boolean }>(`select id, public from storage.buckets order by id`);
    expect(buckets.length).toBeGreaterThan(5);
    // Every path shape the buckets use, under Y's folder.
    const names = [
      `${ownerY}/${crypto.randomUUID()}.pdf`,
      `${ownerY}/${yWorker}/${crypto.randomUUID()}`,
      `${ownerY}/${yWorker}/avatar`,
      `${ownerY}/${yMessage}/${crypto.randomUUID()}`,
      `${ownerY}/company-logo`,
    ];
    for (const bucket of buckets) {
      for (const name of names) {
        await db.query(`insert into storage.objects (bucket_id, name, owner) values ($1, $2, $3)`, [
          bucket.id,
          name,
          ownerY,
        ]);
      }
    }
    const like = `${ownerY}/%`;
    const before = await rows(`select bucket_id, name from storage.objects where name like $1 order by 1, 2`, [like]);
    const leaks: string[] = [];
    for (const account of [member, stranger]) {
      await asUser(account, ownerY);
      const seen = await rows<{ bucket_id: string }>(
        `select bucket_id from storage.objects where name like $1`,
        [like],
      );
      // Public buckets are read by address anyway; their writes still are Y's only.
      for (const row of seen) {
        if (!buckets.find((bucket) => bucket.id === row.bucket_id)?.public) leaks.push(`${row.bucket_id}: select`);
      }
      const updated = await db
        .query(`update storage.objects set name = name where name like $1`, [like])
        .then((result) => result.affectedRows ?? 0)
        .catch(() => 0);
      if (updated > 0) leaks.push(`update ${updated}`);
      const deleted = await db
        .query(`delete from storage.objects where name like $1`, [like])
        .then((result) => result.affectedRows ?? 0)
        .catch(() => 0);
      if (deleted > 0) leaks.push(`delete ${deleted}`);
      for (const bucket of buckets) {
        for (const name of names) {
          const inserted = await db
            .query(`insert into storage.objects (bucket_id, name, owner) values ($1, $2, $3)`, [
              bucket.id,
              `${name}-${account}`,
              account,
            ])
            .then(() => true)
            .catch(() => false);
          if (inserted) leaks.push(`${bucket.id}: insert ${name}`);
        }
      }
    }
    await asServer();
    expect(leaks).toEqual([]);
    expect(await rows(`select bucket_id, name from storage.objects where name like $1 order by 1, 2`, [like])).toEqual(
      before,
    );
  });

  it("the space's functions give nothing away either", async () => {
    await asUser(member, ownerY);
    const tree = await rows(`select id from company_tree()`);
    const yWorkers = await (async () => {
      await asServer();
      return rows<{ id: string }>(`select id from workers where owner_id = $1`, [ownerY]);
    })();
    expect(tree.map((r) => r.id)).not.toEqual(expect.arrayContaining(yWorkers.map((w) => w.id)));
    await asUser(member, ownerY);
    await expect(db.query(`select * from current_plan($1)`, [ownerY])).rejects.toThrow();
    const spaces = await rows<{ space_id: string }>(`select space_id from my_spaces()`);
    expect(spaces.map((s) => s.space_id)).not.toContain(ownerY);
    await asServer();
  });
});
