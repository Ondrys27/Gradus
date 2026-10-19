// @vitest-environment node
//
// The Users page's two functions (step 11.5): a searchable, sortable list of
// identifiers and counts, and one account's detail bundle. Runs every
// migration in PGlite with the same Supabase stubs as schema.test.ts.

import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
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

let db: PGlite;

async function rows<T = Record<string, unknown>>(sql: string, params?: unknown[]) {
  return (await db.query<T>(sql, params as never)).rows;
}
async function one<T = Record<string, unknown>>(sql: string, params?: unknown[]) {
  return (await rows<T>(sql, params))[0] as T;
}
async function asServer() {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
}
async function createUser() {
  const { id } = await one<{ id: string }>(
    `insert into auth.users (email, raw_user_meta_data) values ($1, '{}') returning id`,
    [`${crypto.randomUUID()}@example.com`],
  );
  return id;
}

beforeAll(async () => {
  db = new PGlite({ extensions: PGLITE_EXTENSIONS });
  await db.exec(SUPABASE_STUBS);
  for (const file of readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    await db.exec(readFileSync(path.join(MIGRATIONS_DIR, file), "utf8"));
  }
  await asServer();
});

describe("metric_admin_users", () => {
  it("finds a user by the start of their id and sorts by AI cost", async () => {
    const a = await createUser();
    const b = await createUser();
    await db.query(
      `insert into ai_usage (user_id, purpose, model, cost_usd) values ($1, 'chat', 'claude', 5)`,
      [a],
    );
    await db.query(
      `insert into ai_usage (user_id, purpose, model, cost_usd) values ($1, 'chat', 'claude', 1)`,
      [b],
    );
    await db.query(`insert into analytics_events (user_id, event) values ($1, 'app_opened')`, [a]);

    const byId = await rows<{ user_id: string }>(`select user_id from metric_admin_users($1, $2)`, [
      "Europe/Prague",
      a.slice(0, 8),
    ]);
    expect(byId.map((r) => r.user_id)).toEqual([a]);

    const bySort = await rows<{ user_id: string; ai_cost_usd: string }>(
      `select user_id, ai_cost_usd from metric_admin_users($1, null, 'cost')`,
      ["Europe/Prague"],
    );
    expect(bySort[0].user_id).toBe(a);
    expect(Number(bySort[0].ai_cost_usd)).toBe(5);
  });

  it("finds a user by name or e-mail without diacritics (step 14.3)", async () => {
    const named = await createUser();
    const other = await createUser();
    await db.query(`update profiles set display_name = 'Jiří Čermák' where id = $1`, [named]);
    await db.query(`update auth.users set email = 'zuzana.100%@example.com' where id = $1`, [other]);

    const search = async (query: string) =>
      (
        await rows<{ user_id: string }>(`select user_id from metric_admin_users($1, $2)`, [
          "Europe/Prague",
          query,
        ])
      ).map((r) => r.user_id);

    expect(await search("cerm")).toEqual([named]);
    expect(await search("JIRI")).toEqual([named]);
    expect(await search("zuzana")).toEqual([other]);
    expect(await search("100%")).toEqual([other]);
    // A LIKE wildcard in the query is a plain character, not "anything".
    expect(await search("%")).toEqual([other]);
    expect(await search("nobody-like-this")).toEqual([]);
  });

  it("is closed to a signed-in user", async () => {
    await db.exec(`set role authenticated;`);
    await expect(db.query(`select * from metric_admin_users('Europe/Prague')`)).rejects.toThrow();
    await asServer();
  });
});

describe("metric_admin_user_detail", () => {
  it("bundles the account without any content", async () => {
    const user = await createUser();
    await db.query(`insert into milestones (user_id, title) values ($1, 'Grow')`, [user]);
    await db.query(
      `insert into analytics_events (user_id, event) values ($1, 'milestone_created'), ($1, 'app_opened')`,
      [user],
    );
    await db.query(
      `insert into ai_usage (user_id, purpose, model, cost_usd, input_tokens) values ($1, 'chat', 'claude', 2, 100)`,
      [user],
    );
    await db.query(`insert into feature_requests (user_id, title) values ($1, 'Idea')`, [user]);
    await db.query(`insert into nps_responses (user_id, score) values ($1, 9)`, [user]);

    const detail = await one<{ metric_admin_user_detail: Record<string, unknown> }>(
      `select metric_admin_user_detail($1) as metric_admin_user_detail`,
      [user],
    );
    const d = detail.metric_admin_user_detail;
    expect(d.plan).toBeTruthy();
    expect(d.feature_requests).toBe(1);
    expect(d.nps_score).toBe(9);
    expect(d.last_active_at).toBeTruthy();
    expect((d.ai as { calls: number }).calls).toBe(1);
    expect(Array.isArray(d.timeline)).toBe(true);
    expect((d.timeline as unknown[]).length).toBe(2);
    expect(Array.isArray(d.sections)).toBe(true);
    expect(JSON.stringify(d)).not.toContain("Grow");
    expect(JSON.stringify(d)).not.toContain("Idea");
  });

  it("returns null for an id that does not exist", async () => {
    const detail = await one<{ metric_admin_user_detail: unknown }>(
      `select metric_admin_user_detail(gen_random_uuid()) as metric_admin_user_detail`,
    );
    expect(detail.metric_admin_user_detail).toBeNull();
  });
});

describe("admin_people", () => {
  it("returns the profile name and e-mail, blanks as null", async () => {
    const named = await createUser();
    const blank = await createUser();
    await db.query(`update profiles set display_name = '  Eva  ' where id = $1`, [named]);
    await db.query(`update profiles set display_name = '   ' where id = $1`, [blank]);
    await db.query(`update auth.users set email = null where id = $1`, [blank]);

    const people = await rows<{ user_id: string; display_name: string | null; email: string | null }>(
      `select user_id, display_name, email from admin_people($1::uuid[]) order by display_name nulls last`,
      [[named, blank]],
    );
    expect(people).toHaveLength(2);
    expect(people[0]).toMatchObject({ user_id: named, display_name: "Eva" });
    expect(people[0].email).toContain("@example.com");
    expect(people[1]).toEqual({ user_id: blank, display_name: null, email: null });
  });

  it("is closed to a signed-in user and to anon", async () => {
    const user = await createUser();
    for (const role of ["authenticated", "anon"]) {
      await db.exec(
        `set role ${role}; select set_config('request.jwt.claim.sub', '${user}', false);`,
      );
      await expect(db.query(`select * from admin_people(array[$1]::uuid[])`, [user])).rejects.toThrow();
      await asServer();
    }
  });
});
