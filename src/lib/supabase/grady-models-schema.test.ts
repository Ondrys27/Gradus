// @vitest-environment node
//
// Grady's model per job in the database (step 27.3): 'grady_models' in
// app_settings changes only through admin_set_app_setting() (the owner or a
// full admin with aal2), its shape is checked and every change audited;
// ai_usage.routed_from is server-written like the rest of the row; the
// chat's routing call does not use up the plan's answers; the economy e-mail
// has its own kind; admin_ai_model_usage() is server only. Runs every
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

const MODELS = {
  features: { chat: "auto", briefing: "opus", analysis: "sonnet" },
  economy: false,
  chat_large: null,
};
const setModels = (value: unknown) =>
  db.query(`select public.admin_set_app_setting('grady_models', $1::jsonb, null) as old`, [
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

describe("grady_models in app_settings", () => {
  it("is refused to a regular user and to the owner without the second factor", async () => {
    await asUser(user);
    await expect(setModels(MODELS)).rejects.toThrow(/admin_required/);
    await asUser(owner, "aal1");
    await expect(setModels(MODELS)).rejects.toThrow(/admin_required/);
    await asServer();
  });

  it("saves for the owner with aal2 and audits from what to what", async () => {
    await asUser(owner);
    expect((await setModels(MODELS)).rows[0]).toEqual({ old: null });
    const next = { ...MODELS, economy: true, chat_large: "opus" };
    expect((await setModels(next)).rows[0]).toEqual({ old: MODELS });
    await asServer();
    const audit = await rows<{ target: string; detail: Row }>(
      `select target, detail from admin_audit where target = 'settings.grady_models' order by id`,
    );
    expect(audit.map((row) => row.detail)).toEqual([
      { key: "grady_models", from: null, to: MODELS },
      { key: "grady_models", from: MODELS, to: next },
    ]);
  });

  it("checks only the shape: unknown models stay possible, a wrong shape does not", async () => {
    await asUser(owner);
    // A model the code no longer offers is the code's to fall back from.
    await setModels({ ...MODELS, features: { chat: "some_future_model" } });
    for (const bad of [
      { ...MODELS, extra: 1 },
      { features: {}, economy: false },
      { ...MODELS, economy: "yes" },
      { ...MODELS, chat_large: 5 },
      { ...MODELS, chat_large: "Opus!" },
      { ...MODELS, features: [] },
      { ...MODELS, features: { chat: 1 } },
      { ...MODELS, features: { "Chat Model": "haiku" } },
      { ...MODELS, features: { chat: "haiku; drop" } },
      {
        ...MODELS,
        features: Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`job_${i}`, "haiku"])),
      },
    ]) {
      await expect(setModels(bad), JSON.stringify(bad).slice(0, 80)).rejects.toThrow(/invalid_value/);
    }
    await asServer();
  });

  it("keeps the constraint even for the server", async () => {
    await asServer();
    await expect(
      db.query(
        `insert into app_settings (key, value) values ('grady_models', '{"features": 1}')
         on conflict (key) do update set value = excluded.value`,
      ),
    ).rejects.toThrow(/app_settings_grady_models_valid/);
  });
});

describe("ai_usage and the routing call", () => {
  it("keeps routed_from server-written: no client writes or reads ai_usage", async () => {
    await asServer();
    await db.query(
      `insert into ai_usage (user_id, purpose, model, routed_from, created_at)
       values ($1, 'chat', 'claude-haiku-5-5', 'claude-sonnet-5-5', '2026-09-01T00:00:00Z')`,
      [user],
    );
    await asUser(user);
    await expect(
      db.query(
        `insert into ai_usage (user_id, purpose, model, routed_from) values ($1, 'chat', 'claude-haiku-5-5', 'claude-sonnet-5-5')`,
        [user],
      ),
    ).rejects.toThrow(/permission denied|row-level security/);
    const seen = await db
      .query(`select routed_from from ai_usage`)
      .then((result) => result.rows.length)
      .catch(() => 0);
    expect(seen).toBe(0);
    await asServer();
  });

  it("leaves the routing call out of the plan's answers", async () => {
    await asServer();
    await db.query(
      `insert into ai_usage (user_id, space_id, purpose, model, routed_from, success, created_at) values
         ($1, $1, 'chat', 'claude-haiku-5-5', 'claude-sonnet-5-5', true, '2026-11-10T10:00:00Z'),
         ($1, $1, 'chat_route', 'claude-haiku-5-5', null, true, '2026-11-10T10:00:00Z'),
         ($1, $1, 'briefing', 'claude-sonnet-5-5', null, true, '2026-11-10T11:00:00Z'),
         ($1, $1, 'chat', 'claude-sonnet-5-5', null, false, '2026-11-10T12:00:00Z')`,
      [user],
    );
    await asServiceRole();
    const { n } = await one<{ n: string }>(
      `select public.jarvis_space_calls($1, $1, '2026-11-01T00:00:00Z')::text as n`,
      [user],
    );
    expect(Number(n)).toBe(2);
    await asServer();
  });

  it("sums the usage by job, model and routed-from for the server only", async () => {
    await asServer();
    const other = await createAuthUser();
    await db.query(
      `insert into ai_usage (user_id, purpose, model, routed_from, input_tokens, cache_read_tokens, output_tokens, cost_usd, created_at) values
         ($1, 'opportunity_scan', 'claude-haiku-5-5', null, 2000, 0, 300, 0.00035, '2026-11-20T08:00:00Z'),
         ($1, 'opportunity_scan', 'claude-haiku-5-5', null, 3000, 0, 200, 0.0004, '2026-11-20T09:00:00Z'),
         ($1, 'opportunity_scan', 'claude-haiku-5-5', null, 90000, 20000, 100, 0.06, '2026-11-20T10:00:00Z'),
         ($1, 'opportunity_scan', 'claude-haiku-5-5', null, 1000, 0, 100, 0.0002, '2026-10-01T10:00:00Z')`,
      [other],
    );
    await asServiceRole();
    const grouped = await rows<{ long_prompt: boolean; calls: string; input_tokens: string; cost_usd: string }>(
      `select long_prompt, calls::text, input_tokens::text, cost_usd::text
       from public.admin_ai_model_usage('2026-11-15T00:00:00Z')
       where purpose = 'opportunity_scan' order by long_prompt`,
    );
    expect(grouped.map((row) => [row.long_prompt, Number(row.calls), Number(row.input_tokens)])).toEqual([
      [false, 2, 5000],
      [true, 1, 90000],
    ]);
    await asUser(owner);
    await expect(db.query(`select * from public.admin_ai_model_usage(now())`)).rejects.toThrow(
      /permission denied/,
    );
    await asServer();
  });
});

describe("jarvis_budget_alerts", () => {
  it("takes the monthly economy e-mail as its own kind", async () => {
    await asServer();
    await db.query(`insert into jarvis_budget_alerts (day, kind) values ('2026-11-01', 'economy')`);
    await expect(
      db.query(`insert into jarvis_budget_alerts (day, kind) values ('2026-11-01', 'other')`),
    ).rejects.toThrow(/jarvis_budget_alerts_kind_check/);
  });
});
