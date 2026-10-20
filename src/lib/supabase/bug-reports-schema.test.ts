// @vitest-environment node
//
// Bug reports in the database (step 15.2): the author reads only their own
// rows and nobody writes the table from the browser; the server writes through
// bug_report_submit(), which keeps one report per error code and limits the
// reports of an account and the anonymous reports of an address per hour;
// admin_bug_reports() lists them (internal accounts only when asked or when
// searching by code). Runs every migration in PGlite with the same Supabase
// stubs as schema.test.ts.

import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
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

let db: PGlite;

async function rows<T = Record<string, unknown>>(sql: string, params?: unknown[]) {
  return (await db.query<T>(sql, params as never)).rows;
}
async function one<T = Record<string, unknown>>(sql: string, params?: unknown[]) {
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
async function asService() {
  await db.exec(`select set_config('request.jwt.claim.sub', '', false); set role service_role;`);
}
async function asServer() {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
}
async function createUser() {
  const { id } = await one<{ id: string }>(
    `insert into auth.users (email, raw_user_meta_data) values ($1, '{}') returning id`,
    [`${crypto.randomUUID()}@example.com`],
  );
  return id;
}

let counter = 0;
/** A fresh valid error code: GR- and six characters. */
function code() {
  counter += 1;
  return `GR-${counter.toString(36).toUpperCase().padStart(6, "A")}`;
}
function ipHash() {
  return crypto.randomUUID().replaceAll("-", "").slice(0, 16);
}

async function submit(
  userId: string | null,
  ip: string,
  errorCode: string | null,
  description: string | null = null,
) {
  const { result } = await one<{ result: string }>(
    `select public.bug_report_submit(
       _user_id => $1, _ip_hash => $2, _source => 'error_page', _page => '/app/kontakty/:id',
       _error_code => $3, _description => $4, _error_message => 'Error: boom', _error_digest => '123',
       _browser => 'chrome', _device => 'desktop', _viewport => '1440x900', _locale => 'cs',
       _app_version => 'abc1234', _limit_user => 3, _limit_anonymous => 2) as result`,
    [userId, ip, errorCode, description],
  );
  return result;
}

beforeAll(async () => {
  db = new PGlite({ extensions: PGLITE_EXTENSIONS });
  await db.exec(SUPABASE_STUBS);
  for (const file of readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    await db.exec(readFileSync(path.join(MIGRATIONS_DIR, file), "utf8"));
  }
});

describe("bug_reports", () => {
  it("lets the author read their own reports and nobody write from the browser", async () => {
    await asServer();
    const author = await createUser();
    const other = await createUser();
    const errorCode = code();
    await asService();
    expect(await submit(author, ipHash(), errorCode, "Clicked save")).toBe("created");

    await asUser(author);
    const own = await rows(`select error_code, description from bug_reports`);
    expect(own).toEqual([{ error_code: errorCode, description: "Clicked save" }]);
    // No insert, update or delete for the client, not even on their own row.
    await expect(
      db.query(`insert into bug_reports (user_id, source, page) values ($1, 'report', '/app')`, [
        author,
      ]),
    ).rejects.toThrow();
    await expect(
      db.query(`update bug_reports set status = 'fixed' where error_code = $1`, [errorCode]),
    ).rejects.toThrow();
    await expect(
      db.query(`delete from bug_reports where error_code = $1`, [errorCode]),
    ).rejects.toThrow();

    await asUser(other);
    expect(await rows(`select id from bug_reports where error_code = $1`, [errorCode])).toEqual([]);

    await asAnon();
    await expect(db.query(`select id from bug_reports`)).rejects.toThrow();
    await asServer();
  });

  it("keeps the browser away from the server's functions", async () => {
    await asServer();
    const user = await createUser();
    await asUser(user);
    await expect(submit(user, ipHash(), code())).rejects.toThrow();
    await expect(db.query(`select * from admin_bug_reports()`)).rejects.toThrow();
    await asAnon();
    await expect(submit(null, ipHash(), code())).rejects.toThrow();
    await asServer();
  });

  it("stores one report per error code; the second one writes nothing", async () => {
    await asServer();
    const user = await createUser();
    const errorCode = code();
    await asService();
    expect(await submit(user, ipHash(), errorCode, "first")).toBe("created");
    expect(await submit(user, ipHash(), errorCode, "second")).toBe("duplicate");
    expect(await submit(null, ipHash(), errorCode)).toBe("duplicate");
    await asServer();
    expect(
      await rows(`select description from bug_reports where error_code = $1`, [errorCode]),
    ).toEqual([{ description: "first" }]);
  });

  it("limits an account per hour, and anonymous reports per address", async () => {
    await asServer();
    const user = await createUser();
    const ip = ipHash();
    await asService();
    expect(await submit(user, ip, code())).toBe("created");
    expect(await submit(user, ip, code())).toBe("created");
    expect(await submit(user, ip, code())).toBe("created");
    expect(await submit(user, ip, code())).toBe("limited");

    // Anonymous from the same address is counted separately; another address is free.
    expect(await submit(null, ip, code())).toBe("created");
    expect(await submit(null, ip, code())).toBe("created");
    expect(await submit(null, ip, code())).toBe("limited");
    expect(await submit(null, ipHash(), code())).toBe("created");

    // An hour later the account may report again.
    await asServer();
    await db.query(
      `update bug_reports set created_at = now() - interval '61 minutes' where user_id = $1`,
      [user],
    );
    await asService();
    expect(await submit(user, ip, code())).toBe("created");
    await asServer();
  });

  it("refuses a malformed code, page or browser", async () => {
    await asServer();
    await asService();
    await expect(submit(null, ipHash(), "GR-abc")).rejects.toThrow();
    await expect(
      db.query(
        `select public.bug_report_submit(_user_id => null, _ip_hash => $1, _source => 'error_page', _page => '')`,
        [ipHash()],
      ),
    ).rejects.toThrow();
    await expect(
      db.query(
        `select public.bug_report_submit(_user_id => null, _ip_hash => $1, _source => 'elsewhere', _page => '/')`,
        [ipHash()],
      ),
    ).rejects.toThrow();
    await asServer();
  });

  it("lists reports for the administration and finds one by its code", async () => {
    await asServer();
    const internal = await createUser();
    const regular = await createUser();
    await db.query(`update profiles set is_internal = true where id = $1`, [internal]);
    const internalCode = code();
    const regularCode = code();
    await asService();
    expect(await submit(internal, ipHash(), internalCode)).toBe("created");
    expect(await submit(regular, ipHash(), regularCode)).toBe("created");

    const listed = (
      await rows<{ error_code: string }>(`select error_code from admin_bug_reports()`)
    ).map((row) => row.error_code);
    expect(listed).toContain(regularCode);
    expect(listed).not.toContain(internalCode);
    const withInternal = (
      await rows<{ error_code: string }>(
        `select error_code from admin_bug_reports(_include_internal => true)`,
      )
    ).map((row) => row.error_code);
    expect(withInternal).toContain(internalCode);

    // The code finds the report, internal or not; its beginning too.
    expect(
      await rows(`select error_code, page, browser from admin_bug_reports(_code => $1)`, [
        internalCode,
      ]),
    ).toEqual([{ error_code: internalCode, page: "/app/kontakty/:id", browser: "chrome" }]);
    expect(
      (
        await rows(`select error_code from admin_bug_reports(_code => $1)`, [
          internalCode.slice(0, 7),
        ])
      ).length,
    ).toBeGreaterThan(0);
    // Anything that is not a code finds nothing (and never acts as a wildcard).
    expect(await rows(`select id from admin_bug_reports(_code => '%')`)).toEqual([]);
    expect(await rows(`select id from admin_bug_reports(_code => 'GR-%')`)).toEqual([]);
    await asServer();
  });

  it("removes an account's reports with the account", async () => {
    await asServer();
    const user = await createUser();
    const errorCode = code();
    await asService();
    expect(await submit(user, ipHash(), errorCode)).toBe("created");
    await asServer();
    await db.query(`delete from auth.users where id = $1`, [user]);
    expect(await rows(`select id from bug_reports where error_code = $1`, [errorCode])).toEqual([]);
  });
});
