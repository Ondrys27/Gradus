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

    // The first account is the owner, an internal account: the view includes them.
    const byId = await rows<{ user_id: string }>(
      `select user_id from metric_admin_users($1, $2, 'activity', 50, 0, true)`,
      ["Europe/Prague", a.slice(0, 8)],
    );
    expect(byId.map((r) => r.user_id)).toEqual([a]);

    const bySort = await rows<{ user_id: string; ai_cost_usd: string }>(
      `select user_id, ai_cost_usd from metric_admin_users($1, null, 'cost', 50, 0, true)`,
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

describe("administration filters (step 14.5)", () => {
  // Three accounts of one search tag: a beta one in Slovakia, a trial one in
  // Czechia with the industry "it", and an internal beta one.
  let beta: string;
  let trial: string;
  let internal: string;
  const tag = `flt${crypto.randomUUID().slice(0, 6)}`;

  beforeAll(async () => {
    beta = await createUser();
    trial = await createUser();
    internal = await createUser();
    for (const [id, suffix] of [
      [beta, "a"],
      [trial, "b"],
      [internal, "c"],
    ]) {
      await db.query(`update profiles set display_name = $2 where id = $1`, [id, `${tag}${suffix}`]);
    }
    await db.query(`select grant_beta_plan($1)`, [beta]);
    await db.query(`select grant_beta_plan($1)`, [internal]);
    await db.query(
      `update subscriptions set plan_key = 'pro', status = 'trialing', trial_ends_at = now() + interval '3 days' where user_id = $1`,
      [trial],
    );
    await db.query(`update user_settings set country_code = 'SK' where user_id = $1`, [beta]);
    await db.query(`update user_settings set country_code = 'CZ' where user_id = any($1::uuid[])`, [
      [trial, internal],
    ]);
    await db.query(`update profiles set industry = 'it' where id = $1`, [trial]);
    await db.query(`update profiles set is_internal = true where id = $1`, [internal]);
  });

  async function users(includeInternal: boolean, segment: Record<string, string>) {
    const result = await rows<{ user_id: string }>(
      `select user_id from metric_admin_users('Europe/Prague', $1, 'signup', 50, 0, $2, $3::jsonb)`,
      [tag, includeInternal, JSON.stringify(segment)],
    );
    return result.map((r) => r.user_id).sort();
  }

  it("lists users by internal accounts, plan, country and industry", async () => {
    expect(await users(false, {})).toEqual([beta, trial].sort());
    expect(await users(true, {})).toEqual([beta, trial, internal].sort());
    expect(await users(false, { plan: "beta" })).toEqual([beta]);
    expect(await users(true, { plan: "beta" })).toEqual([beta, internal].sort());
    expect(await users(false, { plan: "trial" })).toEqual([trial]);
    expect(await users(true, { country: "CZ" })).toEqual([trial, internal].sort());
    expect(await users(false, { industry: "it" })).toEqual([trial]);
    expect(await users(false, { plan: "beta", country: "CZ" })).toEqual([]);
    // The old five-argument call still works: internal accounts left out.
    const plain = await rows<{ user_id: string }>(`select user_id from metric_admin_users($1, $2)`, [
      "Europe/Prague",
      tag,
    ]);
    expect(plain.map((r) => r.user_id).sort()).toEqual([beta, trial].sort());
  });

  it("filters trials and workers by the segment", async () => {
    const running = async (segment: Record<string, string>) =>
      Number(
        (
          await one<{ running: string }>(
            `select running from metric_trials('Europe/Prague', true, $1::jsonb)`,
            [JSON.stringify(segment)],
          )
        ).running,
      );
    const all = await running({});
    expect(all).toBeGreaterThanOrEqual(1);
    expect(await running({ plan: "beta" })).toBe(0);
    expect(await running({ industry: "it" })).toBe(1);

    const { id: worker } = await one<{ id: string }>(
      `insert into workers (owner_id, name) values ($1, 'W') returning id`,
      [beta],
    );
    await db.query(`insert into worker_invites (owner_id, worker_id, email) values ($1, $2, 'w@example.com')`, [
      beta,
      worker,
    ]);
    const sent = async (segment: Record<string, string>) =>
      Number(
        (
          await one<{ invites_sent: string }>(
            `select invites_sent from metric_workers(current_date - 1, current_date + 1, 'Europe/Prague', false, $1::jsonb)`,
            [JSON.stringify(segment)],
          )
        ).invites_sent,
      );
    expect(await sent({ country: "SK" })).toBe(1);
    expect(await sent({ country: "CZ" })).toBe(0);
  });

  it("filters the Feedback lists by internal accounts, segment and period", async () => {
    await db.query(
      `insert into feature_requests (user_id, title) values ($1, 'Beta idea'), ($2, 'Trial idea'), ($3, 'Internal idea')`,
      [beta, trial, internal],
    );
    await db.query(
      `insert into nps_responses (user_id, score, comment, created_at) values
         ($1, 9, 'beta now', now()), ($2, 6, 'trial now', now()),
         ($3, 10, 'internal now', now()), ($1, 3, 'beta long ago', now() - interval '60 days')`,
      [beta, trial, internal],
    );

    const ideas = async (includeInternal: boolean, segment: Record<string, string>) =>
      (
        await rows<{ title: string }>(
          `select title from admin_feature_requests(null, 'Europe/Prague', $1, $2::jsonb)
           where title like '% idea'`,
          [includeInternal, JSON.stringify(segment)],
        )
      )
        .map((r) => r.title)
        .sort();
    expect(await ideas(false, {})).toEqual(["Beta idea", "Trial idea"]);
    expect(await ideas(true, {})).toEqual(["Beta idea", "Internal idea", "Trial idea"]);
    expect(await ideas(false, { plan: "beta" })).toEqual(["Beta idea"]);
    expect(await ideas(true, { country: "CZ" })).toEqual(["Internal idea", "Trial idea"]);

    const comments = async (from: string, includeInternal: boolean, segment: Record<string, string>) =>
      (
        await rows<{ comment: string }>(
          `select comment from admin_nps_comments($1::date, current_date, 'Europe/Prague', $2, $3::jsonb)`,
          [from, includeInternal, JSON.stringify(segment)],
        )
      )
        .map((r) => r.comment)
        .sort();
    const today = new Date().toISOString().slice(0, 10);
    const longAgo = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10);
    expect(await comments(today, false, {})).toEqual(["beta now", "trial now"]);
    expect(await comments(longAgo, false, { plan: "beta" })).toEqual(["beta long ago", "beta now"]);
    expect(await comments(today, true, { plan: "beta" })).toEqual(["beta now", "internal now"]);
  });

  it("keeps the new functions closed to a signed-in user", async () => {
    await db.exec(`set role authenticated;`);
    for (const sql of [
      `select * from admin_feature_requests()`,
      `select * from admin_nps_comments(current_date, current_date)`,
      `select * from metric_trials()`,
      `select * from metric_workers(current_date, current_date)`,
      `select * from metric_admin_users('Europe/Prague', null, 'activity', 50, 0, true, '{}')`,
    ]) {
      await expect(db.query(sql), sql).rejects.toThrow();
    }
    await asServer();
  });
});
