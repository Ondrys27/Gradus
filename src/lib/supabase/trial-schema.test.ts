// @vitest-environment node
//
// Public sign-up and the trial: a new account starts a 14-day trial of pro,
// an invited one is switched to beta, current_plan() reports the state, and a
// workspace whose trial ended is read-only for signed-in users (the owner and
// their workers) while its data stays. Also the waitlist's privacy and the
// owner's overview. Runs every migration in PGlite with the same Supabase
// stubs as schema.test.ts.

import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PAID_PLANS, TRIAL_DAYS, TRIAL_PLAN_KEY } from "@/config/pricing";
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
async function asUser(uid: string) {
  await db.exec(
    `select set_config('request.jwt.claim.sub', '${uid}', false); set role authenticated;`,
  );
}
async function asAnon() {
  await db.exec(`select set_config('request.jwt.claim.sub', '', false); set role anon;`);
}
async function asServer() {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
}
async function createAuthUser() {
  await asServer();
  const { id } = await one<{ id: string }>(
    `insert into auth.users (email) values ($1) returning id`,
    [`${crypto.randomUUID()}@example.com`],
  );
  return id;
}

type Plan = {
  plan_key: string;
  status: string;
  trial_ends_at: string | null;
  read_only: boolean;
  monthly_generation_limit: number;
  ai_calls_limit: number;
};
async function planOf(userId: string) {
  return one<Plan>(`select * from current_plan($1)`, [userId]);
}
async function endTrial(userId: string) {
  await asServer();
  await db.query(
    `update subscriptions set trial_ends_at = now() - interval '1 minute' where user_id = $1`,
    [userId],
  );
}

let appOwner: string;

beforeAll(async () => {
  db = new PGlite({ extensions: PGLITE_EXTENSIONS });
  await db.exec(SUPABASE_STUBS);
  for (const file of readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    await db.exec(readFileSync(path.join(MIGRATIONS_DIR, file), "utf8"));
  }
  appOwner = await createAuthUser();
});

afterAll(async () => {
  await db?.close();
});

describe("plans", () => {
  it("keeps the monthly contact limits of src/config/pricing.ts", async () => {
    for (const plan of PAID_PLANS) {
      const row = await one<{ monthly_generation_limit: number }>(
        `select monthly_generation_limit from plans where key = $1`,
        [plan.key],
      );
      expect(row?.monthly_generation_limit, plan.key).toBe(plan.monthlyContacts);
    }
  });
});

describe("sign-up", () => {
  it("leaves the very first account (the app owner) on beta", async () => {
    const plan = await planOf(appOwner);
    expect(plan.plan_key).toBe("beta");
    expect(plan.status).toBe("active");
    expect(plan.read_only).toBe(false);
  });

  it("starts every other new account on a 14-day trial of pro, without a card", async () => {
    const user = await createAuthUser();
    const plan = await planOf(user);
    expect(plan.plan_key).toBe(TRIAL_PLAN_KEY);
    expect(plan.status).toBe("trialing");
    expect(plan.read_only).toBe(false);
    const days = (Date.parse(plan.trial_ends_at!) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(TRIAL_DAYS - 0.01);
    expect(days).toBeLessThanOrEqual(TRIAL_DAYS);
  });

  it("switches an invited account to beta without an end", async () => {
    const user = await createAuthUser();
    await db.query(`select grant_beta_plan($1)`, [user]);
    const plan = await planOf(user);
    expect(plan).toMatchObject({ plan_key: "beta", status: "active", trial_ends_at: null });
  });

  it("lets only the server grant beta or change a subscription", async () => {
    const user = await createAuthUser();
    await asUser(user);
    await expect(db.query(`select grant_beta_plan($1)`, [user])).rejects.toThrow(
      /permission denied/,
    );
    await db.query(
      `update subscriptions set trial_ends_at = now() + interval '10 years' where user_id = $1`,
      [user],
    );
    await asServer();
    const plan = await planOf(user);
    const days = (Date.parse(plan.trial_ends_at!) - Date.now()) / 86_400_000;
    expect(days).toBeLessThanOrEqual(TRIAL_DAYS);
  });
});

describe("current_plan", () => {
  it("answers a user about their own account and their workspace only", async () => {
    const owner = await createAuthUser();
    const worker = await createAuthUser();
    const stranger = await createAuthUser();
    await db.query(
      `insert into workers (owner_id, user_id, name, status) values ($1, $2, 'Caller', 'active')`,
      [owner, worker],
    );
    await asUser(worker);
    expect((await planOf(owner)).plan_key).toBe("pro");
    expect((await planOf(worker)).plan_key).toBe("pro");
    await expect(planOf(stranger)).rejects.toThrow(/not allowed/);
    await asAnon();
    await expect(planOf(owner)).rejects.toThrow(/permission denied/);
    await asServer();
  });
});

describe("without a subscription", () => {
  it("falls back to the default plan, never to nothing", async () => {
    const user = await createAuthUser();
    await db.query(`delete from subscriptions where user_id = $1`, [user]);
    expect(await planOf(user)).toMatchObject({
      plan_key: "beta",
      status: "active",
      read_only: false,
    });
    expect((await planOf(user)).ai_calls_limit).toBeGreaterThan(0);
  });
});

describe("after the trial", () => {
  let owner: string;
  let worker: string;
  let contact: string;

  beforeAll(async () => {
    owner = await createAuthUser();
    worker = await createAuthUser();
    const { id } = await one<{ id: string }>(
      `insert into workers (owner_id, user_id, name, status) values ($1, $2, 'Caller', 'active') returning id`,
      [owner, worker],
    );
    await db.query(
      `insert into worker_permissions (owner_id, worker_id, section, can_view, can_edit)
       values ($1, $2, 'contacts', true, true)`,
      [owner, id],
    );
    contact = (
      await one<{ id: string }>(
        `insert into contacts (user_id, company_name) values ($1, 'Kept Ltd') returning id`,
        [owner],
      )
    ).id;
    await endTrial(owner);
  });

  it("reports the plan as expired with no limits left", async () => {
    const plan = await planOf(owner);
    expect(plan).toMatchObject({
      status: "expired",
      read_only: true,
      monthly_generation_limit: 0,
      ai_calls_limit: 0,
    });
  });

  it("keeps the data readable", async () => {
    await asUser(owner);
    expect(await rows(`select id from contacts where user_id = $1`, [owner])).toHaveLength(1);
    await asUser(worker);
    expect(await rows(`select id from contacts where user_id = $1`, [owner])).toHaveLength(1);
    await asServer();
  });

  it("refuses new, changed and deleted rows from the owner and the worker", async () => {
    for (const user of [owner, worker]) {
      await asUser(user);
      await expect(
        db.query(`insert into contacts (user_id, company_name) values ($1, 'New')`, [owner]),
      ).rejects.toThrow(/read_only/);
      await expect(
        db.query(`update contacts set company_name = 'Changed' where id = $1`, [contact]),
      ).rejects.toThrow(/read_only/);
      await expect(db.query(`delete from contacts where id = $1`, [contact])).rejects.toThrow(
        /read_only/,
      );
    }
    await asUser(owner);
    await expect(
      db.query(`insert into milestones (user_id, title) values ($1, 'New')`, [owner]),
    ).rejects.toThrow(/read_only/);
    await asServer();
    expect(
      (await one<{ company_name: string }>(`select company_name from contacts where id = $1`, [
        contact,
      ])).company_name,
    ).toBe("Kept Ltd");
  });

  it("refuses writes made through the database's own functions too", async () => {
    await asUser(owner);
    await expect(db.query(`select start_prospecting()`)).rejects.toThrow(/read_only/);
    await asServer();
  });

  it("still lets the owner change their own settings", async () => {
    await asUser(owner);
    await db.query(`update user_settings set sound_enabled = false where user_id = $1`, [owner]);
    await asServer();
  });

  it("is lifted by beta (or a paid plan) without losing anything", async () => {
    await db.query(`select grant_beta_plan($1)`, [owner]);
    await asUser(owner);
    await db.query(`insert into contacts (user_id, company_name) values ($1, 'Again')`, [owner]);
    await asServer();
    expect(
      await rows(`select id from contacts where user_id = $1`, [owner]),
    ).toHaveLength(2);
  });
});

describe("waitlist", () => {
  it("is closed to every client", async () => {
    await asServer();
    await db.query(`insert into waitlist (email, locale, source) values ('a@b.cz', 'cs', 'web')`);
    for (const as of [asAnon, () => asUser(appOwner)]) {
      await as();
      await expect(rows(`select * from waitlist`)).rejects.toThrow(/permission denied/);
      await expect(
        db.query(`insert into waitlist (email) values ('x@y.cz')`),
      ).rejects.toThrow(/permission denied/);
    }
    await asServer();
  });

  it("stores e-mails once and in lower case", async () => {
    await asServer();
    await expect(
      db.query(`insert into waitlist (email) values ('A@B.cz')`),
    ).rejects.toThrow(/check/);
    await expect(db.query(`insert into waitlist (email) values ('a@b.cz')`)).rejects.toThrow(
      /duplicate/,
    );
  });
});

describe("app_overview", () => {
  it("counts trials, expired trials and the waitlist for the app owner only", async () => {
    await asUser(appOwner);
    const overview = await one<Record<string, number>>(`select * from app_overview()`);
    expect(overview.trialing).toBeGreaterThan(0);
    expect(overview.expired).toBe(0);
    expect(overview.waitlist).toBe(1);
    expect(overview.waitlist_confirmed).toBe(0);
    const someone = await createAuthUser();
    await asUser(someone);
    await expect(rows(`select * from app_overview()`)).rejects.toThrow(/not allowed/);
    await asServer();
  });
});
