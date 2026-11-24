// @vitest-environment node
//
// Grady for the lowest price (step 28.9): ai_usage.batch is server-written
// with a default; grady_batches is closed to clients; the administration's
// comparison does not use up the plan's answers; the quality signals, the
// tiered usage and the cost per user are server only and count what they
// should. Runs every migration in PGlite with the stubs of
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

let user: string;
let other: string;

beforeAll(async () => {
  db = new PGlite({ extensions: PGLITE_EXTENSIONS });
  await db.exec(SUPABASE_STUBS);
  for (const file of readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    await db.exec(readFileSync(path.join(MIGRATIONS_DIR, file), "utf8"));
  }
  await createAuthUser(); // first account = owner
  user = await createAuthUser();
  other = await createAuthUser();
}, 120_000);

afterAll(async () => {
  await db?.close();
});

const usage = (purpose: string, at: string, extra = "") =>
  db.query(
    `insert into ai_usage (user_id, purpose, model, cost_usd, duration_ms, created_at${extra ? ", batch" : ""})
     values ($1, $2, 'claude-haiku-5-5', 0.01, 1000, $3${extra ? `, ${extra}` : ""})`,
    [user, purpose, at],
  );

describe("ai_usage.batch and grady_batches", () => {
  it("defaults batch to false and keeps the table server-written", async () => {
    await asServer();
    await usage("briefing", "2026-11-20T05:00:00Z", "true");
    await usage("briefing", "2026-11-20T05:01:00Z");
    const flags = await rows<{ batch: boolean }>(
      `select batch from ai_usage where user_id = $1 and purpose = 'briefing' order by created_at`,
      [user],
    );
    expect(flags.map((row) => row.batch)).toEqual([true, false]);
  });

  it("closes grady_batches to every client, open to the server", async () => {
    await asServer();
    await db.query(
      `insert into grady_batches (kind, batch_id, model, items) values ('watch', 'msgbatch_x', 'claude-haiku-5-5', '[]')`,
    );
    await expect(
      db.query(`insert into grady_batches (kind, batch_id, model) values ('other', 'b2', 'm')`),
    ).rejects.toThrow(/grady_batches_kind_check/);
    await asUser(user);
    await expect(db.query(`select * from grady_batches`)).rejects.toThrow(/permission denied/);
    await expect(
      db.query(`insert into grady_batches (kind, batch_id, model) values ('watch', 'b3', 'm')`),
    ).rejects.toThrow(/permission denied/);
    await asServiceRole();
    expect((await rows(`select batch_id from grady_batches`)).length).toBe(1);
    await asServer();
  });
});

describe("the plan's answers and the comparison", () => {
  it("leaves the administration's comparison out of the monthly answers", async () => {
    await asServer();
    const before = await one<{ n: number }>(
      `select public.jarvis_space_calls($1, $1, '2026-11-01T00:00:00Z')::int as n`,
      [user],
    );
    await usage("model_compare", "2026-11-21T10:00:00Z");
    await usage("compare_judge", "2026-11-21T10:00:01Z");
    await usage("rules_test", "2026-11-21T10:00:02Z");
    const after = await one<{ n: number }>(
      `select public.jarvis_space_calls($1, $1, '2026-11-01T00:00:00Z')::int as n`,
      [user],
    );
    expect(after.n - before.n).toBe(1);
  });
});

describe("the administration's functions of 28.9", () => {
  it("are for the server only", async () => {
    await asUser(user);
    for (const call of [
      `select * from admin_ai_quality_signals(now() - interval '30 days')`,
      `select * from admin_ai_model_usage_by_tier(now() - interval '30 days')`,
      `select * from admin_ai_efficiency(current_date - 7, current_date)`,
    ]) {
      await expect(db.query(call), call).rejects.toThrow(/permission denied/);
    }
    await asServer();
  });

  it("count re-asks of a job only after the answer was read, and rephrased chat questions", async () => {
    await asServer();
    // email_reply: ends 10:00:00; again 10:00:05 (no pause: a long reply in parts), 10:03:00 (a re-ask).
    for (const at of ["2026-11-22T10:00:00Z", "2026-11-22T10:00:06Z", "2026-11-22T10:03:00Z"]) {
      await usage("email_reply", at);
    }
    const { id: conversation } = await one<{ id: string }>(
      `insert into jarvis_conversations (user_id, title) values ($1, 'x') returning id`,
      [user],
    );
    for (const [role, content, at, rating] of [
      ["user", "Jak mám nacenit svatební focení?", "2026-11-22T11:00:00Z", null],
      ["assistant", "Odpověď", "2026-11-22T11:00:10Z", "down"],
      ["user", "Jak mám nacenit svatební focení na celý den?", "2026-11-22T11:01:00Z", null],
      ["assistant", "Odpověď", "2026-11-22T11:01:10Z", "up"],
      ["user", "Díky, a co e-mail pro paní Lípovou?", "2026-11-22T11:02:00Z", null],
    ] as const) {
      await db.query(
        `insert into jarvis_messages (user_id, conversation_id, role, content, created_at, rating)
         values ($1, $2, $3, $4, $5, $6)`,
        [user, conversation, role, content, at, rating],
      );
    }
    const signals = await rows<Row>(
      `select purpose, calls::int, asks::int, repeats::int, ratings_up::int, ratings_down::int
       from admin_ai_quality_signals('2026-11-22T00:00:00Z') order by purpose`,
    );
    expect(signals.find((row) => row.purpose === "email_reply")).toMatchObject({
      calls: 3,
      repeats: 1,
    });
    expect(signals.find((row) => row.purpose === "chat")).toMatchObject({
      asks: 3,
      repeats: 1,
      ratings_up: 1,
      ratings_down: 1,
    });
  });

  it("gives cost per day and a total row, internal accounts left out", async () => {
    await asServer();
    await db.query(`update profiles set is_internal = true where id = $1`, [other]);
    await db.query(
      `insert into ai_usage (user_id, purpose, model, cost_usd, created_at) values ($1, 'chat', 'claude-haiku-5-5', 5, '2026-11-22T12:00:00Z')`,
      [other],
    );
    const days = await rows<Row>(
      `select day::text as day, cost_usd::float as cost, chat_answers::int as answers, batch_cost_usd::float as batch
       from admin_ai_efficiency('2026-11-20', '2026-11-22', 'Europe/Prague', false)`,
    );
    expect(days).toHaveLength(4);
    const total = days[3];
    expect(total.day).toBeNull();
    expect(Number(total.cost)).toBeCloseTo(0.01 * 8, 6);
    expect(Number(total.batch)).toBeCloseTo(0.01, 6);
    expect(total.answers).toBe(2);
    const withInternal = await rows<Row>(
      `select cost_usd::float as cost from admin_ai_efficiency('2026-11-20', '2026-11-22', 'Europe/Prague', true) where day is null`,
    );
    expect(Number(withInternal[0].cost)).toBeCloseTo(0.01 * 8 + 5, 6);
  });

  it("run for the service role the server calls them with", async () => {
    await asServiceRole();
    for (const call of [
      `select * from admin_ai_quality_signals(now() - interval '30 days')`,
      `select * from admin_ai_model_usage_by_tier(now() - interval '30 days')`,
      `select * from admin_ai_efficiency('2026-11-20', '2026-11-22', 'Europe/Prague', false)`,
      `select public.jarvis_space_calls('${"00000000-0000-4000-8000-000000000000"}', '${"00000000-0000-4000-8000-000000000000"}', now())`,
    ]) {
      await expect(db.query(call), call).resolves.toBeTruthy();
    }
    await asServer();
  });
});
