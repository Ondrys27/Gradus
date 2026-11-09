// @vitest-environment node
//
// Public sign-up in the database (step 23.3): the consent recorded at
// registration and the plan picked on the website are the server's alone
// (a client can neither set nor change them), the picked plan goes with any
// real change of the plan, wrong codes are closed to every client, and the
// registration → payment metric counts per source. Runs every migration in
// PGlite with the same stubs as stripe-billing-schema.test.ts.

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
async function asUser(uid: string) {
  const claims = JSON.stringify({ sub: uid, aal: "aal1", session_id: crypto.randomUUID(), amr: [] });
  await asServer();
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid]);
  await db.query(`select set_config('request.jwt.claims', $1, false)`, [claims]);
  await db.exec(`set role authenticated;`);
}
async function createAuthUser(email = `${crypto.randomUUID()}@example.com`) {
  await asServer();
  const { id } = await one<{ id: string }>(
    `insert into auth.users (email, raw_user_meta_data) values ($1, '{"locale":"cs"}') returning id`,
    [email],
  );
  return id;
}

async function registered(user: string, from: string) {
  await asServer();
  await db.query(
    `insert into analytics_events (user_id, owner_id, event, props) values ($1, $1, 'signup_completed', $2)`,
    [user, JSON.stringify({ from, method: "trial", marketing_consent: false })],
  );
}

async function pay(user: string) {
  await asServer();
  await db.query(`insert into payments (user_id, amount, currency, status) values ($1, 890, 'CZK', 'paid')`, [user]);
}

beforeAll(async () => {
  db = new PGlite({ extensions: PGLITE_EXTENSIONS });
  await db.exec(SUPABASE_STUBS);
  for (const file of readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    await db.exec(readFileSync(path.join(MIGRATIONS_DIR, file), "utf8"));
  }
  await createAuthUser(); // first account = owner of the app
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe("the consent of the registration", () => {
  it("is written by the server and never by the client", async () => {
    const user = await createAuthUser();
    await asServer();
    await db.query(
      `update profiles set terms_accepted_at = now(), terms_version = '2026-11-12', marketing_consent_at = null where id = $1`,
      [user],
    );
    await asUser(user);
    for (const sql of [
      `update profiles set terms_accepted_at = now() - interval '1 day' where id = $1`,
      `update profiles set terms_version = '2030-01-01' where id = $1`,
      `update profiles set marketing_consent_at = now() where id = $1`,
    ]) {
      await expect(db.query(sql, [user])).rejects.toThrow(/consent_is_server_only/);
    }
    // The rest of the profile stays the user's own.
    await db.query(`update profiles set display_name = 'Jana' where id = $1`, [user]);
    await asServer();
    expect(
      await one(`select terms_version, marketing_consent_at, display_name from profiles where id = $1`, [user]),
    ).toEqual({ terms_version: "2026-11-12", marketing_consent_at: null, display_name: "Jana" });
  });

  it("keeps the version a date", async () => {
    const user = await createAuthUser();
    await asServer();
    await expect(db.query(`update profiles set terms_version = 'v2' where id = $1`, [user])).rejects.toThrow(
      /check/,
    );
  });
});

describe("the plan picked on the website", () => {
  it("is the server's: the client reads it but can not write it", async () => {
    const user = await createAuthUser();
    await asServer();
    await db.query(
      `update subscriptions set chosen_plan_key = 'team', chosen_billing = 'yearly', chosen_at = now() where user_id = $1`,
      [user],
    );
    await asUser(user);
    expect(await one(`select plan_key, status::text, chosen_plan_key, chosen_billing from subscriptions`)).toEqual({
      plan_key: "pro",
      status: "trialing",
      chosen_plan_key: "team",
      chosen_billing: "yearly",
    });
    await expect(
      db.query(`update subscriptions set chosen_plan_key = 'solo' where user_id = $1`, [user]),
    ).rejects.toThrow(/permission denied/);
    await asServer();
  });

  it("must be a whole choice of the catalog", async () => {
    const user = await createAuthUser();
    await asServer();
    await expect(
      db.query(`update subscriptions set chosen_plan_key = 'beta', chosen_billing = 'monthly', chosen_at = now() where user_id = $1`, [user]),
    ).rejects.toThrow(/check/);
    await expect(
      db.query(`update subscriptions set chosen_plan_key = 'pro' where user_id = $1`, [user]),
    ).rejects.toThrow(/subscriptions_chosen_complete/);
  });

  it("goes with any real change of the plan, and stays through anything else", async () => {
    const user = await createAuthUser();
    const choose = () =>
      db.query(
        `update subscriptions set chosen_plan_key = 'team', chosen_billing = 'yearly', chosen_at = now() where user_id = $1`,
        [user],
      );
    const chosen = async () =>
      (await one<{ k: string | null }>(`select chosen_plan_key as k from subscriptions where user_id = $1`, [user])).k;
    await asServer();
    await choose();
    await db.query(`update subscriptions set updated_at = now() where user_id = $1`, [user]);
    expect(await chosen()).toBe("team");
    for (const change of [
      `update subscriptions set billing = 'yearly' where user_id = $1`,
      `update subscriptions set plan_key = 'team' where user_id = $1`,
      `update subscriptions set provider = 'stripe', provider_ref = 'sub_x' where user_id = $1`,
    ]) {
      await choose();
      await db.query(change, [user]);
      expect(await chosen()).toBeNull();
    }
  });
});

describe("wrong codes", () => {
  it("are closed to every client", async () => {
    const user = await createAuthUser();
    for (const who of ["anon", user]) {
      if (who === "anon") {
        await asServer();
        await db.exec(`set role anon;`);
      } else {
        await asUser(user);
      }
      await expect(db.query(`select 1 from signup_code_attempts limit 1`)).rejects.toThrow(/permission denied/);
      await expect(
        db.query(
          `insert into signup_code_attempts (ip_hash, kind, stage) values ('0123456789abcdef', 'promo', 'check')`,
        ),
      ).rejects.toThrow(/permission denied/);
    }
    await asServiceRole();
    await db.query(
      `insert into signup_code_attempts (ip_hash, account_hash, kind, stage) values ('0123456789abcdef', null, 'invite', 'submit')`,
    );
    await expect(
      db.query(`insert into signup_code_attempts (ip_hash, kind, stage) values ('not-a-hash', 'invite', 'submit')`),
    ).rejects.toThrow(/check/);
    await asServer();
  });
});

describe("registration → payment", () => {
  it("counts the accounts registered in the period that paid since, per source and in all", async () => {
    const a = await createAuthUser();
    const b = await createAuthUser();
    const c = await createAuthUser();
    await registered(a, "pricing");
    await registered(b, "pricing");
    await registered(c, "web");
    await pay(a);
    await asServiceRole();
    const result = await rows<{ source: string; signups: number; paying: number; pct: string }>(
      `select source, signups::int, paying::int, pct::text from metric_signup_conversion(current_date - 1, current_date + 1, 'Europe/Prague', true)`,
    );
    await asServer();
    expect(result[0]).toEqual({ source: "all", signups: 3, paying: 1, pct: "33.3" });
    expect(result).toContainEqual({ source: "pricing", signups: 2, paying: 1, pct: "50.0" });
    expect(result).toContainEqual({ source: "web", signups: 1, paying: 0, pct: "0.0" });
  });

  it("is the server's only", async () => {
    const user = await createAuthUser();
    await asUser(user);
    await expect(db.query(`select * from metric_signup_conversion(current_date, current_date)`)).rejects.toThrow(
      /permission denied/,
    );
    await asServer();
  });
});
