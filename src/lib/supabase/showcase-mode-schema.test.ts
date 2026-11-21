// @vitest-environment node
//
// The showcase mode's switch (step 27.4): 'showcase_mode' in app_settings
// changes only through admin_set_app_setting() (the owner or a full admin
// with aal2), its shape is checked and every change audited; clients never
// read app_settings. The showcase's events are in the analytics catalog.
// Runs every migration in PGlite with the same Supabase stubs as
// grady-models-schema.test.ts.

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
/** Signs in as `uid`; aal2 with a TOTP step a moment ago unless told otherwise. */
async function asUser(uid: string, aal: "aal1" | "aal2" = "aal2") {
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

const setShowcase = (value: unknown) =>
  db.query(`select public.admin_set_app_setting('showcase_mode', $1::jsonb, null) as old`, [
    JSON.stringify(value),
  ]);

let owner: string;
let user: string;

beforeAll(async () => {
  db = new PGlite({ extensions: PGLITE_EXTENSIONS });
  await db.exec(SUPABASE_STUBS);
  for (const file of readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    await db.exec(readFileSync(path.join(MIGRATIONS_DIR, file), "utf8"));
  }
  owner = await createAuthUser(); // first account = owner
  user = await createAuthUser();
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe("showcase_mode in app_settings", () => {
  it("is refused to a regular user and to the owner without the second factor", async () => {
    await asUser(user);
    await expect(setShowcase({ enabled: true })).rejects.toThrow(/admin_required/);
    await asUser(owner, "aal1");
    await expect(setShowcase({ enabled: true })).rejects.toThrow(/admin_required/);
    await asServer();
  });

  it("switches for the owner with aal2 and audits from what to what", async () => {
    await asUser(owner);
    expect((await setShowcase({ enabled: true })).rows[0]).toEqual({ old: null });
    expect((await setShowcase({ enabled: false })).rows[0]).toEqual({ old: { enabled: true } });
    await asServer();
    const audit = await rows<{ target: string; detail: Row }>(
      `select target, detail from admin_audit where target = 'settings.showcase_mode' order by id`,
    );
    expect(audit.map((row) => row.detail)).toEqual([
      { key: "showcase_mode", from: null, to: { enabled: true } },
      { key: "showcase_mode", from: { enabled: true }, to: { enabled: false } },
    ]);
  });

  it("takes exactly { enabled: boolean }", async () => {
    await asUser(owner);
    for (const bad of [{}, { enabled: "yes" }, { enabled: true, extra: 1 }, [], "on", null]) {
      await expect(setShowcase(bad), JSON.stringify(bad)).rejects.toThrow(/invalid_value/);
    }
    await asServer();
    await expect(
      db.query(
        `insert into app_settings (key, value) values ('showcase_mode', '{"enabled": 1}')
         on conflict (key) do update set value = excluded.value`,
      ),
    ).rejects.toThrow(/app_settings_showcase_mode_valid/);
  });

  it("is not readable by a signed-in client", async () => {
    await asUser(owner);
    await expect(db.query(`select value from app_settings where key = 'showcase_mode'`)).rejects.toThrow(
      /permission denied/,
    );
    await asServer();
  });

  it("has the showcase's events in the analytics catalog", async () => {
    await asServer();
    const events = await rows<{ event: string }>(
      `select event from analytics_event_catalog where event like 'showcase_%' order by event`,
    );
    expect(events.map((row) => row.event)).toEqual(["showcase_finished", "showcase_started"]);
  });
});
