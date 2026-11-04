// @vitest-environment node
//
// Jarvis's rules in the administration (step 20.1): the app_settings key
// 'jarvis_rules' is checked by valid_jarvis_rules() (the same bounds as
// storedJarvisRulesSchema), written only by the owner with aal2 through
// admin_set_app_setting() and audited from -> to; the other keys keep working.
// Runs every migration in PGlite with the same Supabase stubs as
// error-alerts-schema.test.ts.

import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_JARVIS_RULES, resolveJarvisRules, storedJarvisRulesSchema } from "@/features/jarvis/rules";
import { PGLITE_EXTENSIONS } from "./pglite-extensions";

const MIGRATIONS_DIR = path.resolve(__dirname, "../../../supabase/migrations");
const THIS_MIGRATION = "20261104200000_jarvis_rules.sql";

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
async function asAnon() {
  await asServer();
  await db.exec(`set role anon;`);
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
async function createAuthUser(email = `${crypto.randomUUID()}@example.com`) {
  await asServer();
  const { id } = await one<{ id: string }>(
    `insert into auth.users (email, raw_user_meta_data) values ($1, '{"locale":"cs"}') returning id`,
    [email],
  );
  return id;
}

const VALID = {
  suggestion_types: { insight: false, overdueTask: true },
  questions: true,
  min_gap_hours: 4,
  questions_per_week: 1,
  suggestion_fresh_days: 5,
  page_settle_seconds: 45,
  instructions: "Tykej a buď stručný.",
};

let owner: string;
let user: string;

beforeAll(async () => {
  db = new PGlite({ extensions: PGLITE_EXTENSIONS });
  await db.exec(SUPABASE_STUBS);
  for (const file of readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    // The owner exists before this step's migration, as in production.
    if (file === THIS_MIGRATION) owner = await createAuthUser();
    await db.exec(readFileSync(path.join(MIGRATIONS_DIR, file), "utf8"));
  }
  user = await createAuthUser();
}, 120_000);

afterAll(async () => {
  await db?.close();
});

async function valid(value: unknown): Promise<boolean> {
  await asServer();
  const { ok } = await one<{ ok: boolean }>(`select public.valid_jarvis_rules($1::jsonb) as ok`, [
    JSON.stringify(value),
  ]);
  return ok;
}

describe("valid_jarvis_rules", () => {
  it("accepts what the app stores, the defaults included", async () => {
    expect(storedJarvisRulesSchema.safeParse(VALID).success).toBe(true);
    expect(await valid(VALID)).toBe(true);
    expect(await valid({ ...VALID, suggestion_types: {}, instructions: "" })).toBe(true);
    expect(await valid({ ...VALID, instructions: "é".repeat(2000) })).toBe(true);
  });

  it("refuses what the app's schema refuses", async () => {
    const wrong: unknown[] = [
      null,
      [],
      { ...VALID, extra: 1 },
      Object.fromEntries(Object.entries(VALID).filter(([key]) => key !== "questions")),
      { ...VALID, suggestion_types: { dealWon: true } },
      { ...VALID, suggestion_types: { insight: "no" } },
      { ...VALID, questions: "yes" },
      { ...VALID, min_gap_hours: 1 },
      { ...VALID, min_gap_hours: 73 },
      { ...VALID, min_gap_hours: 2.5 },
      { ...VALID, questions_per_week: 8 },
      { ...VALID, suggestion_fresh_days: 0 },
      { ...VALID, page_settle_seconds: 9 },
      { ...VALID, page_settle_seconds: "30" },
      { ...VALID, instructions: "x".repeat(2001) },
      { ...VALID, instructions: 5 },
    ];
    for (const value of wrong) {
      expect(await valid(value), JSON.stringify(value)?.slice(0, 80)).toBe(false);
      expect(storedJarvisRulesSchema.safeParse(value).success).toBe(false);
    }
  });
});

describe("the jarvis_rules setting", () => {
  const save = (value: unknown) =>
    db.query(`select public.admin_set_app_setting('jarvis_rules', $1::jsonb, null) as old`, [
      JSON.stringify(value),
    ]);

  it("is written only by the owner with aal2, checked and audited from -> to", async () => {
    await asUser(user);
    await expect(save(VALID)).rejects.toThrow(/admin_required/);
    await asUser(owner, "aal1");
    await expect(save(VALID)).rejects.toThrow(/admin_required/);
    await asAnon();
    await expect(save(VALID)).rejects.toThrow();
    await asUser(owner);
    await expect(save({ ...VALID, min_gap_hours: 0 })).rejects.toThrow(/invalid_value/);
    await save(VALID);
    // The browser reads nothing, the setting is the server's.
    await expect(db.query(`select * from app_settings`)).rejects.toThrow(/permission denied/);
    const next = { ...VALID, instructions: "Vykej." };
    await save(next);

    await asServer();
    const { value } = await one<{ value: unknown }>(
      `select value from app_settings where key = 'jarvis_rules'`,
    );
    expect(value).toEqual(next);
    expect(resolveJarvisRules(value)).toMatchObject({ instructions: "Vykej.", minGapHours: 4 });
    expect(resolveJarvisRules(value)).not.toBe(DEFAULT_JARVIS_RULES);
    const audit = await one<{ detail: { key: string; from: Row; to: Row } }>(
      `select detail from admin_audit where target = 'settings.jarvis_rules' order by id desc limit 1`,
    );
    expect(audit.detail).toEqual({ key: "jarvis_rules", from: VALID, to: next });
  });

  it("cannot be stored broken even by the server", async () => {
    await asServer();
    await expect(
      db.query(`update app_settings set value = '{"questions":true}' where key = 'jarvis_rules'`),
    ).rejects.toThrow(/app_settings_jarvis_rules_valid/);
  });

  it("leaves the other keys as they were", async () => {
    await asUser(owner);
    await db.query(`select public.admin_set_app_setting('ai_caps', $1::jsonb, null)`, [
      JSON.stringify({ monthly_usd: 50, per_user_usd: null, warn_percent: 80 }),
    ]);
    await expect(
      db.query(`select public.admin_set_app_setting('nope', '{}'::jsonb, null)`),
    ).rejects.toThrow(/unknown_setting/);
  });
});
