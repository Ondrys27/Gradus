// @vitest-environment node
//
// Currencies of the world in the database (step 24.1): exchange rates and
// their sources are closed to every client, currency_digits() is the same as
// src/config/currencies.ts, plan prices take EUR plus manual prices in any
// currency, the add-ons of a catalog version are validated and kept with its
// history, a subscription's add-ons change only through the server's
// subscription_set_add_on(), and the finance summary per currency sees only
// the caller's space. Runs every migration in PGlite with the stubs of
// plan-catalog-schema.test.ts.

import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CURRENCY_LIST } from "@/config/currencies";
import type { PlanCatalog } from "@/config/pricing";
import { seedAddOns, seedPlanCatalog } from "@/features/plan/catalog-seed";
import { validatePlanAddOns, validatePlanCatalog } from "@/features/plan/catalog";
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
  const now = Math.floor(Date.now() / 1000);
  const amr = [
    { method: "totp", timestamp: now - 30 },
    { method: "password", timestamp: now - 60 },
  ];
  const claims = JSON.stringify({ sub: uid, aal: "aal2", session_id: crypto.randomUUID(), amr });
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
const json = (value: unknown) => JSON.stringify(value);

let owner: string;
let user: string;
let other: string;

beforeAll(async () => {
  db = new PGlite({ extensions: PGLITE_EXTENSIONS });
  await db.exec(SUPABASE_STUBS);
  for (const file of readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    await db.exec(readFileSync(path.join(MIGRATIONS_DIR, file), "utf8"));
  }
  owner = await createAuthUser(); // first account = owner of the app
  user = await createAuthUser(); // pro trial
  other = await createAuthUser();
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe("currency_digits()", () => {
  it("writes every currency with the decimals of src/config/currencies.ts", async () => {
    await asServer();
    const codes = CURRENCY_LIST.map((item) => item.code);
    const stored = await rows<{ code: string; digits: number }>(
      `select c as code, public.currency_digits(c) as digits from unnest($1::text[]) as c`,
      [codes],
    );
    expect(Object.fromEntries(stored.map((row) => [row.code, row.digits]))).toEqual(
      Object.fromEntries(CURRENCY_LIST.map((item) => [item.code, item.digits])),
    );
  });
});

describe("exchange rates", () => {
  it("are closed to every client and written by the server", async () => {
    await asServiceRole();
    await db.query(
      `insert into exchange_rates (code, rate, fetched_at, source) values ('CZK', 24.3, now(), 'ecb'), ('JPY', 157, now(), 'open_er')`,
    );
    await db.query(
      `insert into exchange_rate_sources (source, last_attempt_at, last_success_at, rates) values ('ecb', now(), now(), 30)`,
    );
    for (const uid of [user, owner]) {
      await asUser(uid);
      for (const table of ["exchange_rates", "exchange_rate_sources"]) {
        await expect(db.query(`select * from ${table}`)).rejects.toThrow(/permission denied/);
      }
      await expect(
        db.query(`insert into exchange_rates (code, rate, fetched_at, source) values ('USD', 1, now(), 'ecb')`),
      ).rejects.toThrow(/permission denied/);
      await expect(db.query(`update exchange_rates set rate = 1`)).rejects.toThrow(/permission denied/);
    }
  });

  it("hold one sane rate per currency against EUR", async () => {
    await asServiceRole();
    for (const sql of [
      `insert into exchange_rates (code, rate, fetched_at, source) values ('EUR', 1, now(), 'ecb')`,
      `insert into exchange_rates (code, rate, fetched_at, source) values ('usd', 1, now(), 'ecb')`,
      `insert into exchange_rates (code, rate, fetched_at, source) values ('USD', 0, now(), 'ecb')`,
      `insert into exchange_rates (code, rate, fetched_at, source) values ('USD', 1, now(), 'guess')`,
      `insert into exchange_rates (base, code, rate, fetched_at, source) values ('USD', 'CZK', 21, now(), 'ecb')`,
      `insert into exchange_rates (code, rate, fetched_at, source) values ('CZK', 25, now(), 'ecb')`,
      `insert into exchange_rate_sources (source, last_attempt_at, last_error) values ('open_er', now(), 'Bad <html>')`,
    ]) {
      await expect(db.query(sql)).rejects.toThrow();
    }
  });
});

describe("plan prices in any currency", () => {
  it("take EUR plus manual prices, each with the currency's decimals", async () => {
    await asServer();
    const valid = async (catalog: unknown) =>
      (await one<{ ok: boolean }>(`select public.valid_plan_catalog($1::jsonb) as ok`, [json(catalog)])).ok;
    const catalog = structuredClone(seedPlanCatalog());
    expect(await valid(catalog)).toBe(true);
    // Only EUR: every other currency is derived.
    const eurOnly: PlanCatalog = catalog.map((plan) => ({
      ...plan,
      monthly: { EUR: plan.monthly.EUR },
      yearly: { EUR: plan.yearly.EUR },
      per_worker: plan.per_worker ? { EUR: plan.per_worker.EUR } : null,
    }));
    expect(await valid(eurOnly)).toBe(true);
    expect(validatePlanCatalog(eurOnly).ok).toBe(true);
    // A manual JPY price is whole.
    const jpy = structuredClone(eurOnly);
    for (const plan of jpy) {
      plan.monthly.JPY = 2990;
      plan.yearly.JPY = 29_900;
      if (plan.per_worker) plan.per_worker.JPY = 1990;
    }
    expect(await valid(jpy)).toBe(true);
    jpy[0].monthly.JPY = 2990.5;
    expect(await valid(jpy)).toBe(false);
    expect(validatePlanCatalog(jpy).ok).toBe(false);
    // Without EUR, or a manual month without its year, is refused here and in the app.
    const noEur = structuredClone(catalog);
    delete (noEur[0].monthly as Record<string, number>).EUR;
    expect(await valid(noEur)).toBe(false);
    expect(validatePlanCatalog(noEur).ok).toBe(false);
    const halfManual = structuredClone(eurOnly);
    halfManual[1].monthly.PLN = 79;
    expect(await valid(halfManual)).toBe(false);
    expect(validatePlanCatalog(halfManual).ok).toBe(false);
  });
});

describe("add-ons of the catalog", () => {
  it("are validated like the app does and kept with a version", async () => {
    await asServer();
    const valid = async (value: unknown) =>
      (await one<{ ok: boolean }>(`select public.valid_plan_add_ons($1::jsonb) as ok`, [json(value)])).ok;
    const seed = seedAddOns();
    expect(await valid(seed)).toBe(true);
    expect(validatePlanAddOns(seed).ok).toBe(true);
    for (const bad of [
      [{ ...seed[0], key: "other" }],
      [seed[0], seed[0]],
      [{ ...seed[0], monthly: { CZK: 29 } }],
      [{ ...seed[0], name: { cs: "", en: "x" } }],
      [{ ...seed[0], extra: true }],
    ]) {
      expect(await valid(bad)).toBe(false);
      expect(validatePlanAddOns(bad).ok).toBe(false);
    }
    // The published version from before step 24.1 has none stored (= the seed's).
    const published = await one<{ add_ons: unknown }>(
      `select add_ons from plan_catalog_versions where status = 'published'`,
    );
    expect(published.add_ons).toBeNull();
  });

  it("are saved and published only by the owner, and never change afterwards", async () => {
    await asServer();
    await db.query(`delete from plan_catalog_versions where status = 'draft'`);
    const current = await one<{ id: string }>(`select id from plan_catalog_versions where status = 'published'`);
    const addOns = seedAddOns();
    addOns[0].monthly = { EUR: 1.49, CZK: 39 };
    await asUser(user);
    await expect(
      db.query(`select public.admin_plan_catalog_save_draft_full($1::jsonb, $2::jsonb, null)`, [
        json(seedPlanCatalog()),
        json(addOns),
      ]),
    ).rejects.toThrow();
    await asUser(owner);
    await db.query(`select public.admin_plan_catalog_save_draft_full($1::jsonb, $2::jsonb, null)`, [
      json(seedPlanCatalog()),
      json(addOns),
    ]);
    // Other add-ons than the draft holds are stale.
    await expect(
      db.query(`select public.admin_plan_catalog_publish_full($1::jsonb, $2::jsonb, $3, null)`, [
        json(seedPlanCatalog()),
        json(seedAddOns()),
        current.id,
      ]),
    ).rejects.toThrow(/stale/);
    const { id } = await one<{ id: string }>(
      `select public.admin_plan_catalog_publish_full($1::jsonb, $2::jsonb, $3, null) as id`,
      [json(seedPlanCatalog()), json(addOns), current.id],
    );
    await asServer();
    const row = await one<{ add_ons: { monthly: Record<string, number> }[] }>(
      `select add_ons from plan_catalog_versions where id = $1`,
      [id],
    );
    expect(row.add_ons[0].monthly).toEqual({ EUR: 1.49, CZK: 39 });
    await expect(
      db.query(`update plan_catalog_versions set add_ons = $2::jsonb where id = $1`, [id, json(seedAddOns())]),
    ).rejects.toThrow(/plan_catalog_history/);
    // Bringing back the earlier version brings back its add-ons (none stored).
    await asUser(owner);
    const { id: restored } = await one<{ id: string }>(
      `select public.admin_plan_catalog_restore($1, $2, null) as id`,
      [current.id, id],
    );
    await asServer();
    expect(
      (await one<{ add_ons: unknown }>(`select add_ons from plan_catalog_versions where id = $1`, [restored]))
        .add_ons,
    ).toBeNull();
  });
});

describe("add-ons of a subscription", () => {
  it("change only through the server, never after expiry", async () => {
    await asUser(user);
    await expect(
      db.query(`update subscriptions set add_ons = '{no_branding}' where user_id = $1`, [user]),
    ).rejects.toThrow(/permission denied/);
    await expect(
      db.query(`select public.subscription_set_add_on($1, 'no_branding', true)`, [user]),
    ).rejects.toThrow(/permission denied/);
    await expect(db.query(`select public.account_has_add_on($1, 'no_branding')`, [user])).rejects.toThrow(
      /permission denied/,
    );

    await asServiceRole();
    const on = await one<{ result: { changed: boolean; add_ons: string[] } }>(
      `select public.subscription_set_add_on($1, 'no_branding', true) as result`,
      [user],
    );
    expect(on.result).toEqual({ changed: true, add_ons: ["no_branding"] });
    const again = await one<{ result: { changed: boolean } }>(
      `select public.subscription_set_add_on($1, 'no_branding', true) as result`,
      [user],
    );
    expect(again.result.changed).toBe(false);
    expect(
      (await one<{ has: boolean }>(`select public.account_has_add_on($1, 'no_branding') as has`, [user])).has,
    ).toBe(true);
    await expect(db.query(`select public.subscription_set_add_on($1, 'other', true)`, [user])).rejects.toThrow(
      /invalid_value/,
    );

    // After the trial ended the add-on no longer counts and cannot be switched.
    await asServer();
    await db.query(`update subscriptions set trial_ends_at = now() - interval '1 minute' where user_id = $1`, [
      user,
    ]);
    await asServiceRole();
    expect(
      (await one<{ has: boolean }>(`select public.account_has_add_on($1, 'no_branding') as has`, [user])).has,
    ).toBe(false);
    await expect(db.query(`select public.subscription_set_add_on($1, 'no_branding', false)`, [user])).rejects.toThrow(
      /expired/,
    );
    await asServer();
    await db.query(`update subscriptions set trial_ends_at = now() + interval '14 days' where user_id = $1`, [
      user,
    ]);
    await expect(
      db.query(`update subscriptions set add_ons = '{unknown}' where user_id = $1`, [user]),
    ).rejects.toThrow();
  });
});

describe("finance_totals_by_currency()", () => {
  it("sums each currency on its own and only in the caller's space", async () => {
    await asUser(user);
    await db.query(
      `insert into transactions (user_id, type, amount, currency, occurred_on) values
         ($1, 'income', 1000, 'CZK', current_date),
         ($1, 'income', 50, 'EUR', current_date),
         ($1, 'expense', 200, 'CZK', current_date),
         ($1, 'income', 3000, 'JPY', current_date)`,
      [user],
    );
    const totals = await rows<{ currency: string; income: string; expense: string }>(
      `select * from finance_totals_by_currency(current_date - 1, current_date + 1)`,
    );
    expect(totals.map((row) => [row.currency, Number(row.income), Number(row.expense)])).toEqual([
      ["CZK", 1000, 200],
      ["EUR", 50, 0],
      ["JPY", 3000, 0],
    ]);
    await asUser(other);
    expect(await rows(`select * from finance_totals_by_currency(current_date - 1, current_date + 1)`)).toEqual([]);
  });
});
