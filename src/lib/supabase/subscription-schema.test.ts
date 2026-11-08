// @vitest-environment node
//
// Settings → Subscription in the database (step 18.3): subscriptions and
// payments are read-only for their owner and written only by the server;
// a change goes up now or down at the end of the period, a cancellation
// holds until the end of the period and then makes the workspace read-only
// like the end of a trial; billing details are the owner's own; the
// administration sets a subscription by hand into admin_audit. Runs every
// migration in PGlite with the same Supabase stubs as ai-caps-schema.test.ts.

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
async function asUser(uid: string, aal: "aal1" | "aal2" = "aal1") {
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

type Sub = {
  plan_key: string;
  billing: string;
  status: string;
  cancel_at_period_end: boolean;
  cancel_reason: string | null;
  cancel_note: string | null;
  scheduled_plan_key: string | null;
  scheduled_billing: string | null;
  scheduled_at: string | null;
  trial_ends_at: string | null;
  current_period_end: string | null;
};
async function subOf(userId: string) {
  await asServer();
  return one<Sub>(`select * from subscriptions where user_id = $1`, [userId]);
}
async function planOf(userId: string) {
  await asServer();
  return one<{ plan_key: string; status: string; read_only: boolean }>(
    `select plan_key, status, read_only from current_plan($1)`,
    [userId],
  );
}
/** A paid month, as the gateway (or the administration) would leave it. */
async function makeActive(userId: string, plan = "pro", days = 20) {
  await asServer();
  await db.query(
    `update subscriptions set plan_key = $2, status = 'active', billing = 'monthly',
       current_period_start = now(), current_period_end = now() + make_interval(days => $3)
     where user_id = $1`,
    [userId, plan, days],
  );
}
async function call(sql: string, params: unknown[]) {
  await asServiceRole();
  const result = await one<{ r: Row }>(sql, params);
  await asServer();
  return result.r;
}
const change = (user: string, plan: string, billing = "monthly") =>
  call(`select subscription_request_change($1, $2, $3) as r`, [user, plan, billing]);
const cancel = (user: string, reason = "too_expensive", note: string | null = null) =>
  call(`select subscription_cancel($1, $2, $3) as r`, [user, reason, note]);
const resume = (user: string) => call(`select subscription_resume($1) as r`, [user]);

let appOwner: string;

beforeAll(async () => {
  db = new PGlite({ extensions: PGLITE_EXTENSIONS });
  await db.exec(SUPABASE_STUBS);
  for (const file of readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    await db.exec(readFileSync(path.join(MIGRATIONS_DIR, file), "utf8"));
  }
  appOwner = await createAuthUser(); // first account = owner of the app
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe("subscriptions and payments", () => {
  it("start a new account monthly, nothing cancelled or scheduled", async () => {
    const user = await createAuthUser();
    expect(await subOf(user)).toMatchObject({
      plan_key: "pro",
      status: "trialing",
      billing: "monthly",
      cancel_at_period_end: false,
      scheduled_plan_key: null,
    });
  });

  it("are read by their owner only and written by no client", async () => {
    const user = await createAuthUser();
    const stranger = await createAuthUser();
    await asServer();
    const { id: subId } = await one<{ id: string }>(`select id from subscriptions where user_id = $1`, [
      user,
    ]);
    await db.query(
      `insert into payments (user_id, subscription_id, amount, currency, status) values ($1, $2, 890, 'CZK', 'paid')`,
      [user, subId],
    );

    await asUser(user);
    expect(await rows(`select id from subscriptions`)).toHaveLength(1);
    expect(await rows(`select id from payments`)).toHaveLength(1);
    await expect(
      db.query(`update subscriptions set plan_key = 'team' where user_id = $1`, [user]),
    ).rejects.toThrow(/permission denied/);
    await expect(
      db.query(`insert into payments (user_id, amount, currency, status) values ($1, 1, 'CZK', 'paid')`, [
        user,
      ]),
    ).rejects.toThrow(/permission denied/);
    await expect(db.query(`delete from payments where user_id = $1`, [user])).rejects.toThrow(
      /permission denied/,
    );
    for (const sql of [
      `select subscription_request_change($1, 'team', 'monthly')`,
      `select subscription_cancel($1, 'other', null)`,
      `select subscription_resume($1)`,
      `select * from subscription_usage($1)`,
    ]) {
      await expect(db.query(sql, [user])).rejects.toThrow(/permission denied/);
    }

    await asUser(stranger);
    expect(await rows(`select id from payments where user_id = $1`, [user])).toHaveLength(0);
    expect(await rows(`select id from subscriptions where user_id = $1`, [user])).toHaveLength(0);
    await asServer();
    expect((await subOf(user)).plan_key).toBe("pro");
  });
});

describe("changing the plan", () => {
  it("upgrades now and keeps the status", async () => {
    const user = await createAuthUser();
    expect(await change(user, "team")).toMatchObject({ when: "immediate", direction: "upgrade" });
    expect(await subOf(user)).toMatchObject({ plan_key: "team", status: "trialing" });
    expect((await planOf(user)).plan_key).toBe("team");
  });

  it("schedules a downgrade for the end of the trial or the period", async () => {
    const user = await createAuthUser();
    const trialEnd = (await subOf(user)).trial_ends_at!;
    const result = await change(user, "solo", "monthly");
    expect(result).toMatchObject({ when: "scheduled", direction: "downgrade", from_plan: "pro" });
    expect(Math.abs(Date.parse(String(result.at)) - new Date(trialEnd).getTime())).toBeLessThan(1000);
    expect(await subOf(user)).toMatchObject({
      plan_key: "pro",
      scheduled_plan_key: "solo",
      scheduled_billing: "monthly",
    });

    await makeActive(user);
    const periodEnd = (await subOf(user)).current_period_end!;
    const again = await change(user, "pro", "monthly");
    // The current plan drops what was scheduled.
    expect(again).toMatchObject({ when: "none", direction: "same" });
    expect((await subOf(user)).scheduled_plan_key).toBeNull();
    const toYearly = await change(user, "pro", "yearly");
    expect(toYearly).toMatchObject({ when: "immediate", direction: "upgrade" });
    const back = await change(user, "pro", "monthly");
    expect(back).toMatchObject({ when: "scheduled", direction: "downgrade" });
    expect(Math.abs(Date.parse(String(back.at)) - new Date(periodEnd).getTime())).toBeLessThan(1000);
  });

  it("leaves beta to the administration and waits for a cancellation to be taken back", async () => {
    const beta = await createAuthUser();
    await db.query(`select grant_beta_plan($1)`, [beta]);
    await expect(change(beta, "solo")).rejects.toThrow(/not_allowed/);
    await expect(cancel(beta)).rejects.toThrow(/not_allowed/);

    const user = await createAuthUser();
    await cancel(user);
    await expect(change(user, "team")).rejects.toThrow(/cancel_pending/);
    await expect(change(user, "free" as string)).rejects.toThrow(/invalid_value/);
    await asServer();
  });
});

describe("cancelling", () => {
  it("holds until the end of the period, takes the reason, and can be taken back", async () => {
    const user = await createAuthUser();
    await makeActive(user);
    const result = await cancel(user, "missing_features", "  Chybí mi export  ");
    expect(result).toMatchObject({ already: false, plan: "pro", trialing: false });
    expect(await subOf(user)).toMatchObject({
      status: "active",
      cancel_at_period_end: true,
      cancel_reason: "missing_features",
      cancel_note: "Chybí mi export",
    });
    expect(await planOf(user)).toMatchObject({ status: "active", read_only: false });
    expect(await cancel(user)).toMatchObject({ already: true });

    expect(await resume(user)).toMatchObject({ resumed: true });
    expect(await subOf(user)).toMatchObject({
      cancel_at_period_end: false,
      cancel_reason: null,
      cancel_note: null,
    });
    await expect(cancel(user, "nope")).rejects.toThrow(/invalid_value/);
    await asServer();
  });

  it("makes the workspace read-only after the period, data kept", async () => {
    const user = await createAuthUser();
    await makeActive(user);
    await asServer();
    await db.query(`insert into contacts (user_id, company_name) values ($1, 'Kept Ltd')`, [user]);
    await cancel(user);
    await db.query(
      `update subscriptions set current_period_end = now() - interval '1 minute' where user_id = $1`,
      [user],
    );
    expect(await planOf(user)).toMatchObject({ status: "expired", read_only: true });

    await asUser(user);
    expect(await rows(`select id from contacts where user_id = $1`, [user])).toHaveLength(1);
    await expect(
      db.query(`insert into contacts (user_id, company_name) values ($1, 'New Ltd')`, [user]),
    ).rejects.toThrow(/read_only/);
    await asServer();
    await expect(resume(user)).rejects.toThrow(/expired/);
    await asServer();
  });

  it("does not end an active period nobody cancelled (the gateway renews it)", async () => {
    const user = await createAuthUser();
    await makeActive(user);
    await db.query(
      `update subscriptions set current_period_end = now() - interval '1 day' where user_id = $1`,
      [user],
    );
    expect(await planOf(user)).toMatchObject({ status: "active", read_only: false });
  });

  it("ends a cancelled trial at the trial's end, as before", async () => {
    const user = await createAuthUser();
    await cancel(user, "not_using");
    expect(await planOf(user)).toMatchObject({ status: "trialing", read_only: false });
    await db.query(
      `update subscriptions set trial_ends_at = now() - interval '1 minute' where user_id = $1`,
      [user],
    );
    expect(await planOf(user)).toMatchObject({ status: "expired", read_only: true });
  });
});

describe("billing details", () => {
  it("are the owner's own and stay writable in read-only", async () => {
    const owner = await createAuthUser();
    const worker = await createAuthUser();
    const stranger = await createAuthUser();
    await asServer();
    await db.query(
      `insert into workers (owner_id, user_id, name, status) values ($1, $2, 'Caller', 'active')`,
      [owner, worker],
    );
    await db.query(
      `update subscriptions set trial_ends_at = now() - interval '1 minute' where user_id = $1`,
      [owner],
    );

    await asUser(owner);
    await db.query(`insert into billing_profiles (user_id, name, email) values ($1, 'Firma s.r.o.', 'a@b.cz')`, [
      owner,
    ]);
    await db.query(`update billing_profiles set city = 'Brno' where user_id = $1`, [owner]);
    expect(await rows(`select city from billing_profiles`)).toEqual([{ city: "Brno" }]);
    await expect(db.query(`delete from billing_profiles where user_id = $1`, [owner])).rejects.toThrow(
      /permission denied/,
    );

    // A worker owns a space of their own too (22.4): their own details, never the owner's.
    await asUser(worker);
    expect(await rows(`select user_id from billing_profiles`)).toHaveLength(0);
    await db.query(`insert into billing_profiles (user_id, name) values ($1, 'Worker')`, [worker]);
    expect(await rows(`select user_id from billing_profiles`)).toEqual([{ user_id: worker }]);
    await expect(
      db.query(`insert into billing_profiles (user_id, name) values ($1, 'Theirs')`, [owner]),
    ).rejects.toThrow(/row-level security|duplicate/);

    await asUser(stranger);
    expect(await rows(`select user_id from billing_profiles`)).toHaveLength(0);
    await asServer();
  });
});

describe("the administration", () => {
  it("lets only the owner of the app set a subscription, into admin_audit", async () => {
    const user = await createAuthUser();
    await change(user, "solo"); // scheduled, dropped by the manual change
    const set = (status: string, end: string | null, cancelAtEnd = false) =>
      db.query(
        `select admin_subscription_set($1, 'team', 'yearly', $2, $3::timestamptz, $4, null) as old`,
        [user, status, end, cancelAtEnd],
      );
    const end = new Date(Date.now() + 365 * 86_400_000).toISOString();

    await asUser(user, "aal2");
    await expect(set("active", end)).rejects.toThrow(/admin_required/);
    await asUser(appOwner, "aal1");
    await expect(set("active", end)).rejects.toThrow(/admin_required/);

    await asUser(appOwner, "aal2");
    await expect(set("trialing", null)).rejects.toThrow(/invalid_value/);
    const result = await set("active", end);
    expect((result.rows[0] as { old: Row }).old).toMatchObject({ plan: "pro", status: "trialing" });

    const sub = await subOf(user);
    expect(sub).toMatchObject({
      plan_key: "team",
      billing: "yearly",
      status: "active",
      scheduled_plan_key: null,
      cancel_at_period_end: false,
    });
    // The trial happened; the conversion metric counts on it.
    expect(sub.trial_ends_at).not.toBeNull();
    const audit = await one<{ user_id: string; target: string; detail: Row }>(
      `select user_id, target, detail from admin_audit where target = 'users.subscription' order by id desc limit 1`,
    );
    expect(audit).toMatchObject({
      user_id: appOwner,
      target: "users.subscription",
      detail: { user: user, from: { plan: "pro" }, to: { plan: "team", status: "active" } },
    });
  });

  it("counts accounts per plan for the server only", async () => {
    await asUser(appOwner, "aal2");
    await expect(db.query(`select * from admin_plan_user_counts()`)).rejects.toThrow(
      /permission denied/,
    );
    await asServiceRole();
    const counts = await rows<{ plan_key: string; accounts: number; expired: number }>(
      `select * from admin_plan_user_counts()`,
    );
    await asServer();
    const pro = counts.find((row) => row.plan_key === "pro");
    expect(pro?.accounts).toBeGreaterThan(0);
    expect(counts.reduce((sum, row) => sum + row.expired, 0)).toBeGreaterThan(0);
  });
});
