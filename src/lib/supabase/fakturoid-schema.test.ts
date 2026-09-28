// @vitest-environment node
//
// Fakturoid in the database: the connection stays server-only, the link to a
// Fakturoid invoice and its facts cannot be changed by the client, and the
// server applies Fakturoid's state (payment, won deal) exactly once. Runs every
// migration in PGlite with the same Supabase stubs as schema.test.ts.

import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

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
grant usage on schema public, auth, storage to anon, authenticated, service_role, supabase_auth_admin;
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
async function count(sql: string, params?: unknown[]) {
  return (await one<{ n: number }>(`select count(*)::int as n from (${sql}) q`, params)).n;
}
async function asUser(uid: string) {
  await db.exec(
    `select set_config('request.jwt.claim.sub', '${uid}', false); set role authenticated;`,
  );
}
async function asServer() {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
}
async function asServiceRole() {
  await db.exec(`select set_config('request.jwt.claim.sub', '', false); set role service_role;`);
}
async function createAuthUser(locale = "en") {
  const { id } = await one<{ id: string }>(
    `insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id`,
    [`${crypto.randomUUID()}@example.com`, JSON.stringify({ locale })],
  );
  return id;
}

let owner: string;
let stranger: string;
let stages: Record<string, string>;

async function newContact(name = "Acme s.r.o.") {
  await asServer();
  return (
    await one<{ id: string }>(
      `insert into contacts (user_id, company_name) values ($1, $2) returning id`,
      [owner, name],
    )
  ).id;
}
async function newDeal(stage: string, contact: string | null, value = 10000) {
  await asServer();
  return (
    await one<{ id: string }>(
      `insert into deals (user_id, contact_id, stage_id, title, value) values ($1, $2, $3, 'Web', $4) returning id`,
      [owner, contact, stage, value],
    )
  ).id;
}
/** An invoice mirrored from Fakturoid, the way the server inserts it. */
async function mirrored(deal: string, contact: string, fakturoidId: number, amount = 10000) {
  await asServer();
  return (
    await one<{ id: string }>(
      `insert into invoices (user_id, number, amount, status, issued_on, due_on, customer_name, contact_id, deal_id, fakturoid_id)
       values ($1, $2, $3, 'open', current_date, current_date + 14, 'Acme s.r.o.', $4, $5, $6) returning id`,
      [owner, `FA-${fakturoidId}`, amount, contact, deal, fakturoidId],
    )
  ).id;
}
async function apply(
  user: string,
  fakturoidId: number,
  status: string,
  paidOn: string | null,
  moveDeal: boolean,
) {
  await asServiceRole();
  const result = await one<{ r: Record<string, unknown> | null }>(
    `select fakturoid_apply_invoice($1, $2, $3::invoice_status, null, null, current_date + 30, $4::date, $5) as r`,
    [user, fakturoidId, status, paidOn, moveDeal],
  );
  await asServer();
  return result.r;
}
const income = (deal: string) =>
  rows<{ source: string; amount: string; occurred_on: string }>(
    `select source, amount::text, occurred_on::text from transactions where deal_id = $1 order by source`,
    [deal],
  );

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SUPABASE_STUBS);
  for (const file of readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    await db.exec(readFileSync(path.join(MIGRATIONS_DIR, file), "utf8"));
  }
  owner = await createAuthUser("cs");
  stranger = await createAuthUser();
  stages = Object.fromEntries(
    (
      await rows<{ system_key: string; id: string }>(
        `select system_key, id from pipeline_stages where user_id = $1`,
        [owner],
      )
    ).map((r) => [r.system_key, r.id]),
  );
});

afterAll(async () => {
  await db?.close();
});

describe("fakturoid connection", () => {
  it("is invisible and unwritable for clients, even their own row", async () => {
    await asServer();
    await db.query(
      `insert into fakturoid_connections (user_id, account_slug, encrypted_credentials) values ($1, 'acme', 'v1:x:y:z')`,
      [owner],
    );
    await asUser(owner);
    expect(await count(`select 1 from fakturoid_connections`)).toBe(0);
    await expect(
      db.query(
        `insert into fakturoid_connections (user_id, account_slug, encrypted_credentials) values ($1, 'evil', 'x')`,
        [stranger],
      ),
    ).rejects.toThrow();
    await db.query(`update fakturoid_connections set move_deal_on_paid = true`);
    await asServer();
    expect(
      (
        await one<{ m: boolean }>(
          `select move_deal_on_paid as m from fakturoid_connections where user_id = $1`,
          [owner],
        )
      ).m,
    ).toBe(false);
  });
});

describe("invoices mirrored from Fakturoid", () => {
  it("keeps fakturoid_id and a linked invoice's facts out of the client's hands", async () => {
    const contact = await newContact();
    const deal = await newDeal(stages.lead, contact);
    await asUser(owner);
    const local = await one<{ id: string; fakturoid_id: string | null }>(
      `insert into invoices (user_id, number, amount, fakturoid_id) values ($1, 'X-1', 100, 999) returning id, fakturoid_id`,
      [owner],
    );
    expect(local.fakturoid_id).toBeNull();
    await db.query(`update invoices set fakturoid_id = 998, status = 'sent' where id = $1`, [
      local.id,
    ]);
    expect(
      await one(`select fakturoid_id, status::text from invoices where id = $1`, [local.id]),
    ).toEqual({ fakturoid_id: null, status: "sent" });

    const linked = await mirrored(deal, contact, 5001);
    await asUser(owner);
    await db.query(
      `update invoices set status = 'paid', amount = 1, number = 'fake', fakturoid_id = null, customer_name = 'Renamed' where id = $1`,
      [linked],
    );
    expect(
      await one(
        `select status::text, amount::text, number, fakturoid_id::text, customer_name from invoices where id = $1`,
        [linked],
      ),
    ).toEqual({
      status: "open",
      amount: "10000.00",
      number: "FA-5001",
      fakturoid_id: "5001",
      customer_name: "Renamed",
    });
    await expect(db.query(`select mark_invoice_paid($1)`, [linked])).rejects.toThrow(
      /invoice_managed_by_fakturoid/,
    );
    await asServer();
  });

  it("is applied only by the server", async () => {
    await asUser(owner);
    await expect(
      db.query(
        `select fakturoid_apply_invoice($1, 1, 'paid', null, null, null, current_date, true)`,
        [owner],
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      db.query(`select book_invoice_income(i, current_date) from invoices i limit 1`),
    ).rejects.toThrow(/permission denied/);
    await asServer();
  });

  it("books a Fakturoid payment on its day and moves the deal to won when asked", async () => {
    const contact = await newContact("Paid Ltd");
    const deal = await newDeal(stages.offer, contact, 10000);
    await mirrored(deal, contact, 6001, 12100);

    expect(await apply(owner, 6001, "open", null, true)).toMatchObject({
      paid_now: false,
      deal_moved: false,
    });
    expect(
      await one(
        `select status::text, due_on = current_date + 30 as due from invoices where fakturoid_id = 6001`,
      ),
    ).toEqual({ status: "open", due: true });

    expect(await apply(owner, 6001, "paid", "2026-09-20", true)).toMatchObject({
      paid_now: true,
      deal_moved: true,
    });
    const invoice = await one(
      `select status::text, paid_on::text from invoices where fakturoid_id = 6001`,
    );
    expect(invoice).toEqual({ status: "paid", paid_on: "2026-09-20" });
    expect(await one(`select stage_id from deals where id = $1`, [deal])).toEqual({
      stage_id: stages.won,
    });
    // The invoice already covers more than the deal, so winning adds nothing more.
    expect(await income(deal)).toEqual([
      { source: "invoice", amount: "12100.00", occurred_on: "2026-09-20" },
    ]);
    expect(
      await count(
        `select 1 from contact_table_entries e join contact_tables t on t.id = e.table_id
         where e.contact_id = $1 and t.system_key = 'clients'`,
        [contact],
      ),
    ).toBe(1);

    // A repeated sync changes nothing.
    expect(await apply(owner, 6001, "paid", "2026-09-21", true)).toMatchObject({ paid_now: false });
    expect(await income(deal)).toHaveLength(1);
  });

  it("leaves the deal alone without the switch, and never revives a lost deal", async () => {
    const contact = await newContact("Quiet Ltd");
    const open = await newDeal(stages.offer, contact, 3000);
    await mirrored(open, contact, 7001, 3000);
    expect(await apply(owner, 7001, "paid", null, false)).toMatchObject({ deal_moved: false });
    expect(await one(`select stage_id from deals where id = $1`, [open])).toEqual({
      stage_id: stages.offer,
    });

    const lost = await newDeal(stages.lost, contact, 3000);
    await mirrored(lost, contact, 7002, 3000);
    expect(await apply(owner, 7002, "paid", null, true)).toMatchObject({
      paid_now: true,
      deal_moved: false,
    });
    expect(await one(`select stage_id from deals where id = $1`, [lost])).toEqual({
      stage_id: stages.lost,
    });
  });

  it("ignores another user's Fakturoid id and a cancelled invoice books nothing", async () => {
    const contact = await newContact("Cancel Ltd");
    const deal = await newDeal(stages.offer, contact, 500);
    await mirrored(deal, contact, 8001, 500);
    expect(await apply(stranger, 8001, "paid", null, true)).toBeNull();
    expect(await apply(owner, 8001, "cancelled", null, true)).toMatchObject({ paid_now: false });
    expect(await one(`select status::text from invoices where fakturoid_id = 8001`)).toEqual({
      status: "cancelled",
    });
    expect(await income(deal)).toEqual([]);
  });

  it("still lets app-only invoices be marked paid by the client", async () => {
    const deal = await newDeal(stages.offer, null, 800);
    await asUser(owner);
    const invoice = await one<{ id: string }>(`select * from create_invoice_from_deal($1)`, [deal]);
    const paid = await one<{ status: string }>(`select * from mark_invoice_paid($1)`, [invoice.id]);
    expect(paid.status).toBe("paid");
    await asServer();
    expect(await income(deal)).toEqual([
      expect.objectContaining({ source: "invoice", amount: "800.00" }),
    ]);
  });
});
