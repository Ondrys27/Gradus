// @vitest-environment node
//
// Usage analytics in the database: nobody but the server reads or writes the
// events and sessions, the trigger fills owner, plan, mode, language and
// session, the browser's rate limit and sessions work, history moves over
// from usage_events without free text, internal accounts are marked and a
// user can not unmark themselves. Runs every migration in PGlite with the
// same Supabase stubs as schema.test.ts; usage_events rows are seeded before
// the analytics migration runs, as on the live database.

import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CLIENT_RATE_LIMIT } from "@/lib/analytics/ingest";
import { PGLITE_EXTENSIONS } from "./pglite-extensions";

const MIGRATIONS_DIR = path.resolve(__dirname, "../../../supabase/migrations");
const ANALYTICS_MIGRATION = "20261008090000_analytics.sql";

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
async function asUser(uid: string) {
  await db.exec(
    `select set_config('request.jwt.claim.sub', '${uid}', false); set role authenticated;`,
  );
}
async function asServiceRole() {
  await db.exec(`select set_config('request.jwt.claim.sub', '', false); set role service_role;`);
}
async function asServer() {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
}
async function createAuthUser(email = `${crypto.randomUUID()}@example.com`) {
  await asServer();
  const { id } = await one<{ id: string }>(
    `insert into auth.users (email, raw_user_meta_data) values ($1, '{"locale":"cs"}') returning id`,
    [email],
  );
  return id;
}
async function migrate(filter: (file: string) => boolean) {
  for (const file of readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql") && filter(f))
    .sort()) {
    await db.exec(readFileSync(path.join(MIGRATIONS_DIR, file), "utf8"));
  }
}

let owner: string;
let user: string;
let demo: string;
let workerAccount: string;

beforeAll(async () => {
  db = new PGlite({ extensions: PGLITE_EXTENSIONS });
  await db.exec(SUPABASE_STUBS);
  await migrate((file) => file < ANALYTICS_MIGRATION);

  owner = await createAuthUser("owner@example.com");
  user = await createAuthUser();
  demo = await createAuthUser("demo@gradus.local");
  workerAccount = await createAuthUser();

  // History written before the analytics layer existed, with free text in it.
  await db.query(
    `insert into usage_events (user_id, event_type, success, quantity, message, metadata) values
       ($1, 'generate_contacts', true, 12, null,
        jsonb_build_object('query', 'kadeřnictví Brno', 'page', 1, 'results', 20, 'duplicates', 3,
                           'http_status', 200, 'actor_id', $2::text)),
       ($1, 'generate_contacts', false, 0, 'API key not valid for jan@example.com', '{"query":"x","code":"keyInvalid","http_status":400}'),
       ($1, 'file_upload', true, 1, null, '{"kind":"pdf","size":2048}'),
       ($1, 'file_upload', false, 1, 'fileTooLarge: smlouva Novák.pdf: 12000000 B', '{}'),
       ($1, 'jarvis_proactive', true, 2, null, '{"reaction":"accept","kind":"suggestion","type":"stalledDeal"}'),
       ($1, 'plan_interest', true, 1, null, '{"plan":"pro"}')`,
    [user, user],
  );

  await migrate((file) => file >= ANALYTICS_MIGRATION);
});

afterAll(async () => {
  await db?.close();
});

describe("history from usage_events", () => {
  it("moves over as catalog events without any of the free text", async () => {
    await asServer();
    const moved = await rows<{ event: string; props: Row; user_id: string; owner_id: string }>(
      `select event, props, user_id, owner_id from analytics_events where user_id = $1 order by id`,
      [user],
    );
    expect(moved.map((row) => row.event)).toEqual([
      "places_request",
      "places_request",
      "jarvis_file_attached",
      "jarvis_file_rejected",
      "jarvis_proactive_reacted",
      "plan_interest_clicked",
    ]);
    expect(moved[0].props).toEqual({
      ok: true,
      saved: 12,
      page: 1,
      results: 20,
      duplicates: 3,
      http_status: 200,
    });
    expect(moved[1].props).toEqual({
      ok: false,
      saved: 0,
      http_status: 400,
      error_code: "keyInvalid",
    });
    expect(moved[2].props).toEqual({ kind: "pdf", size_kb: 2 });
    expect(moved[3].props).toEqual({ reason: "fileTooLarge" });
    expect(moved[4].props).toEqual({
      reaction: "accept",
      kind: "suggestion",
      type: "stalledDeal",
      tasks_created: 2,
    });
    expect(moved[5].props).toEqual({ plan: "pro", ok: true });
    expect(moved.every((row) => row.owner_id === user)).toBe(true);
    const text = JSON.stringify(moved);
    expect(text).not.toMatch(/kadeřnictví|example\.com|Novák|12000000/);
  });

  it("leaves usage_events readable but closed for writing, even for the service role", async () => {
    await asServiceRole();
    await expect(
      db.query(`insert into usage_events (user_id, event_type) values ($1, 'x')`, [user]),
    ).rejects.toThrow(/permission denied/);
    await asServer();
    expect((await one<{ n: number }>(`select count(*)::int as n from usage_events`)).n).toBe(6);
  });
});

describe("internal accounts", () => {
  it("marks the owner and @gradus.local addresses, nobody else", async () => {
    await asServer();
    const flags = await rows<{ id: string; is_internal: boolean }>(
      `select id, is_internal from profiles where id = any($1)`,
      [[owner, user, demo]],
    );
    const byId = Object.fromEntries(flags.map((row) => [row.id, row.is_internal]));
    expect(byId[owner]).toBe(true);
    expect(byId[demo]).toBe(true);
    expect(byId[user]).toBe(false);

    const later = await createAuthUser("tester@GRADUS.local");
    expect(
      (
        await one<{ is_internal: boolean }>(`select is_internal from profiles where id = $1`, [
          later,
        ])
      ).is_internal,
    ).toBe(true);
  });

  it("can not be changed by the user", async () => {
    await asUser(user);
    await db.query(`update profiles set is_internal = true where id = $1`, [user]);
    await asUser(owner);
    await db.query(`update profiles set is_internal = false where id = $1`, [owner]);
    await asServer();
    const flags = await rows<{ id: string; is_internal: boolean }>(
      `select id, is_internal from profiles where id = any($1)`,
      [[owner, user]],
    );
    const byId = Object.fromEntries(flags.map((row) => [row.id, row.is_internal]));
    expect(byId[user]).toBe(false);
    expect(byId[owner]).toBe(true);
  });
});

describe("no client access", () => {
  it("hides events, sessions, limits and keyword stats from signed-in users", async () => {
    await asUser(user);
    for (const table of [
      "analytics_events",
      "app_sessions",
      "analytics_rate_limits",
      "generation_keyword_stats",
    ]) {
      await expect(db.query(`select 1 from ${table} limit 1`)).rejects.toThrow(/permission denied/);
    }
    await expect(
      db.query(`insert into analytics_events (user_id, event) values ($1, 'page_viewed')`, [user]),
    ).rejects.toThrow(/permission denied/);
    await expect(
      db.query(`insert into app_sessions (user_id) values ($1)`, [user]),
    ).rejects.toThrow(/permission denied/);
  });

  it("refuses the server-only functions to signed-in users", async () => {
    await asUser(user);
    await expect(
      db.query(`select public.analytics_take_quota($1, 1, 120)`, [user]),
    ).rejects.toThrow(/permission denied/);
    await expect(
      db.query(`select public.touch_app_session($1, 'desktop', 'chrome')`, [user]),
    ).rejects.toThrow(/permission denied/);
    await expect(db.query(`select public.purge_analytics()`)).rejects.toThrow(/permission denied/);
    await expect(db.query(`select public.count_generation_keyword('pekarna')`)).rejects.toThrow(
      /permission denied/,
    );
  });
});

describe("enrichment", () => {
  it("fills owner, plan, mode, language, session and device from the account", async () => {
    await asServiceRole();
    const session = (
      await one<{ id: string }>(`select public.touch_app_session($1, 'mobile', 'safari') as id`, [
        user,
      ])
    ).id;
    const event = await one<Row>(
      `insert into analytics_events (user_id, event, props) values ($1, 'task_created', '{"depth":0,"is_subtask":false}')
       returning owner_id, plan_key, game_mode, locale, session_id, device`,
      [user],
    );
    expect(event).toEqual({
      owner_id: user,
      plan_key: "trial",
      game_mode: "game",
      locale: "cs",
      session_id: session,
      device: "mobile",
    });
  });

  it("puts a worker's events under the owner they work for", async () => {
    await asServer();
    await db.query(
      `insert into workers (owner_id, user_id, name, status) values ($1, $2, 'W', 'active')`,
      [owner, workerAccount],
    );
    await asServiceRole();
    const event = await one<{ owner_id: string; user_id: string; plan_key: string }>(
      `insert into analytics_events (user_id, event) values ($1, 'timer_started')
       returning owner_id, user_id, plan_key`,
      [workerAccount],
    );
    expect(event.user_id).toBe(workerAccount);
    expect(event.owner_id).toBe(owner);
    expect(event.plan_key).toBe("beta");
  });

  it("leaves system events without a person alone", async () => {
    await asServiceRole();
    const event = await one<Row>(
      `insert into analytics_events (event, props) values ('cron_run', '{"job":"fakturoid_sync","ok":true,"duration_ms":5}')
       returning user_id, owner_id, plan_key, session_id`,
    );
    expect(event).toEqual({ user_id: null, owner_id: null, plan_key: null, session_id: null });
  });

  it("refuses event names outside the naming rule and props that are not an object", async () => {
    await asServiceRole();
    await expect(
      db.query(`insert into analytics_events (event) values ('Page Viewed')`),
    ).rejects.toThrow(/check/);
    await expect(
      db.query(`insert into analytics_events (event, props) values ('page_viewed', '"text"')`),
    ).rejects.toThrow(/check/);
  });
});

describe("rate limit", () => {
  it(`grants at most ${CLIENT_RATE_LIMIT} units a minute and starts again the next minute`, async () => {
    const someone = await createAuthUser();
    await asServiceRole();
    const take = async (units: number) =>
      (
        await one<{ granted: number }>(
          `select public.analytics_take_quota($1, $2, $3) as granted`,
          [someone, units, CLIENT_RATE_LIMIT],
        )
      ).granted;
    expect(await take(100)).toBe(100);
    expect(await take(50)).toBe(CLIENT_RATE_LIMIT - 100);
    expect(await take(1)).toBe(0);
    expect(await take(0)).toBe(0);

    await asServer();
    await db.query(
      `update analytics_rate_limits set window_start = window_start - interval '1 minute' where user_id = $1`,
      [someone],
    );
    await asServiceRole();
    expect(await take(5)).toBe(5);
  });
});

describe("sessions", () => {
  it("extends the open session and starts a new one after 30 minutes of silence", async () => {
    const someone = await createAuthUser();
    await asServiceRole();
    const touch = async () =>
      (
        await one<{ id: string }>(
          `select public.touch_app_session($1, 'desktop', 'firefox') as id`,
          [someone],
        )
      ).id;
    const first = await touch();
    expect(await touch()).toBe(first);

    await asServer();
    await db.query(
      `update app_sessions set started_at = started_at - interval '2 hours',
                               last_seen_at = last_seen_at - interval '31 minutes'
       where id = $1`,
      [first],
    );
    await asServiceRole();
    const second = await touch();
    expect(second).not.toBe(first);
    await asServer();
    expect(
      (
        await one<{ n: number }>(`select count(*)::int as n from app_sessions where user_id = $1`, [
          someone,
        ])
      ).n,
    ).toBe(2);
  });
});

describe("retention", () => {
  it("purges events, sessions and usage rows older than 13 months", async () => {
    const someone = await createAuthUser();
    await asServer();
    await db.query(
      `insert into analytics_events (user_id, event, created_at) values
         ($1, 'timer_started', now() - interval '14 months'),
         ($1, 'timer_started', now() - interval '12 months')`,
      [someone],
    );
    await db.query(
      `insert into app_sessions (user_id, started_at, last_seen_at)
       values ($1, now() - interval '14 months', now() - interval '14 months')`,
      [someone],
    );
    await asServiceRole();
    const removed = await one<{ events: number; sessions: number }>(
      `select * from public.purge_analytics()`,
    );
    expect(removed.events).toBe(1);
    expect(removed.sessions).toBe(1);
    await asServer();
    expect(
      (
        await one<{ n: number }>(
          `select count(*)::int as n from analytics_events where user_id = $1`,
          [someone],
        )
      ).n,
    ).toBe(1);
  });
});

describe("generation keywords", () => {
  it("counts a keyword per day without any link to a person", async () => {
    await asServiceRole();
    await db.query(`select public.count_generation_keyword('kadernictvi')`);
    await db.query(`select public.count_generation_keyword('kadernictvi')`);
    await asServer();
    const row = await one<Row>(
      `select * from generation_keyword_stats where keyword = 'kadernictvi'`,
    );
    expect(row.searches).toBe(2);
    expect(Object.keys(row).sort()).toEqual(["day", "keyword", "searches"]);
  });
});
