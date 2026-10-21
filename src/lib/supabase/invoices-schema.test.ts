// @vitest-environment node
//
// Invoices in the database after Fakturoid was removed: an invoice once issued
// there becomes an ordinary one, the stored credentials are gone, and the
// client still never sets fakturoid_id. Runs every migration in PGlite with the
// same Supabase stubs as schema.test.ts, with data from before the removal.

import { PGlite } from "@electric-sql/pglite";
import { PGLITE_EXTENSIONS } from "./pglite-extensions";
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
async function createAuthUser(locale = "en") {
  const { id } = await one<{ id: string }>(
    `insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id`,
    [`${crypto.randomUUID()}@example.com`, JSON.stringify({ locale })],
  );
  return id;
}

const REMOVAL = "20261021120000_remove_fakturoid.sql";

let owner: string;
let stages: Record<string, string>;
let legacyDeal: string;
let legacyInvoice: string;

async function newDeal(stage: string, contact: string | null, value = 10000) {
  await asServer();
  return (
    await one<{ id: string }>(
      `insert into deals (user_id, contact_id, stage_id, title, value) values ($1, $2, $3, 'Web', $4) returning id`,
      [owner, contact, stage, value],
    )
  ).id;
}
const income = (deal: string) =>
  rows<{ source: string; amount: string }>(
    `select source, amount::text from transactions where deal_id = $1 order by source`,
    [deal],
  );

beforeAll(async () => {
  db = new PGlite({ extensions: PGLITE_EXTENSIONS });
  await db.exec(SUPABASE_STUBS);
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const run = (list: string[]) =>
    list.reduce(
      (done, file) =>
        done.then(() => db.exec(readFileSync(path.join(MIGRATIONS_DIR, file), "utf8"))),
      Promise.resolve() as Promise<unknown>,
    );
  await run(files.filter((f) => f < REMOVAL));

  owner = await createAuthUser("cs");
  stages = Object.fromEntries(
    (
      await rows<{ system_key: string; id: string }>(
        `select system_key, id from pipeline_stages where user_id = $1`,
        [owner],
      )
    ).map((r) => [r.system_key, r.id]),
  );
  // What a Fakturoid user had before the removal: a connection and a mirrored invoice.
  await asServer();
  await db.query(
    `insert into fakturoid_connections (user_id, account_slug, encrypted_credentials) values ($1, 'acme', 'v1:x:y:z')`,
    [owner],
  );
  legacyDeal = await newDeal(stages.offer, null, 5000);
  legacyInvoice = (
    await one<{ id: string }>(
      `insert into invoices (user_id, number, amount, status, issued_on, due_on, deal_id, fakturoid_id)
       values ($1, 'FA-5001', 5000, 'open', current_date, current_date + 14, $2, 5001) returning id`,
      [owner, legacyDeal],
    )
  ).id;

  await run(files.filter((f) => f >= REMOVAL));
});

afterAll(async () => {
  await db?.close();
});

describe("after removing Fakturoid", () => {
  it("deletes the stored credentials", async () => {
    await asServer();
    expect(await count(`select 1 from fakturoid_connections`)).toBe(0);
  });

  it("turns an invoice issued there into an ordinary one the client can pay", async () => {
    await asServer();
    expect(
      await one(`select fakturoid_id from invoices where id = $1`, [legacyInvoice]),
    ).toEqual({ fakturoid_id: null });
    await asUser(owner);
    await db.query(`update invoices set customer_name = 'Acme', due_on = current_date + 30 where id = $1`, [
      legacyInvoice,
    ]);
    const paid = await one<{ status: string }>(`select * from mark_invoice_paid($1)`, [
      legacyInvoice,
    ]);
    expect(paid.status).toBe("paid");
    await asServer();
    expect(await income(legacyDeal)).toEqual([{ source: "invoice", amount: "5000.00" }]);
  });

  it("never lets the client set fakturoid_id", async () => {
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
    await asServer();
  });

  it("issues an invoice from a deal and books its income when paid", async () => {
    const deal = await newDeal(stages.offer, null, 800);
    await asUser(owner);
    const invoice = await one<{ id: string }>(`select * from create_invoice_from_deal($1)`, [deal]);
    const again = await one<{ id: string }>(`select * from create_invoice_from_deal($1)`, [deal]);
    expect(again.id).toBe(invoice.id);
    const paid = await one<{ status: string }>(`select * from mark_invoice_paid($1)`, [invoice.id]);
    expect(paid.status).toBe("paid");
    await asServer();
    expect(await income(deal)).toEqual([{ source: "invoice", amount: "800.00" }]);
  });

  it("drops the Fakturoid events from the catalog", async () => {
    await asServer();
    expect(
      await count(`select 1 from analytics_event_catalog where event like 'fakturoid_%'`),
    ).toBe(0);
  });
});
