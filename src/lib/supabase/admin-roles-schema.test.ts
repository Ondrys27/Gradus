// @vitest-environment node
//
// Administrators next to the owner (step 14.4): the admin role enters the
// administration like the owner, but cannot change AI caps, invite or remove
// anyone. Invitations are written only through their functions, accepted once
// with aal2, never after expiry or revocation. Removing an admin ends their
// admin session at once. An account created from an invitation gets no
// workspace. Runs every migration in PGlite with the Supabase stubs.

import { createHash, randomBytes } from "node:crypto";
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
/** Signed in as `uid`; aal2 tokens carry a TOTP step a moment ago. */
async function asUser(uid: string, aal: "aal1" | "aal2" = "aal2", sessionId = sessions.get(uid)) {
  const now = Math.floor(Date.now() / 1000);
  const amr: { method: string; timestamp: number }[] = [{ method: "password", timestamp: now - 60 }];
  if (aal === "aal2") amr.unshift({ method: "totp", timestamp: now - 30 });
  const claims = JSON.stringify({ sub: uid, aal, session_id: sessionId, amr });
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid]);
  await db.query(`select set_config('request.jwt.claims', $1, false)`, [claims]);
  await db.exec(`set role authenticated;`);
}
async function touch(): Promise<{ status: string; role?: string }> {
  return (await one<{ r: { status: string; role?: string } }>(`select public.admin_session_touch(true) as r`)).r;
}
async function createAuthUser(meta: Record<string, unknown> = { locale: "cs" }) {
  await asServer();
  const { id } = await one<{ id: string }>(
    `insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id`,
    [`${crypto.randomUUID()}@example.com`, JSON.stringify(meta)],
  );
  sessions.set(id, crypto.randomUUID());
  return id;
}
function newToken() {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: createHash("sha256").update(token).digest("hex") };
}
async function createInvite(hash: string, email: string | null = null) {
  await asUser(owner);
  return (await one<{ id: string }>(`select public.admin_invite_create($1, $2, 'note', null) as id`, [hash, email])).id;
}

const sessions = new Map<string, string>();
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

describe("admin invitations", () => {
  it("are closed to clients: no direct read or write", async () => {
    await asUser(owner);
    await expect(db.query(`select 1 from public.admin_invites limit 1`)).rejects.toThrow(/permission denied/);
    await expect(
      db.query(`insert into public.admin_invites (token_hash) values ($1)`, [newToken().hash]),
    ).rejects.toThrow(/permission denied/);
    await expect(db.query(`select * from public.admin_members()`)).rejects.toThrow(/permission denied/);
  });

  it("are created only by the owner with a live admin session, and audited", async () => {
    await asUser(owner, "aal1");
    await expect(
      db.query(`select public.admin_invite_create($1)`, [newToken().hash]),
    ).rejects.toThrow(/admin_required/);
    await asUser(user);
    await expect(
      db.query(`select public.admin_invite_create($1)`, [newToken().hash]),
    ).rejects.toThrow(/admin_required/);

    const { hash } = newToken();
    const id = await createInvite(hash, " Someone@Example.com ");
    await asServer();
    const row = await one<{ email: string; expires_at: Date; created_at: Date; token_hash: string }>(
      `select email, expires_at, created_at, token_hash from public.admin_invites where id = $1`,
      [id],
    );
    expect(row.email).toBe("someone@example.com");
    expect(row.token_hash).toBe(hash);
    expect(new Date(row.expires_at).getTime() - new Date(row.created_at).getTime()).toBe(7 * 86_400_000);
    const audit = await one<{ n: number }>(
      `select count(*)::int as n from public.admin_audit where target = 'admins.invite' and detail ->> 'invite' = $1`,
      [id],
    );
    expect(audit.n).toBe(1);
  });

  it("refuses a malformed token hash", async () => {
    await asUser(owner);
    await expect(db.query(`select public.admin_invite_create('abc')`)).rejects.toThrow(/invalid_value/);
  });

  it("is accepted once, with aal2, granting the admin role", async () => {
    const { hash } = newToken();
    const id = await createInvite(hash);
    const invited = await createAuthUser();
    const other = await createAuthUser();

    await asUser(invited, "aal1");
    await expect(db.query(`select public.admin_invite_accept($1)`, [hash])).rejects.toThrow(/invalid_invite/);

    await asUser(invited);
    await db.query(`select public.admin_invite_accept($1)`, [hash]);
    expect((await touch()).role).toBe("admin");

    // The same link a second time, by anyone, fails.
    await asUser(other);
    await expect(db.query(`select public.admin_invite_accept($1)`, [hash])).rejects.toThrow(/invalid_invite/);
    await asServer();
    const row = await one<{ accepted_by: string; internal: boolean }>(
      `select i.accepted_by, p.is_internal as internal
       from public.admin_invites i join public.profiles p on p.id = i.accepted_by where i.id = $1`,
      [id],
    );
    expect(row.accepted_by).toBe(invited);
    expect(row.internal).toBe(true);
  });

  it("is refused when expired, revoked or for the owner", async () => {
    const expired = newToken();
    const expiredId = await createInvite(expired.hash);
    await asServer();
    await db.query(`update public.admin_invites set expires_at = now() - interval '1 second' where id = $1`, [expiredId]);

    const revoked = newToken();
    const revokedId = await createInvite(revoked.hash);
    await asUser(owner);
    await db.query(`select public.admin_invite_revoke($1)`, [revokedId]);
    await expect(db.query(`select public.admin_invite_revoke($1)`, [revokedId])).rejects.toThrow(/not_open/);

    const someone = await createAuthUser();
    await asUser(someone);
    await expect(db.query(`select public.admin_invite_accept($1)`, [expired.hash])).rejects.toThrow(/invalid_invite/);
    await expect(db.query(`select public.admin_invite_accept($1)`, [revoked.hash])).rejects.toThrow(/invalid_invite/);

    const forOwner = newToken();
    await createInvite(forOwner.hash);
    await asUser(owner);
    await expect(db.query(`select public.admin_invite_accept($1)`, [forOwner.hash])).rejects.toThrow(/invalid_invite/);
  });
});

describe("claiming an invitation (one new account per link)", () => {
  async function claim(uid: string, hash: string, aal: "aal1" | "aal2" = "aal1") {
    await asUser(uid, aal);
    return db.query(`select public.admin_invite_claim($1)`, [hash]);
  }

  it("lets only the first new account hold the link; the same account may call again", async () => {
    const { hash } = newToken();
    const id = await createInvite(hash);
    const first = await createAuthUser({ locale: "cs", admin_invite: true });
    const second = await createAuthUser({ locale: "cs", admin_invite: true });

    await claim(first, hash);
    await claim(first, hash); // a retry after a network error
    await expect(claim(second, hash)).rejects.toThrow(/invalid_invite/);

    await asServer();
    const row = await one<{ claimed_by: string; claimed: boolean }>(
      `select claimed_by, claimed_at is not null as claimed from public.admin_invites where id = $1`,
      [id],
    );
    expect(row).toEqual({ claimed_by: first, claimed: true });
    const audit = await one<{ n: number }>(
      `select count(*)::int as n from public.admin_audit where target = 'admins.claim' and detail ->> 'invite' = $1`,
      [id],
    );
    expect(audit.n).toBe(1);

    // The holder still accepts it after the second factor.
    await asUser(first);
    await db.query(`select public.admin_invite_accept($1)`, [hash]);
    expect((await touch()).role).toBe("admin");
    // Once accepted, nobody claims it, not even the holder.
    await expect(claim(first, hash)).rejects.toThrow(/invalid_invite/);
  });

  it("frees the link again when the holding account is deleted", async () => {
    const { hash } = newToken();
    const id = await createInvite(hash);
    const gone = await createAuthUser({ locale: "cs", admin_invite: true });
    await claim(gone, hash);
    await asServer();
    await db.query(`delete from public.profiles where id = $1`, [gone]);
    await db.query(`delete from public.user_settings where user_id = $1`, [gone]);
    await db.query(`delete from auth.users where id = $1`, [gone]);
    const row = await one<{ claimed_by: string | null }>(
      `select claimed_by from public.admin_invites where id = $1`,
      [id],
    );
    expect(row.claimed_by).toBeNull();
    const next = await createAuthUser({ locale: "cs", admin_invite: true });
    await claim(next, hash);
  });

  it("is refused for expired, revoked or unknown links, the owner and anonymous callers", async () => {
    const expired = newToken();
    const expiredId = await createInvite(expired.hash);
    await asServer();
    await db.query(`update public.admin_invites set expires_at = now() - interval '1 second' where id = $1`, [
      expiredId,
    ]);
    const revoked = newToken();
    const revokedId = await createInvite(revoked.hash);
    await asUser(owner);
    await db.query(`select public.admin_invite_revoke($1)`, [revokedId]);

    const someone = await createAuthUser({ locale: "cs", admin_invite: true });
    await expect(claim(someone, expired.hash)).rejects.toThrow(/invalid_invite/);
    await expect(claim(someone, revoked.hash)).rejects.toThrow(/invalid_invite/);
    await expect(claim(someone, newToken().hash)).rejects.toThrow(/invalid_invite/);

    const open = newToken();
    await createInvite(open.hash);
    await expect(claim(owner, open.hash)).rejects.toThrow(/invalid_invite/);
    await asServer();
    await db.exec(`set role anon;`);
    await expect(db.query(`select public.admin_invite_claim($1)`, [open.hash])).rejects.toThrow(
      /permission denied/,
    );
    await asServer();
  });

  it("cannot be written around: no direct update of claimed_by", async () => {
    const { hash } = newToken();
    const id = await createInvite(hash);
    await asUser(user);
    await expect(
      db.query(`update public.admin_invites set claimed_by = $1 where id = $2`, [user, id]),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("the admin role", () => {
  let adminId: string;

  beforeAll(async () => {
    const { hash } = newToken();
    await createInvite(hash);
    adminId = await createAuthUser();
    await asUser(adminId);
    await db.query(`select public.admin_invite_accept($1)`, [hash]);
  });

  it("enters the administration only with aal2", async () => {
    await asUser(adminId, "aal1", crypto.randomUUID());
    expect((await touch()).status).toBe("denied");
    await asUser(adminId);
    expect(await touch()).toMatchObject({ status: "ok", role: "admin" });
    await asUser(owner);
    expect(await touch()).toMatchObject({ status: "ok", role: "owner" });
  });

  it("cannot change AI caps, invite, revoke or remove", async () => {
    await asUser(adminId);
    await expect(
      db.query(
        `select public.admin_set_app_setting('ai_caps', '{"monthly_usd":50,"per_user_usd":null,"warn_percent":80}')`,
      ),
    ).rejects.toThrow(/admin_required/);
    await expect(db.query(`select public.admin_set_ai_user_cap($1, 5, false)`, [user])).rejects.toThrow(
      /admin_required/,
    );
    await expect(db.query(`select public.admin_invite_create($1)`, [newToken().hash])).rejects.toThrow(
      /admin_required/,
    );
    await expect(db.query(`select public.admin_remove($1)`, [owner])).rejects.toThrow(/admin_required/);
  });

  it("cannot write the role table from the client", async () => {
    await asUser(user);
    await expect(
      db.query(`insert into public.user_roles (user_id, role) values ($1, 'admin')`, [user]),
    ).rejects.toThrow(/row-level security|permission denied/);
  });

  it("the owner cannot remove themselves or a non-admin", async () => {
    await asUser(owner);
    await expect(db.query(`select public.admin_remove($1)`, [owner])).rejects.toThrow(/not_removable/);
    await expect(db.query(`select public.admin_remove($1)`, [user])).rejects.toThrow(/not_admin/);
  });

  it("removing an admin ends their session at once and keeps them listed as removed", async () => {
    await asUser(owner);
    await db.query(`select public.admin_remove($1)`, [adminId]);

    await asUser(adminId);
    expect((await touch()).status).toBe("denied");
    await asServer();
    const ended = await one<{ open: number }>(
      `select count(*)::int as open from public.admin_sessions where user_id = $1 and ended_at is null`,
      [adminId],
    );
    expect(ended.open).toBe(0);

    await db.exec(`set role service_role;`);
    const members = await rows<{ user_id: string; role: string; active: boolean; removed_at: Date | null }>(
      `select user_id, role, active, removed_at from public.admin_members()`,
    );
    await asServer();
    expect(members[0]).toMatchObject({ user_id: owner, role: "owner", active: true });
    const removed = members.find((m) => m.user_id === adminId);
    expect(removed).toMatchObject({ role: "admin", active: false });
    expect(removed?.removed_at).not.toBeNull();
  });
});

describe("an account made from an invitation", () => {
  it("gets a profile without onboarding, no workspace and no trial", async () => {
    const id = await createAuthUser({ locale: "cs", admin_invite: true });
    await asServer();
    const profile = await one<{ internal: boolean; onboarded: boolean; toured: boolean }>(
      `select is_internal as internal, onboarding_completed_at is not null as onboarded,
              tour_completed_at is not null as toured from public.profiles where id = $1`,
      [id],
    );
    expect(profile).toEqual({ internal: true, onboarded: true, toured: true });
    const counts = await one<{ stages: number; tables: number; subs: number; roles: number; settings: number }>(
      `select
         (select count(*)::int from public.pipeline_stages where user_id = $1) as stages,
         (select count(*)::int from public.contact_tables where user_id = $1) as tables,
         (select count(*)::int from public.subscriptions where user_id = $1) as subs,
         (select count(*)::int from public.user_roles where user_id = $1) as roles,
         (select count(*)::int from public.user_settings where user_id = $1) as settings`,
      [id],
    );
    expect(counts).toEqual({ stages: 0, tables: 0, subs: 0, roles: 0, settings: 1 });
  });

  it("an ordinary account still gets its workspace and trial", async () => {
    const id = await createAuthUser();
    await asServer();
    const counts = await one<{ stages: number; trial: boolean }>(
      `select (select count(*)::int from public.pipeline_stages where user_id = $1) as stages,
              (select status = 'trialing' from public.subscriptions where user_id = $1) as trial`,
      [id],
    );
    expect(counts.stages).toBeGreaterThan(0);
    expect(counts.trial).toBe(true);
  });
});
