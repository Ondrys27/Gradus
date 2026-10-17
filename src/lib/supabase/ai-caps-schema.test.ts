// @vitest-environment node
//
// AI usage caps in the database (step 13.5): app_settings and ai_user_caps are
// closed to the client, only the owner with a live admin session (aal2) can
// change them through admin_set_app_setting() / admin_set_ai_user_cap(), every
// change lands in admin_audit with its before and after, invalid values are
// refused, and the per-user spend functions are server only. Runs every
// migration in PGlite with the same Supabase stubs as admin-schema.test.ts.

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
create function auth.jwt() returns jsonb language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true), '')::jsonb
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
async function asServer() {
  await db.exec(
    `reset role; select set_config('request.jwt.claim.sub', '', false); select set_config('request.jwt.claims', '', false);`,
  );
}
async function asServiceRole() {
  await asServer();
  await db.exec(`set role service_role;`);
}
/** Signs in as `uid`; aal2 with a TOTP step a moment ago unless told otherwise. */
async function asUser(uid: string, aal: "aal1" | "aal2" = "aal2") {
  const now = Math.floor(Date.now() / 1000);
  const amr = [{ method: "password", timestamp: now - 60 }];
  if (aal === "aal2") amr.unshift({ method: "totp", timestamp: now - 30 });
  const claims = JSON.stringify({ sub: uid, aal, session_id: crypto.randomUUID(), amr });
  await asServer();
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid]);
  await db.query(`select set_config('request.jwt.claims', $1, false)`, [claims]);
  await db.exec(`set role authenticated;`);
}
async function createAuthUser() {
  await asServer();
  const { id } = await one<{ id: string }>(
    `insert into auth.users (email, raw_user_meta_data) values ($1, '{"locale":"cs"}') returning id`,
    [`${crypto.randomUUID()}@example.com`],
  );
  return id;
}

const CAPS = { monthly_usd: 120, per_user_usd: 5, warn_percent: 75 };
const setCaps = (value: unknown) =>
  db.query(`select public.admin_set_app_setting('ai_caps', $1::jsonb, null) as old`, [
    JSON.stringify(value),
  ]);

let owner: string;
let user: string;

beforeAll(async () => {
  db = new PGlite({ extensions: PGLITE_EXTENSIONS });
  await db.exec(SUPABASE_STUBS);
  for (const file of readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    await db.exec(readFileSync(path.join(MIGRATIONS_DIR, file), "utf8"));
  }
  owner = await createAuthUser(); // first account = owner
  user = await createAuthUser();
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe("app_settings and ai_user_caps", () => {
  it("are closed to every signed-in user, owner included", async () => {
    for (const uid of [user, owner]) {
      await asUser(uid);
      for (const table of ["app_settings", "ai_user_caps"]) {
        await expect(db.query(`select * from ${table}`)).rejects.toThrow(/permission denied/);
      }
      await expect(
        db.query(`insert into app_settings (key, value) values ('ai_caps', $1)`, [
          JSON.stringify(CAPS),
        ]),
      ).rejects.toThrow(/permission denied/);
      await expect(
        db.query(`insert into ai_user_caps (user_id, blocked) values ($1, true)`, [uid]),
      ).rejects.toThrow(/permission denied/);
    }
    await asServer();
  });
});

describe("admin_set_app_setting", () => {
  it("refuses a regular user and the owner without the second factor", async () => {
    await asUser(user);
    await expect(setCaps(CAPS)).rejects.toThrow(/admin_required/);
    await asUser(owner, "aal1");
    await expect(setCaps(CAPS)).rejects.toThrow(/admin_required/);
    await asServer();
    expect((await one<{ n: number }>(`select count(*)::int as n from app_settings`)).n).toBe(0);
  });

  it("saves for the owner with aal2 and audits who, from what and to what", async () => {
    await asUser(owner);
    const first = await setCaps(CAPS);
    expect((first.rows[0] as { old: unknown }).old).toBeNull();
    const next = { ...CAPS, per_user_usd: null, monthly_usd: 0 };
    const second = await setCaps(next);
    expect((second.rows[0] as { old: unknown }).old).toEqual(CAPS);

    await asServer();
    const saved = await one<{ value: unknown; updated_by: string }>(
      `select value, updated_by from app_settings where key = 'ai_caps'`,
    );
    expect(saved).toEqual({ value: next, updated_by: owner });
    const audit = await rows<{ user_id: string; kind: string; target: string; detail: Row }>(
      `select user_id, kind, target, detail from admin_audit
       where target = 'settings.ai_caps' order by id`,
    );
    expect(audit).toEqual([
      {
        user_id: owner,
        kind: "update",
        target: "settings.ai_caps",
        detail: { key: "ai_caps", from: null, to: CAPS },
      },
      {
        user_id: owner,
        kind: "update",
        target: "settings.ai_caps",
        detail: { key: "ai_caps", from: CAPS, to: next },
      },
    ]);
  });

  it("refuses invalid values and unknown keys", async () => {
    await asUser(owner);
    for (const bad of [
      { ...CAPS, monthly_usd: -1 },
      { ...CAPS, monthly_usd: 10_001 },
      { ...CAPS, per_user_usd: 0 },
      { ...CAPS, per_user_usd: 1001 },
      { ...CAPS, warn_percent: 0 },
      { ...CAPS, warn_percent: 101 },
      { ...CAPS, warn_percent: 80.5 },
      { ...CAPS, extra: 1 },
      { per_user_usd: 5, warn_percent: 80 },
    ]) {
      await expect(setCaps(bad), JSON.stringify(bad)).rejects.toThrow(/invalid_value/);
    }
    await expect(
      db.query(`select public.admin_set_app_setting('other', '{}'::jsonb, null)`),
    ).rejects.toThrow(/unknown_setting/);
    await asServer();
  });

  it("keeps the constraint even for the server", async () => {
    await asServer();
    await expect(
      db.query(
        `insert into app_settings (key, value) values ('ai_caps', '{"monthly_usd": -5, "warn_percent": 80}')
         on conflict (key) do update set value = excluded.value`,
      ),
    ).rejects.toThrow(/app_settings_ai_caps_valid/);
  });
});

describe("admin_set_ai_user_cap", () => {
  const setUserCap = (cap: number | null, blocked: boolean) =>
    db.query(`select public.admin_set_ai_user_cap($1, $2, $3, null) as old`, [user, cap, blocked]);

  it("refuses everyone but the owner with aal2", async () => {
    await asUser(user);
    await expect(setUserCap(null, true)).rejects.toThrow(/admin_required/);
    await asUser(owner, "aal1");
    await expect(setUserCap(3, false)).rejects.toThrow(/admin_required/);
    await asServer();
  });

  it("sets a cap, blocks, removes the exception and audits every step", async () => {
    await asUser(owner);
    await setUserCap(2.5, false);
    await asServer();
    expect(await one(`select cap_usd::float as cap, blocked from ai_user_caps where user_id = $1`, [user])).toEqual({
      cap: 2.5,
      blocked: false,
    });

    await asUser(owner);
    await setUserCap(2.5, true);
    await asServer();
    expect(await one(`select cap_usd, blocked from ai_user_caps where user_id = $1`, [user])).toEqual({
      cap_usd: null,
      blocked: true,
    });

    await asUser(owner);
    await setUserCap(null, false);
    await asServer();
    expect(await rows(`select 1 from ai_user_caps where user_id = $1`, [user])).toHaveLength(0);

    const audit = await rows<{ detail: { user: string; from: Row | null; to: Row | null } }>(
      `select detail from admin_audit where target = 'users.ai_cap' order by id`,
    );
    expect(audit.map((row) => [row.detail.from, row.detail.to])).toEqual([
      [null, { cap_usd: 2.5, blocked: false }],
      [{ cap_usd: 2.5, blocked: false }, { cap_usd: null, blocked: true }],
      [{ cap_usd: null, blocked: true }, null],
    ]);
    expect(audit.every((row) => row.detail.user === user)).toBe(true);
  });

  it("refuses a cap out of range", async () => {
    await asUser(owner);
    await expect(setUserCap(0, false)).rejects.toThrow(/invalid_value/);
    await expect(setUserCap(1000.01, false)).rejects.toThrow(/invalid_value/);
    await asServer();
  });
});

describe("per-user spend", () => {
  it("sums one user's month and finds the largest spender, for the server only", async () => {
    const a = await createAuthUser();
    const b = await createAuthUser();
    await asServer();
    await db.query(
      `insert into ai_usage (user_id, purpose, model, cost_usd, created_at) values
         ($1, 'chat', 'claude-sonnet-5-5', 1.5, '2027-01-02T10:00:00Z'),
         ($1, 'chat', 'claude-sonnet-5-5', 2, '2027-01-03T10:00:00Z'),
         ($1, 'chat', 'claude-sonnet-5-5', 50, '2026-12-31T10:00:00Z'),
         ($2, 'chat', 'claude-sonnet-5-5', 3, '2027-01-04T10:00:00Z')`,
      [a, b],
    );
    await asServiceRole();
    const spend = await one<{ v: string }>(
      `select jarvis_user_month_spend($1, '2027-01-01T00:00:00Z')::text as v`,
      [a],
    );
    expect(Number(spend.v)).toBeCloseTo(3.5, 6);
    const top = await one<{ user_id: string; cost_usd: string }>(
      `select user_id, cost_usd::text from jarvis_top_user_spend('2027-01-01T00:00:00Z')`,
    );
    expect(top.user_id).toBe(a);
    expect(Number(top.cost_usd)).toBeCloseTo(3.5, 6);

    await asUser(a);
    await expect(
      db.query(`select jarvis_user_month_spend($1, now())`, [a]),
    ).rejects.toThrow(/permission denied/);
    await expect(db.query(`select * from jarvis_top_user_spend(now())`)).rejects.toThrow(
      /permission denied/,
    );
    await asServer();
  });
});
