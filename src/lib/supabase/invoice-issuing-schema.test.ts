// @vitest-environment node
//
// Issuing invoices (16.3): the supplier profile and its RLS, the numbering
// series (no gaps, no repeats, also when an issue rolls back), drafts written
// by the client with totals from the database, issued invoices that never
// change, credit notes, payment, the PDF bucket and the deal's prefilled
// draft. Runs every migration in PGlite with the same Supabase stubs as
// schema.test.ts.

import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { computeInvoiceTotals } from "@/features/invoices/totals";
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
type Invoice = {
  id: string;
  number: string | null;
  status: string;
  kind: string;
  amount: string;
  total: string;
  subtotal: string;
  vat_total: string;
  rounding: string;
  variable_symbol: string | null;
  style: string | null;
  qr_enabled: boolean;
  supplier: Record<string, unknown> | null;
  customer: Record<string, unknown>;
  items: { name: string; unit_price: number; quantity: number }[];
  due_on: string | null;
  issued_on: string | null;
  credited_invoice_id: string | null;
};

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
async function createAuthUser() {
  const { id } = await one<{ id: string }>(
    `insert into auth.users (email) values ($1) returning id`,
    [`${crypto.randomUUID()}@example.com`],
  );
  return id;
}

let owner: string;
let worker: string;
let workerId: string;
let stranger: string;
let year: string;

async function grantFinance(level: "view" | "edit" | null) {
  await asServer();
  await db.query(`delete from worker_permissions where worker_id = $1`, [workerId]);
  if (level) {
    await db.query(
      `insert into worker_permissions (owner_id, worker_id, section, can_view, can_edit)
       values ($1, $2, 'finance', true, $3)`,
      [owner, workerId, level === "edit"],
    );
  }
}

const item = (name: string, quantity: number, unit_price: number, vat_rate = 0) => ({
  id: crypto.randomUUID(),
  name,
  quantity,
  unit: "ks",
  unit_price,
  vat_rate,
});

/** A draft written by the client, as the editor saves it. */
async function draft(
  items: ReturnType<typeof item>[] = [item("Web", 1, 10000)],
  extra: Record<string, unknown> = {},
) {
  return one<Invoice>(
    `insert into invoices (user_id, number, amount, currency, customer, items, vat_mode, status, issued_on, due_on, note)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning *`,
    [
      owner,
      extra.number ?? null,
      extra.amount ?? 0,
      extra.currency ?? "CZK",
      JSON.stringify(extra.customer ?? { name: "Acme s.r.o.", company_reg_no: "25596641" }),
      JSON.stringify(items),
      extra.vat_mode ?? "none",
      extra.status ?? "draft",
      extra.issued_on ?? null,
      extra.due_on ?? null,
      extra.note ?? null,
    ],
  );
}

const issue = (id: string) => one<Invoice>(`select * from issue_invoice($1)`, [id]);

beforeAll(async () => {
  db = new PGlite({ extensions: PGLITE_EXTENSIONS });
  await db.exec(SUPABASE_STUBS);
  for (const file of readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    await db.exec(readFileSync(path.join(MIGRATIONS_DIR, file), "utf8"));
  }
  owner = await createAuthUser();
  worker = await createAuthUser();
  stranger = await createAuthUser();
  workerId = (
    await one<{ id: string }>(
      `insert into workers (owner_id, user_id, name, status) values ($1, $2, 'Caller', 'active') returning id`,
      [owner, worker],
    )
  ).id;
  await db.query(`update user_settings set country_code = 'CZ' where user_id = $1`, [owner]);
  year = (await one<{ y: string }>(`select extract(year from user_today($1))::text as y`, [owner]))
    .y;
});

afterAll(async () => {
  await db?.close();
});

describe("supplier profile", () => {
  it("is written by the owner only and read by a worker with finance", async () => {
    await asUser(owner);
    await expect(issue((await draft()).id)).rejects.toThrow(/invoice_profile_required/);
    await db.query(
      `insert into invoice_profiles (user_id, name, company_reg_no, street, city, postal_code, account_number, bank_code, accent_color)
       values ($1, 'Jan Novák', '00006947', 'Dlouhá 1', 'Praha', '110 00', '19-2000145399', '0800', '#aabbcc')`,
      [owner],
    );
    expect(
      (await one<{ accent_color: string }>(`select accent_color from invoice_profiles`)).accent_color,
    ).toBe("#AABBCC");

    await grantFinance(null);
    await asUser(worker);
    expect(await count(`select 1 from invoice_profiles where user_id = '${owner}'`)).toBe(0);
    await grantFinance("view");
    await asUser(worker);
    expect(await count(`select 1 from invoice_profiles where user_id = '${owner}'`)).toBe(1);
    await grantFinance("edit");
    await asUser(worker);
    // Even with the right to edit finance: the supplier stays the owner's to change.
    await db.query(`update invoice_profiles set name = 'Hacked' where user_id = $1`, [owner]);
    await expect(
      db.query(`insert into invoice_profiles (user_id, name) values ($1, 'Second')`, [owner]),
    ).rejects.toThrow(/row-level security/);
    await asUser(owner);
    expect((await one<{ name: string }>(`select name from invoice_profiles`)).name).toBe(
      "Jan Novák",
    );
    await expect(db.query(`delete from invoice_profiles where user_id = $1`, [owner])).rejects.toThrow(
      /permission denied/,
    );
    await asUser(stranger);
    expect(await count(`select 1 from invoice_profiles`)).toBe(0);
  });

  it("needs a VAT number from a VAT payer", async () => {
    await asUser(owner);
    await expect(
      db.query(`update invoice_profiles set vat_payer = true where user_id = $1`, [owner]),
    ).rejects.toThrow(/invoice_profiles_vat_no_required/);
  });
});

describe("drafts", () => {
  it("take their totals from the database, never from the client", async () => {
    await asUser(owner);
    const row = await draft([item("A", 2, 1250.3), item("B", 1, 99.9)], {
      amount: 1,
      number: "2026-9999",
      status: "paid",
    });
    expect(row).toMatchObject({
      status: "draft",
      number: null,
      kind: "invoice",
      subtotal: "2600.50",
      total: "2601.00",
      rounding: "0.50",
      amount: "2601.00",
    });
    await expect(
      db.query(`update invoices set status = 'open', number = 'X-1' where id = $1 returning status`, [
        row.id,
      ]),
    ).resolves.toMatchObject({ rows: [{ status: "draft" }] });
    await expect(
      db.query(`update invoices set pdf_path = 'x', supplier = '{}' where id = $1 returning pdf_path`, [
        row.id,
      ]),
    ).resolves.toMatchObject({ rows: [{ pdf_path: null }] });
    await expect(
      draft([{ ...item("Bad", 1, 1), quantity: "x" } as never]),
    ).rejects.toThrow(/invoice_items_invalid/);
    await expect(draft([item("Bad", 1, 1.234)])).rejects.toThrow(/invoice_items_invalid/);
  });

  it("compute the same totals as the editor", async () => {
    await asUser(owner);
    const cases: { items: ReturnType<typeof item>[]; vat: "none" | "vat"; currency: string }[] = [
      { items: [item("a", 1, 0.05, 21), item("b", 1, 0.05, 21), item("c", 3, 100, 12)], vat: "vat", currency: "CZK" },
      { items: [item("a", 0.333, 3), item("b", 1.5, 10.01)], vat: "none", currency: "EUR" },
      { items: [item("a", 1, 12.5, 21), item("b", 2.5, 999.99, 19.5)], vat: "vat", currency: "EUR" },
      { items: [item("a", 7, 1234.56, 21), item("b", 1, -500, 21)], vat: "vat", currency: "CZK" },
    ];
    for (const sample of cases) {
      const row = await draft(sample.items, { vat_mode: sample.vat, currency: sample.currency });
      const expected = computeInvoiceTotals(sample.items, sample.vat, sample.currency);
      expect(Number(row.subtotal)).toBe(expected.subtotal);
      expect(Number(row.vat_total)).toBe(expected.vatTotal);
      expect(Number(row.rounding)).toBe(expected.rounding);
      expect(Number(row.total)).toBe(expected.total);
    }
  });
});

describe("numbering series", () => {
  it("numbers in issue order without gaps, freezing the supplier and the style", async () => {
    await asUser(owner);
    const first = await issue((await draft()).id);
    expect(first).toMatchObject({
      status: "open",
      number: `${year}-0001`,
      variable_symbol: `${year}0001`,
      style: "clean",
      qr_enabled: true,
      amount: "10000.00",
    });
    expect(first.supplier).toMatchObject({ name: "Jan Novák", account_number: "19-2000145399" });
    // Issuing again returns the same invoice and keeps the number.
    expect((await issue(first.id)).number).toBe(`${year}-0001`);

    await db.query(`update invoice_profiles set style = 'block', name = 'Jan Novák ml.' where user_id = $1`, [owner]);
    const after = await one<Invoice>(`select * from invoices where id = $1`, [first.id]);
    expect(after.style).toBe("clean");
    expect(after.supplier).toMatchObject({ name: "Jan Novák" });

    // Several at once: the counter row makes them wait for each other.
    const drafts = await Promise.all([draft(), draft(), draft(), draft()]);
    const numbers = (await Promise.all(drafts.map((d) => issue(d.id)))).map((i) => i.number);
    expect([...numbers].sort()).toEqual([
      `${year}-0002`,
      `${year}-0003`,
      `${year}-0004`,
      `${year}-0005`,
    ]);
  });

  it("gives a rolled back number to the next invoice", async () => {
    await asUser(owner);
    const lost = await draft();
    const next = await draft();
    await db.exec("begin");
    expect((await issue(lost.id)).number).toBe(`${year}-0006`);
    await db.exec("rollback");
    expect((await issue(next.id)).number).toBe(`${year}-0006`);
    expect((await one<Invoice>(`select * from invoices where id = $1`, [lost.id])).status).toBe(
      "draft",
    );
  });

  it("refuses a draft without a customer, without items or with a due day before the issue", async () => {
    await asUser(owner);
    await expect(issue((await draft(undefined, { customer: {} })).id)).rejects.toThrow(
      /invoice_customer_required/,
    );
    await expect(issue((await draft([])).id)).rejects.toThrow(/invoice_items_required/);
    await expect(issue((await draft([item("", 1, 100)])).id)).rejects.toThrow(
      /invoice_items_required/,
    );
    await expect(issue((await draft([item("Refund", 1, -100)])).id)).rejects.toThrow(
      /invoice_total_invalid/,
    );
    await expect(
      issue((await draft(undefined, { issued_on: "2026-10-10", due_on: "2026-10-01" })).id),
    ).rejects.toThrow(/invoice_due_before_issue/);
    // None of the failures used up a number.
    expect((await issue((await draft()).id)).number).toBe(`${year}-0007`);
  });

  it("uses the prefix and leaves QR off for another currency", async () => {
    await asUser(owner);
    await db.query(`update invoice_profiles set number_prefix = 'FV' where user_id = $1`, [owner]);
    const eur = await issue((await draft(undefined, { currency: "EUR" })).id);
    expect(eur).toMatchObject({ number: `FV${year}-0008`, qr_enabled: false });
    await db.query(`update invoice_profiles set number_prefix = '' where user_id = $1`, [owner]);
  });
});

describe("issued invoices", () => {
  it("never change or go away from the client side", async () => {
    await asUser(owner);
    const issued = await issue((await draft()).id);
    await expect(
      db.query(`update invoices set note = 'changed' where id = $1`, [issued.id]),
    ).rejects.toThrow(/invoice_issued/);
    await expect(db.query(`delete from invoices where id = $1`, [issued.id])).rejects.toThrow(
      /invoice_issued/,
    );
    const removable = await draft();
    await db.query(`delete from invoices where id = $1`, [removable.id]);
    expect(await count(`select 1 from invoices where id = '${removable.id}'`)).toBe(0);
  });

  it("are cancelled by a credit note with the next number and negative totals", async () => {
    await asUser(owner);
    const issued = await issue((await draft([item("Web", 2, 1250.3, 21)])).id);
    const credit = await one<Invoice>(`select * from cancel_invoice($1)`, [issued.id]);
    const original = await one<Invoice>(`select * from invoices where id = $1`, [issued.id]);
    expect(original.status).toBe("cancelled");
    expect(credit).toMatchObject({
      kind: "credit_note",
      status: "cancelled",
      credited_invoice_id: issued.id,
      total: `-${issued.total}`,
      amount: `-${issued.amount}`,
    });
    const [base, suffix] = (issued.number ?? "").split("-");
    expect(credit.number).toBe(`${base}-${String(Number(suffix) + 1).padStart(4, "0")}`);
    expect(credit.items[0].unit_price).toBe(-1250.3);
    await expect(db.query(`select cancel_invoice($1)`, [issued.id])).rejects.toThrow(
      /invoice_not_cancellable/,
    );
    await expect(db.query(`select mark_invoice_paid($1)`, [credit.id])).rejects.toThrow(
      /invoice_not_payable/,
    );
  });

  it("are paid today with the income booked once, and a paid one is not cancelled", async () => {
    await asUser(owner);
    const issued = await issue((await draft([item("Logo", 1, 4000)])).id);
    await expect(db.query(`select mark_invoice_paid($1)`, [(await draft()).id])).rejects.toThrow(
      /invoice_not_payable/,
    );
    await db.query(`select mark_invoice_paid($1)`, [issued.id]);
    await db.query(`select mark_invoice_paid($1)`, [issued.id]);
    expect(
      await rows(`select amount::text, source from transactions where invoice_id = $1`, [issued.id]),
    ).toEqual([{ amount: "4000.00", source: "invoice" }]);
    await expect(db.query(`select cancel_invoice($1)`, [issued.id])).rejects.toThrow(
      /invoice_not_cancellable/,
    );
  });

  it("are issued by a worker only with the right to edit finance", async () => {
    await asUser(owner);
    const own = await draft();
    await grantFinance("view");
    await asUser(worker);
    await expect(issue(own.id)).rejects.toThrow(/section_access_denied/);
    await grantFinance("edit");
    await asUser(worker);
    expect((await issue(own.id)).status).toBe("open");
    await grantFinance(null);
    await asUser(worker);
    expect(await count(`select 1 from invoices where user_id = '${owner}'`)).toBe(0);
    await expect(db.query(`select cancel_invoice($1)`, [own.id])).rejects.toThrow(
      /section_access_denied/,
    );
  });

  it("have their counter out of the client's reach", async () => {
    await asUser(owner);
    await expect(db.query(`select * from invoice_counters`)).rejects.toThrow(/permission denied/);
    await expect(
      db.query(`select next_invoice_number($1, current_date)`, [owner]),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("PDF bucket", () => {
  it("lets the workspace and a worker with finance read, nobody write", async () => {
    await asServer();
    const name = `${owner}/${crypto.randomUUID()}.pdf`;
    await db.query(`insert into storage.objects (bucket_id, name) values ('invoices', $1)`, [name]);
    const visible = () => count(`select 1 from storage.objects where name = '${name}'`);

    await asUser(owner);
    expect(await visible()).toBe(1);
    await expect(
      db.query(`insert into storage.objects (bucket_id, name) values ('invoices', $1)`, [
        `${owner}/forged.pdf`,
      ]),
    ).rejects.toThrow(/row-level security/);
    await grantFinance(null);
    await asUser(worker);
    expect(await visible()).toBe(0);
    await grantFinance("view");
    await asUser(worker);
    expect(await visible()).toBe(1);
    await asUser(stranger);
    expect(await visible()).toBe(0);
    await asServer();
  });
});

describe("from a deal", () => {
  it("makes one prefilled draft with the contact and the deal's value", async () => {
    await asUser(owner);
    const contact = await one<{ id: string }>(
      `insert into contacts (user_id, company_name, email, address, city, postal_code, company_reg_no)
       values ($1, 'Kůň s.r.o.', 'kun@example.com', 'Krátká 2', 'Brno', '602 00', '25596641') returning id`,
      [owner],
    );
    const stage = await one<{ id: string }>(
      `select id from pipeline_stages where user_id = $1 and system_key = 'lead'`,
      [owner],
    );
    const deal = await one<{ id: string }>(
      `insert into deals (user_id, contact_id, stage_id, title, value) values ($1, $2, $3, 'E-shop', 48000) returning id`,
      [owner, contact.id, stage.id],
    );
    const made = await one<Invoice>(`select * from create_invoice_from_deal($1)`, [deal.id]);
    expect(made).toMatchObject({ status: "draft", number: null, total: "48000.00" });
    expect(made.customer).toEqual({
      name: "Kůň s.r.o.",
      company_reg_no: "25596641",
      street: "Krátká 2",
      city: "Brno",
      postal_code: "602 00",
      email: "kun@example.com",
    });
    expect(made.items).toMatchObject([{ name: "E-shop", quantity: 1, unit_price: 48000 }]);
    expect((await one<Invoice>(`select * from create_invoice_from_deal($1)`, [deal.id])).id).toBe(
      made.id,
    );
  });
});
