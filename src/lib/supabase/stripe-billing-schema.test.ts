// @vitest-environment node
//
// Payments through Stripe in the database (step 23.1): no client reads or
// writes billing_customers or stripe_events or calls the billing functions;
// a mode changes only the accounts it may (test: internal and @gradus.local,
// live: the others); Stripe's state of a subscription is applied in order
// (an older event never overwrites a newer one, a cancelled subscription
// that the row no longer follows changes nothing); a payment only moves
// forward (failed → paid → refunded) and the first paid one of an account
// with a promo code makes the partner's payout; every webhook event is
// processed once. Runs every migration in PGlite with the same Supabase stubs
// as promo-codes-schema.test.ts.

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

type Apply = Partial<{
  mode: string;
  eventAt: string;
  ref: string;
  plan: string;
  billing: string;
  status: string;
  periodStart: string | null;
  periodEnd: string | null;
  trialEnd: string | null;
  cancel: boolean;
  scheduled: [string, string, string] | null;
  amount: number | null;
  currency: string | null;
}>;

async function apply(user: string, values: Apply = {}) {
  await asServiceRole();
  const scheduled = values.scheduled ?? null;
  const { r } = await one<{ r: Row }>(
    `select billing_apply_subscription($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) as r`,
    [
      user,
      values.mode ?? "test",
      values.eventAt ?? new Date().toISOString(),
      values.ref ?? `sub_${user.replace(/-/g, "")}`,
      values.plan ?? "pro",
      values.billing ?? "monthly",
      values.status ?? "active",
      values.periodStart === undefined ? iso(0) : values.periodStart,
      values.periodEnd === undefined ? iso(30) : values.periodEnd,
      values.trialEnd ?? null,
      values.cancel ?? false,
      scheduled?.[0] ?? null,
      scheduled?.[1] ?? null,
      scheduled?.[2] ?? null,
      values.amount === undefined ? 890 : values.amount,
      values.currency === undefined ? "CZK" : values.currency,
    ],
  );
  await asServer();
  return r;
}

async function record(
  user: string,
  values: Partial<{
    mode: string;
    eventAt: string;
    invoice: string;
    status: string;
    amount: number;
    vat: number;
    currency: string;
    paidAt: string;
    url: string | null;
  }> = {},
) {
  await asServiceRole();
  const { r } = await one<{ r: Row }>(
    `select billing_record_payment($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) as r`,
    [
      user,
      values.mode ?? "test",
      values.eventAt ?? new Date().toISOString(),
      values.invoice ?? "in_test_1",
      values.status ?? "paid",
      values.amount ?? 890,
      values.vat ?? 0,
      values.currency ?? "CZK",
      values.paidAt ?? new Date().toISOString(),
      values.url === undefined ? "https://invoice.stripe.com/i/test" : values.url,
    ],
  );
  await asServer();
  return r;
}

async function subscriptionOf(user: string) {
  await asServer();
  return one<Row>(
    `select plan_key, billing, status::text as status, provider, provider_ref, stripe_mode,
       cancel_at_period_end, cancel_reason, cancel_note, scheduled_plan_key, scheduled_billing,
       trial_ends_at, stripe_amount::text as stripe_amount, stripe_currency
     from subscriptions where user_id = $1`,
    [user],
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
  await createAuthUser(); // first account = owner of the app
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe("access", () => {
  it("lets no client read or write customers and events, nor call the billing functions", async () => {
    const user = await createAuthUser();
    await asUser(user);
    for (const table of ["billing_customers", "stripe_events"]) {
      await expect(db.query(`select 1 from ${table} limit 1`)).rejects.toThrow(/permission denied/);
    }
    await expect(
      db.query(`insert into billing_customers (user_id, stripe_customer_id) values ($1, 'cus_x')`, [user]),
    ).rejects.toThrow(/permission denied/);
    const calls = [
      `select billing_mode_allowed('${user}', 'live')`,
      `select billing_customer_save('${user}', 'live', 'cus_x')`,
      `select billing_event_claim('evt_x', 'live', 'invoice.paid', now())`,
      `select billing_event_finish('evt_x', 'applied', null, '{}'::jsonb)`,
      `select billing_apply_subscription('${user}', 'live', now(), 'sub_x', 'pro', 'monthly', 'active', now(), now(), null, false)`,
      `select billing_record_payment('${user}', 'live', now(), 'in_x', 'paid', 1, 0, 'CZK', now(), null)`,
      `select * from metric_mrr()`,
      `select * from metric_trial_conversion(current_date, current_date)`,
    ];
    for (const sql of calls) {
      await expect(db.query(sql)).rejects.toThrow(/permission denied/);
    }
    // The subscription and payments stay closed to writes as before.
    await expect(db.query(`update subscriptions set stripe_mode = 'live' where user_id = $1`, [user])).rejects.toThrow(
      /permission denied/,
    );
    await expect(
      db.query(`update payments set stripe_mode = 'live' where user_id = $1`, [user]),
    ).rejects.toThrow(/permission denied/);
    await asServer();
  });
});

describe("modes", () => {
  it("test mode for internal and @gradus.local accounts, live for the others only", async () => {
    const local = await testAccount();
    const customer = await createAuthUser();
    const internal = await createAuthUser();
    await asServer();
    await db.query(`update profiles set is_internal = true where id = $1`, [internal]);
    await asServiceRole();
    const allowed = async (user: string, mode: string) =>
      (await one<{ ok: boolean }>(`select billing_mode_allowed($1, $2) as ok`, [user, mode])).ok;
    expect(await allowed(local, "test")).toBe(true);
    expect(await allowed(local, "live")).toBe(false);
    expect(await allowed(customer, "live")).toBe(true);
    expect(await allowed(customer, "test")).toBe(false);
    expect(await allowed(internal, "test")).toBe(true);
    expect(await allowed(internal, "live")).toBe(false);
    expect(await allowed(crypto.randomUUID(), "test")).toBe(false);
    expect(await allowed(customer, "other")).toBe(false);
    await asServer();
  });

  it("refuses the wrong mode in every write", async () => {
    const local = await testAccount();
    const customer = await createAuthUser();
    expect(await apply(local, { mode: "live" })).toEqual({ outcome: "rejected", reason: "mode" });
    expect(await apply(customer, { mode: "test" })).toEqual({ outcome: "rejected", reason: "mode" });
    expect(await record(local, { mode: "live" })).toEqual({ outcome: "rejected", reason: "mode" });
    await asServiceRole();
    await expect(db.query(`select billing_customer_save($1, 'live', 'cus_live1')`, [local])).rejects.toThrow(
      /mode_not_allowed/,
    );
    await asServer();
    expect(await subscriptionOf(local)).toMatchObject({ provider: null, stripe_mode: null });
  });
});

describe("customers", () => {
  it("keeps one customer per workspace and mode, returning the first saved", async () => {
    const user = await testAccount();
    await asServiceRole();
    const first = await one<{ id: string }>(`select billing_customer_save($1, 'test', 'cus_first') as id`, [user]);
    const second = await one<{ id: string }>(`select billing_customer_save($1, 'test', 'cus_second') as id`, [user]);
    expect(first.id).toBe("cus_first");
    expect(second.id).toBe("cus_first");
    await asServer();
    const { n } = await one<{ n: number }>(`select count(*)::int as n from billing_customers where user_id = $1`, [user]);
    expect(n).toBe(1);
  });
});

describe("the subscription", () => {
  it("takes Stripe's state: plan, period, status, link and the recurring amount", async () => {
    const user = await testAccount();
    const periodEnd = iso(365);
    const result = await apply(user, { plan: "team", billing: "yearly", amount: 8900, periodEnd });
    expect(result).toMatchObject({ outcome: "applied", changed: true, linked: true });
    expect(await subscriptionOf(user)).toMatchObject({
      plan_key: "team",
      billing: "yearly",
      status: "active",
      provider: "stripe",
      provider_ref: `sub_${user.replace(/-/g, "")}`,
      stripe_mode: "test",
      stripe_amount: "8900.00",
      stripe_currency: "CZK",
    });
    // The same state again changes nothing.
    expect(await apply(user, { plan: "team", billing: "yearly", amount: 8900, periodEnd })).toMatchObject({
      outcome: "unchanged",
      changed: false,
      linked: false,
    });
  });

  it("never lets an older event overwrite a newer one", async () => {
    const user = await testAccount();
    const now = Date.now();
    await apply(user, { status: "past_due", eventAt: new Date(now).toISOString() });
    const older = await apply(user, { status: "active", eventAt: new Date(now - 60_000).toISOString() });
    expect(older).toEqual({ outcome: "stale" });
    expect((await subscriptionOf(user)).status).toBe("past_due");
    const newer = await apply(user, { status: "active", eventAt: new Date(now + 60_000).toISOString() });
    expect(newer).toMatchObject({ outcome: "applied", previous_status: "past_due" });
    expect((await subscriptionOf(user)).status).toBe("active");
  });

  it("ignores a cancelled subscription the row no longer follows, accepts a new one", async () => {
    const user = await testAccount();
    await apply(user, { ref: "sub_old", status: "cancelled", eventAt: iso(-2) });
    await apply(user, { ref: "sub_new", status: "active", eventAt: iso(-1) });
    expect(await apply(user, { ref: "sub_old", status: "cancelled" })).toMatchObject({
      outcome: "stale",
      reason: "other_subscription",
    });
    expect(await subscriptionOf(user)).toMatchObject({ provider_ref: "sub_new", status: "active" });
    // Nor does another workspace take it over.
    const other = await testAccount();
    expect(await apply(other, { ref: "sub_new" })).toEqual({ outcome: "rejected", reason: "other_account" });
  });

  it("refuses a row linked to the other mode", async () => {
    const user = await testAccount();
    await apply(user);
    await asServer();
    // As if the row had come from live (only possible by hand).
    await db.query(`update subscriptions set stripe_mode = 'live' where user_id = $1`, [user]);
    expect(await apply(user)).toEqual({ outcome: "rejected", reason: "mode" });
  });

  it("keeps the user's cancel reason while Stripe cancels at the period's end, clears it when resumed", async () => {
    const user = await testAccount();
    await apply(user, { eventAt: iso(-1) });
    await asServiceRole();
    await db.query(`select subscription_cancel($1, 'too_expensive', 'Moc drahé')`, [user]);
    await apply(user, { cancel: true });
    expect(await subscriptionOf(user)).toMatchObject({
      cancel_at_period_end: true,
      cancel_reason: "too_expensive",
      cancel_note: "Moc drahé",
    });
    await apply(user, { cancel: false, eventAt: iso(1) });
    expect(await subscriptionOf(user)).toMatchObject({
      cancel_at_period_end: false,
      cancel_reason: null,
      cancel_note: null,
    });
  });

  it("holds a downgrade scheduled in Stripe, and the trial's end while trialing", async () => {
    const user = await testAccount();
    const end = iso(10);
    await apply(user, { status: "trialing", trialEnd: end, periodEnd: end, scheduled: ["solo", "monthly", end] });
    const row = await subscriptionOf(user);
    expect(row).toMatchObject({ status: "trialing", scheduled_plan_key: "solo", scheduled_billing: "monthly" });
    expect(new Date(row.trial_ends_at as string).toISOString()).toBe(end);
    await apply(user, { status: "active", scheduled: null, eventAt: iso(1) });
    const after = await subscriptionOf(user);
    expect(after).toMatchObject({ status: "active", scheduled_plan_key: null });
    // The trial's end stays as history.
    expect(new Date(after.trial_ends_at as string).toISOString()).toBe(end);
  });

  it("checks every value", async () => {
    const user = await testAccount();
    await asServiceRole();
    const bad = [
      [user, "test", "now()", "sub_x", "beta", "monthly", "active"],
      [user, "test", "now()", "sub_x", "pro", "weekly", "active"],
      [user, "test", "now()", "sub_x", "pro", "monthly", "incomplete"],
      [user, "test", "now()", "nope", "pro", "monthly", "active"],
    ];
    for (const [u, mode, , ref, plan, billing, status] of bad) {
      await expect(
        db.query(
          `select billing_apply_subscription($1, $2, now(), $3, $4, $5, $6, now(), now() + interval '1 day', null, false)`,
          [u, mode, ref, plan, billing, status],
        ),
      ).rejects.toThrow(/invalid_value/);
    }
    await asServer();
  });
});

describe("payments", () => {
  async function promoCode(commission: number) {
    await asServer();
    const code = `STR${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`.slice(0, 12);
    const { id } = await one<{ id: string }>(
      `insert into promo_codes (code, partner_name, kind, benefit, benefit_value, commission_percent_first)
       values ($1, 'Partner', 'influencer', 'percent_off_first', 50, $2) returning id`,
      [code, commission],
    );
    return { id, code };
  }

  it("records a paid invoice once, the first one making the partner's payout", async () => {
    const user = await testAccount();
    await apply(user);
    const promo = await promoCode(20);
    await asServiceRole();
    await db.query(`select promo_redeem($1, $2, 'signup')`, [user, promo.code]);
    // The trial's start: an invoice of 0 is recorded, but it is not the first payment.
    expect(await record(user, { invoice: "in_trial", amount: 0 })).toMatchObject({ outcome: "applied", first: false });
    const first = await record(user, { invoice: "in_first", amount: 445 });
    expect(first).toMatchObject({ outcome: "applied", first: true });
    const again = await record(user, { invoice: "in_first", amount: 445 });
    expect(again).toMatchObject({ outcome: "unchanged" });
    const second = await record(user, { invoice: "in_second", amount: 890 });
    expect(second).toMatchObject({ outcome: "applied", first: false });
    await asServer();
    const payouts = await rows<{ base_amount: string; amount: string }>(
      `select base_amount::text, amount::text from partner_payouts where user_id = $1`,
      [user],
    );
    // Without VAT = the whole amount: 20 % of 445.
    expect(payouts).toEqual([{ base_amount: "445.00", amount: "89.00" }]);
    const stored = await rows<{ status: string; provider: string; stripe_mode: string; invoice_url: string }>(
      `select status, provider, stripe_mode, invoice_url from payments where user_id = $1 order by paid_at`,
      [user],
    );
    expect(stored).toHaveLength(3);
    expect(stored[1]).toMatchObject({ status: "paid", provider: "stripe", stripe_mode: "test" });
    expect(stored[1].invoice_url).toMatch(/^https:\/\//);
  });

  it("moves only forward: failed → paid → refunded, never back", async () => {
    const user = await testAccount();
    await apply(user);
    expect(await record(user, { invoice: "in_retry", status: "failed" })).toMatchObject({ outcome: "applied" });
    expect(await record(user, { invoice: "in_retry", status: "failed" })).toMatchObject({ outcome: "applied" });
    expect(await record(user, { invoice: "in_retry", status: "paid" })).toMatchObject({
      outcome: "applied",
      previous_status: "failed",
      first: true,
    });
    expect(await record(user, { invoice: "in_retry", status: "failed" })).toMatchObject({ outcome: "stale" });
    expect(await record(user, { invoice: "in_retry", status: "refunded" })).toMatchObject({
      outcome: "applied",
      previous_status: "paid",
    });
    expect(await record(user, { invoice: "in_retry", status: "paid" })).toMatchObject({ outcome: "stale" });
    await asServer();
    const { status, n } = await one<{ status: string; n: number }>(
      `select max(status) as status, count(*)::int as n from payments where user_id = $1`,
      [user],
    );
    expect({ status, n }).toEqual({ status: "refunded", n: 1 });
  });

  it("refuses an invoice of another account and a link that is not https", async () => {
    const a = await testAccount();
    const b = await testAccount();
    await record(a, { invoice: "in_shared" });
    expect(await record(b, { invoice: "in_shared" })).toEqual({ outcome: "rejected", reason: "other_account" });
    await asServiceRole();
    await expect(
      db.query(
        `select billing_record_payment($1, 'test', now(), 'in_http', 'paid', 1, 0, 'CZK', now(), 'http://x')`,
        [a],
      ),
    ).rejects.toThrow(/invalid_value/);
    await asServer();
  });
});

describe("webhook events", () => {
  it("processes each event once", async () => {
    await asServiceRole();
    const claim = async (id: string) =>
      (await one<{ r: string }>(`select billing_event_claim($1, 'test', 'invoice.paid', now()) as r`, [id])).r;
    expect(await claim("evt_once")).toBe("new");
    // Another delivery while the first one works on it.
    expect(await claim("evt_once")).toBe("busy");
    await db.query(`select billing_event_finish('evt_once', 'applied', null, '{"object":"in_1"}'::jsonb)`);
    expect(await claim("evt_once")).toBe("duplicate");

    expect(await claim("evt_failed")).toBe("new");
    await db.query(`select billing_event_finish('evt_failed', 'error', null, '{}'::jsonb)`);
    expect(await claim("evt_failed")).toBe("retry");
    await asServer();
    const stored = await one<{ attempts: number; outcome: string | null }>(
      `select attempts, outcome from stripe_events where event_id = 'evt_failed'`,
    );
    expect(stored).toEqual({ attempts: 2, outcome: "error" });
  });

  it("keeps only identifiers in the detail", async () => {
    await asServiceRole();
    await db.query(`select billing_event_claim('evt_big', 'test', 'invoice.paid', now())`);
    await expect(
      db.query(`select billing_event_finish('evt_big', 'applied', null, $1::jsonb)`, [
        JSON.stringify({ blob: "x".repeat(5000) }),
      ]),
    ).rejects.toThrow();
    await asServer();
  });
});

describe("metrics", () => {
  it("counts MRR per currency, a year as a twelfth", async () => {
    const a = await testAccount();
    const b = await testAccount();
    await apply(a, { billing: "monthly", amount: 890, currency: "CZK" });
    await apply(b, { billing: "yearly", amount: 420, currency: "EUR" });
    await asServiceRole();
    const mrr = await rows<{ key: string; value: string }>(
      `select key, value::text from metric_mrr('Europe/Prague', true) where key in ('CZK', 'EUR') order by key`,
    );
    await asServer();
    const byCurrency = Object.fromEntries(mrr.map((row) => [row.key, Number(row.value)]));
    expect(byCurrency.CZK).toBeGreaterThanOrEqual(890);
    expect(byCurrency.EUR).toBeGreaterThanOrEqual(35);
  });
});
