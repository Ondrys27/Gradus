// @vitest-environment node
//
// Global search (⌘K) in the real migrations on an in-process Postgres (PGlite):
// accent-free and typo-tolerant matching, phone parts, row level security.

import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { searchParams } from "@/features/search/search-logic";
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

type Hit = { kind: string; id: string; title: string; rank: number; data: Record<string, unknown> };

let db: PGlite;
let owner: string;
let stranger: string;

async function one<T>(sql: string, params?: unknown[]): Promise<T> {
  return (await db.query<T>(sql, params as never)).rows[0] as T;
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
    `insert into auth.users (email, raw_user_meta_data) values ($1, '{"locale":"cs"}') returning id`,
    [`${crypto.randomUUID()}@example.com`],
  );
  return id;
}

/** Runs the search the way the app does: the query goes through searchParams(). */
async function search(uid: string, query: string, kinds: string[] | null = null) {
  await asUser(uid);
  const p = searchParams(query, kinds ?? undefined);
  const result = await db.query<Hit>(`select * from global_search($1, $2, $3, $4, $5)`, [
    p._query,
    p._phone_patterns,
    p._amount,
    p._kinds,
    p._limit,
  ] as never);
  await asServer();
  return result.rows;
}

beforeAll(async () => {
  db = new PGlite({ extensions: PGLITE_EXTENSIONS });
  await db.exec(SUPABASE_STUBS);
  for (const file of readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    await db.exec(readFileSync(path.join(MIGRATIONS_DIR, file), "utf8"));
  }
  owner = await createAuthUser();
  stranger = await createAuthUser();

  await db.query(
    `insert into contacts (user_id, first_name, last_name, company_name, email, phone)
     values ($1, 'Jan', 'Novák', null, 'jan@example.com', '+420777123456'),
            ($1, null, null, 'Kavárna Šťastná', 'info@kavarna.cz', '+420602999111'),
            ($2, 'Petr', 'Novák', null, null, '+420777123999')`,
    [owner, stranger],
  );
  await db.query(
    `insert into deals (user_id, stage_id, contact_id, title, value)
     select $1, s.id, c.id, 'Nový web', 150000 from pipeline_stages s, contacts c
     where s.user_id = $1 and s.system_key = 'lead' and c.user_id = $1 and c.last_name = 'Novák'`,
    [owner],
  );
  const { id: milestone } = await one<{ id: string }>(
    `insert into milestones (user_id, title, description) values ($1, 'Spuštění e-shopu', 'Prodej přes internet') returning id`,
    [owner],
  );
  await db.query(
    `insert into tasks (user_id, milestone_id, title) values ($1, $2, 'Zaregistrovat doménu')`,
    [owner, milestone],
  );
  await db.query(
    `insert into calendar_events (user_id, title, starts_at) values ($1, 'Schůzka s účetní', now())`,
    [owner],
  );
  await db.query(
    `insert into transactions (user_id, type, amount, description, occurred_on)
     values ($1, 'expense', 1200, 'Předplatné účetnictví', current_date)`,
    [owner],
  );
  await db.query(
    `insert into invoices (user_id, number, amount, customer_name) values ($1, '2026-0042', 30000, 'Žluťoučký kůň s.r.o.')`,
    [owner],
  );
  await db.query(
    `insert into workers (owner_id, name, job_title) values ($1, 'Eliška Dvořáková', 'Obchodnice')`,
    [owner],
  );
});

afterAll(async () => {
  await db?.close();
});

describe("global_search", () => {
  it("ignores diacritics and letter case", async () => {
    const hits = await search(owner, "NOVAK");
    expect(hits.filter((h) => h.kind === "contact").map((h) => h.title)).toEqual(["Jan Novák"]);
    expect((await search(owner, "kavarna stastna")).map((h) => h.title)).toContain(
      "Kavárna Šťastná",
    );
  });

  it("tolerates a typo and finds parts of words", async () => {
    expect((await search(owner, "novka")).map((h) => h.title)).toContain("Jan Novák");
    expect((await search(owner, "kavar")).map((h) => h.title)).toContain("Kavárna Šťastná");
  });

  it("finds a contact by a part of the phone number, with or without spaces", async () => {
    for (const query of ["777 123", "777123456", "+420 777 123 456", "602 999"]) {
      const titles = (await search(owner, query)).filter((h) => h.kind === "contact");
      expect(titles.length, query).toBe(1);
    }
    expect((await search(owner, "777 123"))[0].title).toBe("Jan Novák");
  });

  it("never returns another user's rows", async () => {
    const hits = await search(owner, "novak");
    expect(hits.some((h) => h.title === "Petr Novák")).toBe(false);
    expect(await search(stranger, "kavarna")).toEqual([]);
    expect(await search(stranger, "eliska")).toEqual([]);
  });

  it("finds ids with the indexes only among the caller's own rows", async () => {
    await asUser(stranger);
    const own = await db.query<{ id: string }>(
      `select id from search_matches('contact', 'novak', '{}', null, 50)`,
    );
    const everything = await db.query<{ id: string }>(
      `select id from search_matches('contact', '', array['%%'], null, 50)`,
    );
    await asServer();
    const { id: petr } = await one<{ id: string }>(`select id from contacts where user_id = $1`, [
      stranger,
    ]);
    expect(own.rows.map((r) => r.id)).toEqual([petr]);
    expect(everything.rows.map((r) => r.id)).toEqual([petr]);
  });

  it("returns nothing without a signed-in user", async () => {
    await db.exec(`select set_config('request.jwt.claim.sub', '', false); set role authenticated;`);
    const hits = await db.query(`select * from global_search('novak')`);
    const ids = await db.query(`select * from search_matches('contact', 'novak', '{}', null, 50)`);
    await asServer();
    expect(hits.rows).toEqual([]);
    expect(ids.rows).toEqual([]);
  });

  it("finds deals by title, contact and amount, with stage context", async () => {
    const byTitle = await search(owner, "novy web");
    const deal = byTitle.find((h) => h.kind === "deal");
    expect(deal?.data.value).toBe(150000);
    expect(typeof deal?.data.stage).toBe("string");
    expect((await search(owner, "jan novak")).some((h) => h.kind === "deal")).toBe(true);
    expect((await search(owner, "150000")).some((h) => h.kind === "deal")).toBe(true);
  });

  it("searches milestones, tasks, events, finance and workers", async () => {
    const kinds = async (q: string) => (await search(owner, q)).map((h) => `${h.kind}:${h.title}`);
    expect(await kinds("spusteni e-shop")).toContain("milestone:Spuštění e-shopu");
    expect(await kinds("domenu")).toContain("task:Zaregistrovat doménu");
    const task = (await search(owner, "domenu")).find((h) => h.kind === "task");
    expect(task?.data.milestone).toBe("Spuštění e-shopu");
    expect(await kinds("ucetni")).toContain("event:Schůzka s účetní");
    expect(await kinds("ucetnictvi")).toContain("transaction:Předplatné účetnictví");
    expect(await kinds("0042")).toContain("invoice:2026-0042");
    expect(await kinds("zlutoucky")).toContain("invoice:2026-0042");
    expect(await kinds("obchodnice")).toContain("worker:Eliška Dvořáková");
  });

  it("ranks the best match first and limits each kind", async () => {
    await db.query(
      `insert into contacts (user_id, company_name) select $1, 'Firma ' || g from generate_series(1, 20) g`,
      [owner],
    );
    await db.query(`insert into contacts (user_id, company_name) values ($1, 'Firma')`, [owner]);
    const hits = (await search(owner, "firma")).filter((h) => h.kind === "contact");
    expect(hits).toHaveLength(6);
    expect(hits[0].title).toBe("Firma");
    const all = await search(owner, "firma", ["contact"]);
    expect(all.length).toBe(21);
  });

  it("keeps recent searches to eight", async () => {
    await asUser(owner);
    await db.query(`update user_settings set recent_searches = $1 where user_id = $2`, [
      ["a", "b", "c", "d", "e", "f", "g", "h"],
      owner,
    ] as never);
    await expect(
      db.query(`update user_settings set recent_searches = $1 where user_id = $2`, [
        ["a", "b", "c", "d", "e", "f", "g", "h", "i"],
        owner,
      ] as never),
    ).rejects.toThrow(/recent_searches/);
    await asServer();
  });
});
