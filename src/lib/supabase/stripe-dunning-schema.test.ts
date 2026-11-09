// @vitest-environment node
//
// Managing payments in the database (step 23.2): a payment keeps the plan
// and the period it paid for (a refund keeps them); the owner's digest
// records each first payment or ended subscription once and lets one e-mail
// out a day; the payment metrics count revenue, refunds, paying accounts and
// still failed payments per currency, live mode only unless internal
// accounts are asked for. No client reads billing_alerts or calls any of it.
// Runs every migration in PGlite with the same stubs as
// stripe-billing-schema.test.ts.

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
const testAccount = () => createAuthUser(`e2e-${crypto.randomUUID().slice(0, 8)}@gradus.local`);

const iso = (offsetDays: number) => new Date(Date.now() + offsetDays * 86_400_000).toISOString();
const today = () => new Date().toISOString().slice(0, 10);

async function record(user: string, invoice: string, values: Partial<Record<string, unknown>> = {}) {
  await asServiceRole();
  const { r } = await one<{ r: Row }>(
    `select billing_record_payment($1, $2, $3, $4, $5, $6, 0, $7, $8, null, $9, $10, $11, $12) as r`,
    [
      user,
      values.mode ?? "test",
      values.eventAt ?? new Date().toISOString(),
      invoice,
      values.status ?? "paid",
      values.amount ?? 890,
      values.currency ?? "CZK",
      values.paidAt ?? new Date().toISOString(),
      values.plan ?? null,
      values.billing ?? null,
      values.periodStart ?? null,
      values.periodEnd ?? null,
    ],
  );
  await asServer();
  return r;
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

describe("access", () => {
  it("lets no client read the alerts or call the new functions", async () => {
    const user = await createAuthUser();
    await asUser(user);
    await expect(db.query(`select 1 from billing_alerts limit 1`)).rejects.toThrow(/permission denied/);
    for (const sql of [
      `select billing_alert_add('first_payment', '${user}', 'live', 'in_x')`,
      `select * from billing_alerts_claim()`,
      `select billing_alerts_release(array[]::uuid[])`,
      `select * from metric_payments(current_date, current_date)`,
      `select billing_record_payment('${user}', 'live', now(), 'in_x', 'paid', 1, 0, 'CZK', now(), null, 'pro', 'monthly', now(), now())`,
    ]) {
      await expect(db.query(sql)).rejects.toThrow(/permission denied/);
    }
    // The payment's new columns are read-only for the client like the rest.
    await expect(db.query(`update payments set plan_key = 'team' where user_id = $1`, [user])).rejects.toThrow(
      /permission denied/,
    );
    await asServer();
  });
});

describe("what a payment paid for", () => {
  it("keeps the plan and the period; a refund keeps what it was for; the old call still works", async () => {
    const user = await testAccount();
    const start = iso(0);
    const end = iso(30);
    expect(
      await record(user, "in_period", { plan: "pro", billing: "monthly", periodStart: start, periodEnd: end }),
    ).toMatchObject({ outcome: "applied" });
    await record(user, "in_period", { status: "refunded", plan: "team", billing: "yearly", eventAt: iso(0.01) });
    await asServer();
    const row = await one<Row>(
      `select status, plan_key, billing, period_start = $2::timestamptz as same_start, period_end = $3::timestamptz as same_end
       from payments where provider_ref = 'in_period' and user_id = $1`,
      [user, start, end],
    );
    expect(row).toEqual({ status: "refunded", plan_key: "pro", billing: "monthly", same_start: true, same_end: true });

    // The ten arguments of step 23.1 still record a payment, without a plan.
    await asServiceRole();
    await db.query(`select billing_record_payment($1, 'test', now(), 'in_old_call', 'paid', 1, 0, 'CZK', now(), null)`, [
      user,
    ]);
    await asServer();
    expect(await one(`select plan_key from payments where provider_ref = 'in_old_call'`)).toEqual({ plan_key: null });
  });

  it("checks the plan, the billing and the period's order", async () => {
    const user = await testAccount();
    await expect(record(user, "in_bad_plan", { plan: "beta" })).rejects.toThrow(/invalid_value/);
    await expect(record(user, "in_bad_billing", { billing: "weekly" })).rejects.toThrow(/invalid_value/);
    await expect(record(user, "in_bad_period", { periodStart: iso(2), periodEnd: iso(1) })).rejects.toThrow(
      /invalid_value/,
    );
    await asServer();
  });
});

describe("the owner's digest", () => {
  it("records an alert once and lets one digest out a day, the rest waits; a failed e-mail gives them back", async () => {
    const a = await testAccount();
    const b = await testAccount();
    await asServiceRole();
    const add = async (kind: string, user: string, ref: string) =>
      (await one<{ ok: boolean }>(`select billing_alert_add($1, $2, 'test', $3, 'pro', 'monthly', 890, 'CZK') as ok`, [
        kind,
        user,
        ref,
      ])).ok;
    expect(await add("first_payment", a, "in_digest_a")).toBe(true);
    expect(await add("first_payment", a, "in_digest_a")).toBe(false);
    expect(await add("final_failure", b, "sub_digest_b")).toBe(true);
    await expect(db.query(`select billing_alert_add('other', $1, 'test', 'in_x')`, [a])).rejects.toThrow(/invalid_value/);

    const first = await rows<{ kind: string; user_id: string }>(`select kind, user_id from billing_alerts_claim('Europe/Prague')`);
    expect(first.map((row) => row.kind).sort()).toEqual(["final_failure", "first_payment"]);
    // A digest went out today: the next alert waits for tomorrow's.
    expect(await add("first_payment", b, "in_digest_c")).toBe(true);
    expect(await rows(`select * from billing_alerts_claim('Europe/Prague')`)).toEqual([]);

    // The e-mail could not be sent: everything goes back and the next try takes it.
    const ids = (await rows<{ id: string }>(`select id from billing_alerts where notified_at is not null`)).map((r) => r.id);
    await db.query(`select billing_alerts_release($1::uuid[])`, [ids]);
    const again = await rows<{ kind: string }>(`select kind from billing_alerts_claim('Europe/Prague')`);
    expect(again).toHaveLength(3);
    await asServer();
  });
});

describe("payment metrics", () => {
  it("counts per currency: revenue, refunds, paying accounts and still failed payments; live only unless internal", async () => {
    const live1 = await createAuthUser();
    const live2 = await createAuthUser();
    const internal = await testAccount();
    await record(live1, "in_m_1", { mode: "live", amount: 890 });
    await record(live1, "in_m_2", { mode: "live", amount: 890 });
    await record(live2, "in_m_3", { mode: "live", amount: 19, currency: "EUR" });
    await record(live2, "in_m_4", { mode: "live", amount: 890 });
    await record(live2, "in_m_4", { mode: "live", status: "refunded", eventAt: iso(0.01) });
    await record(live2, "in_m_5", { mode: "live", status: "failed", amount: 890 });
    await record(internal, "in_m_6", { amount: 5000 });
    // Outside the period.
    await record(live1, "in_m_7", { mode: "live", amount: 999, paidAt: iso(-40) });

    await asServiceRole();
    const result = await rows<Row>(
      `select key, revenue::text, refunded::text, paying_accounts::int, failed_payments::int
       from metric_payments($1::date - 1, $1::date, 'Europe/Prague') order by key`,
      [today()],
    );
    expect(result).toEqual([
      { key: "CZK", revenue: "1780.00", refunded: "890.00", paying_accounts: 1, failed_payments: 1 },
      { key: "EUR", revenue: "19.00", refunded: "0", paying_accounts: 1, failed_payments: 0 },
    ]);
    const withInternal = await rows<Row>(
      `select key, revenue::text from metric_payments($1::date - 1, $1::date, 'Europe/Prague', true) where key = 'CZK'`,
      [today()],
    );
    // The test mode's internal accounts count too (other tests of this file paid a little as well).
    expect(Number(withInternal[0]?.revenue)).toBeGreaterThanOrEqual(6780);
    await asServer();
  });
});
