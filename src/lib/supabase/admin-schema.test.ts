// @vitest-environment node
//
// The administration's gate in the database: a regular user and the owner
// without the second factor are refused, the owner with aal2 gets in, the
// admin session ends after 30 idle minutes or 8 hours and for good after
// signing out, and nobody but the server reads or writes the audit, the
// sessions and the sign-in attempts. Runs every migration in PGlite with the
// same Supabase stubs as schema.test.ts plus auth.jwt().

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
type Token = { aal: "aal1" | "aal2"; sessionId: string; totpSecondsAgo?: number };
/** Signs in as `uid` with the claims Supabase would put in the access token. */
async function asUser(uid: string, token: Token) {
  const now = Math.floor(Date.now() / 1000);
  const amr: { method: string; timestamp: number }[] = [
    { method: "password", timestamp: now - 60 },
  ];
  if (token.totpSecondsAgo !== undefined) {
    amr.unshift({ method: "totp", timestamp: now - token.totpSecondsAgo });
  }
  const claims = JSON.stringify({ sub: uid, aal: token.aal, session_id: token.sessionId, amr });
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid]);
  await db.query(`select set_config('request.jwt.claims', $1, false)`, [claims]);
  await db.exec(`set role authenticated;`);
}
async function touch(activity = true): Promise<{ status: string; expires_at?: string }> {
  return (
    await one<{ r: { status: string } }>(`select public.admin_session_touch($1) as r`, [activity])
  ).r;
}
async function createAuthUser(email = `${crypto.randomUUID()}@example.com`) {
  await asServer();
  const { id } = await one<{ id: string }>(
    `insert into auth.users (email, raw_user_meta_data) values ($1, '{"locale":"cs"}') returning id`,
    [email],
  );
  return id;
}

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
  owner = await createAuthUser("owner@example.com"); // first account = owner
  user = await createAuthUser();
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe("admin gate", () => {
  it("refuses a regular user even with a second factor", async () => {
    await asUser(user, { aal: "aal2", sessionId: crypto.randomUUID(), totpSecondsAgo: 10 });
    expect((await touch()).status).toBe("denied");
  });

  it("refuses the owner without the second factor", async () => {
    await asUser(owner, { aal: "aal1", sessionId: crypto.randomUUID() });
    expect((await touch()).status).toBe("denied");
  });

  it("refuses an aal2 token without a TOTP step or a session id", async () => {
    await asUser(owner, { aal: "aal2", sessionId: crypto.randomUUID() });
    expect((await touch()).status).toBe("denied");
    await asUser(owner, { aal: "aal2", sessionId: "not-a-uuid", totpSecondsAgo: 5 });
    expect((await touch()).status).toBe("denied");
  });

  it("lets the owner with aal2 in and opens the admin session", async () => {
    const sessionId = crypto.randomUUID();
    await asUser(owner, { aal: "aal2", sessionId, totpSecondsAgo: 30 });
    const result = await touch();
    expect(result.status).toBe("ok");
    expect(new Date(result.expires_at!).getTime()).toBeGreaterThan(Date.now() + 7.9 * 3_600_000);
    await asServer();
    expect(
      (
        await one<{ n: number }>(
          `select count(*)::int as n from admin_sessions where session_id = $1`,
          [sessionId],
        )
      ).n,
    ).toBe(1);
  });

  it("ends the admin session after 30 idle minutes, for good", async () => {
    const sessionId = crypto.randomUUID();
    await asUser(owner, { aal: "aal2", sessionId, totpSecondsAgo: 60 });
    expect((await touch()).status).toBe("ok");
    await asServer();
    await db.query(
      `update admin_sessions set last_seen_at = now() - interval '31 minutes' where session_id = $1`,
      [sessionId],
    );
    await asUser(owner, { aal: "aal2", sessionId, totpSecondsAgo: 60 });
    expect((await touch()).status).toBe("idle");
    expect((await touch()).status).toBe("ended");
  });

  it("only checking does not count as activity", async () => {
    const sessionId = crypto.randomUUID();
    await asUser(owner, { aal: "aal2", sessionId, totpSecondsAgo: 60 });
    expect((await touch()).status).toBe("ok");
    await asServer();
    await db.query(
      `update admin_sessions set last_seen_at = now() - interval '20 minutes' where session_id = $1`,
      [sessionId],
    );
    await asUser(owner, { aal: "aal2", sessionId, totpSecondsAgo: 60 });
    expect((await touch(false)).status).toBe("ok");
    await asServer();
    const seen = await one<{ idle: boolean }>(
      `select last_seen_at < now() - interval '19 minutes' as idle from admin_sessions where session_id = $1`,
      [sessionId],
    );
    expect(seen.idle).toBe(true);
  });

  it("asks for a new sign-in 8 hours after the code", async () => {
    await asUser(owner, {
      aal: "aal2",
      sessionId: crypto.randomUUID(),
      totpSecondsAgo: 8 * 3600 + 5,
    });
    expect((await touch()).status).toBe("expired");

    const sessionId = crypto.randomUUID();
    await asUser(owner, { aal: "aal2", sessionId, totpSecondsAgo: 60 });
    expect((await touch()).status).toBe("ok");
    await asServer();
    await db.query(
      `update admin_sessions set started_at = now() - interval '8 hours 1 minute' where session_id = $1`,
      [sessionId],
    );
    await asUser(owner, { aal: "aal2", sessionId, totpSecondsAgo: 60 });
    expect((await touch()).status).toBe("expired");
  });

  it("signing out ends the admin session; the same session never comes back", async () => {
    const sessionId = crypto.randomUUID();
    await asUser(owner, { aal: "aal2", sessionId, totpSecondsAgo: 60 });
    expect((await touch()).status).toBe("ok");
    await db.query(`select public.admin_session_end()`);
    // A fresh code on the same session is not a new sign-in.
    await asUser(owner, { aal: "aal2", sessionId, totpSecondsAgo: 1 });
    expect((await touch()).status).toBe("ended");
  });

  it("is closed to anonymous callers", async () => {
    await asServer();
    await db.exec(`set role anon;`);
    await expect(db.query(`select public.admin_session_touch(true)`)).rejects.toThrow(
      /permission denied/,
    );
  });
});

describe("no client access", () => {
  it("hides the audit, the sessions and the attempts from signed-in users, owner included", async () => {
    for (const uid of [user, owner]) {
      await asUser(uid, { aal: "aal2", sessionId: crypto.randomUUID(), totpSecondsAgo: 5 });
      for (const table of ["admin_audit", "admin_sessions", "admin_login_attempts"]) {
        await expect(db.query(`select 1 from ${table} limit 1`)).rejects.toThrow(
          /permission denied/,
        );
      }
      await expect(
        db.query(`insert into admin_audit (user_id, kind, target) values ($1, 'view', 'audit')`, [
          uid,
        ]),
      ).rejects.toThrow(/permission denied/);
      await expect(
        db.query(
          `insert into admin_sessions (session_id, user_id, started_at) values ($1, $2, now())`,
          [crypto.randomUUID(), uid],
        ),
      ).rejects.toThrow(/permission denied/);
      await expect(
        db.query(
          `insert into admin_login_attempts (ip_hash, stage, success) values ('0123456789abcdef', 'password', true)`,
        ),
      ).rejects.toThrow(/permission denied/);
    }
  });

  it("keeps free text out of the audit", async () => {
    await asServer();
    await expect(
      db.query(
        `insert into admin_audit (user_id, kind, target) values ($1, 'export', 'Jan Novák')`,
        [owner],
      ),
    ).rejects.toThrow(/check constraint/);
    await expect(
      db.query(
        `insert into admin_audit (user_id, kind, target, ip_hash) values ($1, 'export', 'audit', '192.168.0.1')`,
        [owner],
      ),
    ).rejects.toThrow(/check constraint/);
  });
});
