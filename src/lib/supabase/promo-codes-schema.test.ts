// @vitest-environment node
//
// Promo codes and partner commissions in the database (step 22.2): no
// client reads or writes codes, redemptions or payouts; a code is checked
// and redeemed only by the server, at most once per account and before the
// first payment; extra trial days extend a running trial; the first paid
// payment of an account with a code makes one pending payout of the
// commission on the payment without VAT, later payments none; codes are
// saved by the owner or an admin with a live admin session, payouts are
// approved and paid by the owner only, both into admin_audit. Runs every
// migration in PGlite with the same Supabase stubs as subscription-schema.test.ts.

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

let appOwner: string;
let staff: string;
let codeSeq = 0;

/** A code inserted as the server would after the administration saved it. */
async function makeCode(
  values: Partial<{
    benefit: string;
    benefit_value: number;
    commission: number;
    max_uses: number | null;
    active: boolean;
    valid_from: string | null;
    valid_to: string | null;
  }> = {},
) {
  await asServer();
  codeSeq += 1;
  const code = `CODE${String(codeSeq).padStart(4, "0")}`;
  const { id } = await one<{ id: string }>(
    `insert into promo_codes (code, partner_name, kind, benefit, benefit_value, commission_percent_first,
       max_uses, active, valid_from, valid_to)
     values ($1, 'Partner', 'influencer', $2, $3, $4, $5, $6, $7, $8) returning id`,
    [
      code,
      values.benefit ?? "percent_off_first",
      values.benefit_value ?? 50,
      values.commission ?? 20,
      values.max_uses ?? null,
      values.active ?? true,
      values.valid_from ?? null,
      values.valid_to ?? null,
    ],
  );
  return { id, code };
}

async function redeem(user: string, code: string, source = "signup") {
  await asServiceRole();
  const { r } = await one<{ r: Row }>(`select promo_redeem($1, $2, $3) as r`, [user, code, source]);
  await asServer();
  return r;
}

async function pay(user: string, amount: number, vat = 0, status = "paid") {
  await asServer();
  const { id } = await one<{ id: string }>(
    `insert into payments (user_id, amount, vat_amount, currency, status) values ($1, $2, $3, 'CZK', $4) returning id`,
    [user, amount, vat, status],
  );
  return id;
}

async function payoutsOf(user: string) {
  await asServer();
  return rows<{ amount: string; base_amount: string; status: string; code_id: string }>(
    `select amount::text, base_amount::text, status, code_id from partner_payouts where user_id = $1`,
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
  appOwner = await createAuthUser(); // first account = owner of the app
  staff = await createAuthUser();
  await asServer();
  await db.query(`insert into user_roles (user_id, role) values ($1, 'admin')`, [staff]);
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe("access", () => {
  it("lets no client read or write codes, redemptions or payouts", async () => {
    const user = await createAuthUser();
    const { id } = await makeCode();
    for (const uid of [user, appOwner]) {
      await asUser(uid, "aal2");
      for (const table of ["promo_codes", "promo_redemptions", "partner_payouts"]) {
        await expect(db.query(`select 1 from ${table} limit 1`)).rejects.toThrow(
          /permission denied/,
        );
      }
      await expect(
        db.query(
          `insert into promo_redemptions (code_id, user_id, source, benefit, benefit_value, commission_percent_first)
           values ($1, $2, 'signup', 'percent_off_first', 50, 20)`,
          [id, uid],
        ),
      ).rejects.toThrow(/permission denied/);
      await expect(db.query(`update promo_codes set active = false`)).rejects.toThrow(
        /permission denied/,
      );
    }
  });

  it("keeps checking and redeeming to the server", async () => {
    const user = await createAuthUser();
    const { code } = await makeCode();
    await asUser(user);
    await expect(db.query(`select promo_check($1)`, [code])).rejects.toThrow(/permission denied/);
    await expect(db.query(`select promo_redeem($1, $2, 'settings')`, [user, code])).rejects.toThrow(
      /permission denied/,
    );
    await expect(db.query(`select promo_account_status($1)`, [user])).rejects.toThrow(
      /permission denied/,
    );
    await expect(db.query(`select * from admin_promo_code_stats(now())`)).rejects.toThrow(
      /permission denied/,
    );
    await expect(
      db.query(`select * from metric_promo_conversion(current_date, current_date)`),
    ).rejects.toThrow(/permission denied/);
    await asServer();
  });
});

describe("checking and redeeming", () => {
  it("says what a code gives and why it cannot be used", async () => {
    const ok = await makeCode({ benefit: "months_free", benefit_value: 2 });
    const off = await makeCode({ active: false });
    const later = await makeCode({ valid_from: new Date(Date.now() + 86_400_000).toISOString() });
    const over = await makeCode({ valid_to: new Date(Date.now() - 1000).toISOString() });
    const check = async (code: string) => {
      await asServiceRole();
      const { r } = await one<{ r: Row }>(`select promo_check($1) as r`, [code]);
      await asServer();
      return r;
    };
    expect(await check(` ${ok.code.toLowerCase()} `)).toEqual({
      status: "ok",
      code: ok.code,
      benefit: "months_free",
      benefit_value: 2,
    });
    expect((await check(off.code)).status).toBe("inactive");
    expect((await check(later.code)).status).toBe("not_started");
    expect((await check(over.code)).status).toBe("expired");
    expect((await check("NOPE1234")).status).toBe("not_found");
    expect((await check("ab")).status).toBe("invalid");
    expect((await check("ŠKODA")).status).toBe("invalid");
  });

  it("allows one code per account and stops at max_uses", async () => {
    const [a, b, c] = [await createAuthUser(), await createAuthUser(), await createAuthUser()];
    const limited = await makeCode({ max_uses: 2 });
    const other = await makeCode();
    expect((await redeem(a, limited.code)).status).toBe("ok");
    expect((await redeem(a, other.code, "settings")).status).toBe("already_redeemed");
    expect((await redeem(b, limited.code)).status).toBe("ok");
    expect((await redeem(c, limited.code)).status).toBe("exhausted");
    const { count } = await one<{ count: number }>(
      `select count(*)::int as count from promo_redemptions where code_id = $1`,
      [limited.id],
    );
    expect(count).toBe(2);
  });

  it("freezes what the code gave at redemption", async () => {
    const user = await createAuthUser();
    const promo = await makeCode({ benefit_value: 30, commission: 15 });
    await redeem(user, promo.code);
    await asServer();
    await db.query(
      `update promo_codes set benefit_value = 80, commission_percent_first = 50 where id = $1`,
      [promo.id],
    );
    const row = await one<{ benefit_value: number; commission_percent_first: string }>(
      `select benefit_value, commission_percent_first::text from promo_redemptions where user_id = $1`,
      [user],
    );
    expect(row).toEqual({ benefit_value: 30, commission_percent_first: "15.00" });
  });

  it("extends a running trial with extra days, refuses them in the settings without one", async () => {
    const trialing = await createAuthUser();
    const before = await one<{ trial_ends_at: string }>(
      `select trial_ends_at from subscriptions where user_id = $1`,
      [trialing],
    );
    const days = await makeCode({ benefit: "trial_days_extra", benefit_value: 10 });
    const result = await redeem(trialing, days.code, "settings");
    expect(result).toMatchObject({ status: "ok", trial_extended: true });
    const after = await one<{ trial_ends_at: string; current_period_end: string }>(
      `select trial_ends_at, current_period_end from subscriptions where user_id = $1`,
      [trialing],
    );
    expect(new Date(after.trial_ends_at).getTime() - new Date(before.trial_ends_at).getTime()).toBe(
      10 * 86_400_000,
    );
    expect(after.current_period_end).toEqual(after.trial_ends_at);

    const beta = await createAuthUser();
    await asServiceRole();
    await db.query(`select grant_beta_plan($1)`, [beta]);
    expect((await redeem(beta, days.code, "settings")).status).toBe("no_trial");
    // At sign-up the partner still gets the account.
    expect(await redeem(beta, days.code, "signup")).toMatchObject({
      status: "ok",
      trial_extended: false,
    });
  });

  it("refuses a code after the first payment", async () => {
    const user = await createAuthUser();
    const promo = await makeCode();
    await pay(user, 499);
    expect((await redeem(user, promo.code, "settings")).status).toBe("already_paid");
  });

  it("tells the account its code and whether it paid", async () => {
    const user = await createAuthUser();
    const promo = await makeCode({ benefit_value: 50 });
    const status = async () => {
      await asServiceRole();
      const { r } = await one<{ r: Row }>(`select promo_account_status($1) as r`, [user]);
      await asServer();
      return r;
    };
    expect(await status()).toEqual({ redemption: null, paid: false });
    await redeem(user, promo.code);
    expect(await status()).toMatchObject({
      redemption: { code: promo.code, benefit: "percent_off_first", benefit_value: 50 },
      paid: false,
    });
  });
});

describe("partner payouts", () => {
  it("makes one pending payout from the first payment without VAT", async () => {
    const user = await createAuthUser();
    const promo = await makeCode({ commission: 20 });
    await redeem(user, promo.code);
    await pay(user, 0); // a free month is no payment
    await pay(user, 499, 0, "failed");
    expect(await payoutsOf(user)).toEqual([]);
    await pay(user, 604.79, 104.96);
    expect(await payoutsOf(user)).toEqual([
      { amount: "99.97", base_amount: "499.83", status: "pending", code_id: promo.id },
    ]);
    await pay(user, 604.79, 104.96);
    expect(await payoutsOf(user)).toHaveLength(1);
  });

  it("pays nothing for an account without a code or with 0 %", async () => {
    const plain = await createAuthUser();
    await pay(plain, 499);
    expect(await payoutsOf(plain)).toEqual([]);
    const zero = await createAuthUser();
    const promo = await makeCode({ commission: 0 });
    await redeem(zero, promo.code);
    await pay(zero, 499);
    expect(await payoutsOf(zero)).toEqual([]);
  });

  it("counts a failed payment that turns paid", async () => {
    const user = await createAuthUser();
    const promo = await makeCode({ commission: 10 });
    await redeem(user, promo.code);
    const id = await pay(user, 1000, 0, "failed");
    await asServer();
    await db.query(`update payments set status = 'paid' where id = $1`, [id]);
    expect(await payoutsOf(user)).toEqual([
      { amount: "100.00", base_amount: "1000.00", status: "pending", code_id: promo.id },
    ]);
  });

  it("moves pending → approved → paid for the owner of the app only", async () => {
    const user = await createAuthUser();
    const promo = await makeCode({ commission: 10 });
    await redeem(user, promo.code);
    await pay(user, 1000);
    const { id } = await one<{ id: string }>(`select id from partner_payouts where user_id = $1`, [
      user,
    ]);
    const set = (status: string) =>
      db.query(`select admin_partner_payout_set_status($1, $2, null) as r`, [id, status]);

    await asUser(staff, "aal2");
    await expect(set("approved")).rejects.toThrow(/admin_required/);
    await asUser(appOwner, "aal1");
    await expect(set("approved")).rejects.toThrow(/admin_required/);
    await asUser(appOwner, "aal2");
    await expect(set("paid")).rejects.toThrow(/payout_transition/);
    await set("approved");
    await set("pending");
    await set("approved");
    await set("paid");
    await expect(set("approved")).rejects.toThrow(/payout_transition/);
    await asServer();
    const row = await one<{ status: string; approved_by: string; paid_by: string }>(
      `select status, approved_by, paid_by from partner_payouts where id = $1`,
      [id],
    );
    expect(row).toEqual({ status: "paid", approved_by: appOwner, paid_by: appOwner });
    const audit = await rows<{ detail: Row }>(
      `select detail from admin_audit where target = 'settings.promo_payouts' and detail->>'payout' = $1 order by id`,
      [id],
    );
    expect(audit.map((a) => (a.detail.to as Row).status)).toEqual([
      "approved",
      "pending",
      "approved",
      "paid",
    ]);
  });
});

describe("the administration", () => {
  const save = (id: string | null, code: string, active = true) =>
    db.query(
      `select admin_promo_code_save($1, $2, 'Jana Partnerová', 'Jana@Example.com', null, 'partner',
         'percent_off_first', 50, 25, null, null, null, $3, null) as id`,
      [id, code, active],
    );

  it("lets the owner and an admin with a live session save codes, into admin_audit", async () => {
    const user = await createAuthUser();
    await asUser(user, "aal2");
    await expect(save(null, "NEWCODE1")).rejects.toThrow(/admin_required/);
    await asUser(staff, "aal1");
    await expect(save(null, "NEWCODE1")).rejects.toThrow(/admin_required/);

    await asUser(staff, "aal2");
    const { id } = (await save(null, "newcode1")).rows[0] as { id: string };
    await expect(save(null, "NEWCODE1")).rejects.toThrow(/code_taken/);
    await expect(save(null, "NE")).rejects.toThrow(/invalid_value/);
    await asUser(appOwner, "aal2");
    await save(id, "NEWCODE2", false);
    await asServer();
    const row = await one<{
      code: string;
      partner_email: string;
      active: boolean;
      created_by: string;
    }>(`select code, partner_email, active, created_by from promo_codes where id = $1`, [id]);
    expect(row).toEqual({
      code: "NEWCODE2",
      partner_email: "jana@example.com",
      active: false,
      created_by: staff,
    });
    const audit = await rows<{ user_id: string; detail: Row }>(
      `select user_id, detail from admin_audit where target = 'settings.promo_codes' and detail->>'code_id' = $1 order by id`,
      [id],
    );
    expect(audit.map((a) => a.user_id)).toEqual([staff, appOwner]);
    expect(JSON.stringify(audit)).not.toContain("Jana");
    expect(JSON.stringify(audit)).not.toContain("example.com");
  });

  it("keeps the text of a code accounts already used", async () => {
    const promo = await makeCode();
    await redeem(await createAuthUser(), promo.code);
    await asUser(appOwner, "aal2");
    await expect(save(promo.id, "RENAMED1")).rejects.toThrow(/code_in_use/);
    await save(promo.id, promo.code, false);
    await db.query(`select admin_promo_code_set_active($1, true, null)`, [promo.id]);
    await asServer();
  });

  it("counts accounts, paying ones and commissions per code", async () => {
    const promo = await makeCode({ commission: 10 });
    const [a, b] = [await createAuthUser(), await createAuthUser()];
    await redeem(a, promo.code);
    await redeem(b, promo.code);
    await pay(a, 1000);
    await asServiceRole();
    const stats = await one<Row>(
      `select redemptions, redemptions_since, paying, paying_since, payouts_due, payouts_paid
       from admin_promo_code_stats(now() - interval '30 days') where code_id = $1`,
      [promo.id],
    );
    expect(stats).toEqual({
      redemptions: 2,
      redemptions_since: 2,
      paying: 1,
      paying_since: 1,
      payouts_due: { CZK: 100 },
      payouts_paid: {},
    });
    const users = await rows<{ user_id: string; first_paid_at: string | null; total: number }>(
      `select user_id, first_paid_at, total::int from admin_promo_code_users($1, 50, 0)`,
      [promo.id],
    );
    expect(users).toHaveLength(2);
    expect(users.find((u) => u.user_id === a)?.first_paid_at).not.toBeNull();
    expect(users.find((u) => u.user_id === b)?.first_paid_at).toBeNull();
    const conversion = await one<{ redeemed: number; paying: number }>(
      `select redeemed::int, paying::int from metric_promo_conversion(current_date - 1, current_date + 1, 'Europe/Prague', true)`,
    );
    expect(conversion.redeemed).toBeGreaterThanOrEqual(2);
    expect(conversion.paying).toBeGreaterThanOrEqual(1);
    await asServer();
  });
});
