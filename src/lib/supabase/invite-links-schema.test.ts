// @vitest-environment node
//
// Invite links that say why they stopped working, answering an invite from
// its link, asking for a new one and the support form (step 27.1), on every
// migration in PGlite with the same Supabase stubs as worker-invites-schema.test.ts.

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
  created_at timestamptz not null default now(),
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
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid]);
  await db.query(`select set_config('request.headers', '{}', false)`);
  await db.exec(`set role authenticated`);
}
async function asServer() {
  await db.exec(
    `reset role; select set_config('request.jwt.claim.sub', '', false); select set_config('request.headers', '', false);`,
  );
}
async function createAuthUser(email = `${crypto.randomUUID()}@example.com`) {
  await asServer();
  const { id } = await one<{ id: string }>(
    `insert into auth.users (email) values ($1) returning id`,
    [email],
  );
  await db.query(`select initialize_user($1, 'cs')`, [id]);
  await db.query(`select grant_beta_plan($1)`, [id]);
  return id;
}


/** What the owner's own client does: a worker record and a code invite, with the e-mail given. */
async function inviteAs(owner: string, email: string | null, name = "Nový člověk") {
  await asUser(owner);
  const worker = await one<{ id: string }>(
    `insert into workers (owner_id, name, email) values ($1, $2, $3) returning id`,
    [owner, name, email],
  );
  const invite = await one<{ id: string; code: string }>(
    `insert into worker_invites (owner_id, worker_id, email) values ($1, $2, $3) returning id, code`,
    [owner, worker.id, email],
  );
  await asServer();
  return { workerId: worker.id, inviteId: invite.id, code: invite.code };
}

let owner: string;
let person: string;
let other: string;

beforeAll(async () => {
  db = new PGlite({ extensions: PGLITE_EXTENSIONS });
  await db.exec(SUPABASE_STUBS);
  for (const file of readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    await db.exec(readFileSync(path.join(MIGRATIONS_DIR, file), "utf8"));
  }
  owner = await createAuthUser("boss@example.com");
  person = await createAuthUser("Second@Example.com");
  other = await createAuthUser("other@example.com");
}, 120_000);

afterAll(async () => {
  await db?.close();
});

async function inviteRow(id: string) {
  await asServer();
  return one<{ replaced_at: string | null; replaced_by: string | null; accepted_at: string | null }>(
    `select replaced_at, replaced_by, accepted_at from worker_invites where id = $1`,
    [id],
  );
}
async function workerStatus(id: string) {
  await asServer();
  return (await one<{ status: string; user_id: string | null }>(`select status, user_id from workers where id = $1`, [id]));
}

describe("a new invite to the same e-mail", () => {
  it("replaces the older open one and ends its record; the client can not touch the mark", async () => {
    const first = await inviteAs(owner, "new.person@example.com");
    const second = await inviteAs(owner, " New.Person@example.com ");
    const old = await inviteRow(first.inviteId);
    expect(old.replaced_at).not.toBeNull();
    expect(old.replaced_by).toBe(second.inviteId);
    expect((await inviteRow(second.inviteId)).replaced_at).toBeNull();
    expect((await workerStatus(first.workerId)).status).toBe("inactive");
    expect((await workerStatus(second.workerId)).status).toBe("invited");

    await asUser(owner);
    await expect(
      db.query(`update worker_invites set replaced_at = null where id = $1`, [first.inviteId]),
    ).rejects.toThrow(/invite_replacement_is_server_only/);
    await expect(
      db.query(`insert into worker_invites (owner_id, worker_id, replaced_at) values ($1, $2, now())`, [
        owner,
        second.workerId,
      ]),
    ).rejects.toThrow(/invite_replacement_is_server_only/);
    await asServer();

    // The registration refuses the replaced code, takes the new one.
    const someone = await createAuthUser("someone@example.com");
    await expect(db.query(`select accept_worker_invite($1, $2)`, [first.code, someone])).rejects.toThrow(
      /invite_invalid/,
    );
    await db.query(`select accept_worker_invite($1, $2)`, [second.code, someone]);
    expect((await workerStatus(second.workerId)).user_id).toBe(someone);
  });

  it("leaves other owners' invites and other addresses alone", async () => {
    const mine = await inviteAs(owner, "keep@example.com");
    await inviteAs(other, "keep@example.com");
    await inviteAs(owner, "else@example.com");
    expect((await inviteRow(mine.inviteId)).replaced_at).toBeNull();
  });
});

describe("tombstones of invites deleted unused", () => {
  it("say revoked when the owner removes the record, replaced when the link is renewed", async () => {
    await asServer();
    const removed = await inviteAs(owner, "gone@example.com");
    await asUser(owner);
    await db.query(`delete from workers where id = $1`, [removed.workerId]);
    await asServer();
    expect(
      (await one<{ reason: string }>(`select reason from worker_invite_tombstones where code = $1`, [removed.code]))
        .reason,
    ).toBe("revoked");

    // Renewing: the new invite first, then the old one goes (useRenewInvite).
    const renewed = await inviteAs(owner, null);
    await asUser(owner);
    const fresh = await one<{ id: string }>(
      `insert into worker_invites (owner_id, worker_id) values ($1, $2) returning id`,
      [owner, renewed.workerId],
    );
    await db.query(`delete from worker_invites where worker_id = $1 and id <> $2 and accepted_at is null`, [
      renewed.workerId,
      fresh.id,
    ]);
    await asServer();
    expect(
      (await one<{ reason: string }>(`select reason from worker_invite_tombstones where code = $1`, [renewed.code]))
        .reason,
    ).toBe("replaced");
  });

  it("nobody but the server reads them", async () => {
    await asUser(owner);
    await expect(db.query(`select * from worker_invite_tombstones`)).rejects.toThrow();
    await asServer();
  });
});

describe("answering an invite from its link while signed in", () => {
  it("only the account the invite is for, never the owner, and binds it on the way", async () => {
    const invite = await inviteAs(owner, "second@example.com");
    await asUser(owner);
    await expect(db.query(`select worker_invite_respond_code($1, true)`, [invite.code])).rejects.toThrow(
      /invite_self/,
    );
    await asUser(other);
    await expect(db.query(`select worker_invite_respond_code($1, true)`, [invite.code])).rejects.toThrow(
      /invite_other_account/,
    );
    await asUser(person);
    const space = await one<{ space: string }>(`select worker_invite_respond_code($1, true) as space`, [
      ` ${invite.code} `,
    ]);
    expect(space.space).toBe(owner);
    const worker = await workerStatus(invite.workerId);
    expect(worker).toEqual({ status: "active", user_id: person });
    expect((await inviteRow(invite.inviteId)).accepted_at).not.toBeNull();
    // Used: a second time is refused.
    await asUser(person);
    await expect(db.query(`select worker_invite_respond_code($1, true)`, [invite.code])).rejects.toThrow(
      /invite_invalid/,
    );
    await asServer();
  });

  it("an invite naming no e-mail can be accepted by whoever holds the code, never declined", async () => {
    const owner2 = await createAuthUser("owner2@example.com");
    const invite = await inviteAs(owner2, null);
    await asUser(other);
    await expect(db.query(`select worker_invite_respond_code($1, false)`, [invite.code])).rejects.toThrow(
      /invite_other_account/,
    );
    await db.query(`select worker_invite_respond_code($1, true)`, [invite.code]);
    expect((await workerStatus(invite.workerId)).user_id).toBe(other);
  });

  it("anonymous calls are refused", async () => {
    await asServer();
    await db.exec(`set role anon`);
    await expect(db.query(`select worker_invite_respond_code('x', true)`)).rejects.toThrow();
    await asServer();
  });
});

describe("asking for a new invite", () => {
  it("notifies the owner once a day per invite; unknown codes nothing; server only", async () => {
    const invite = await inviteAs(owner, "ask@example.com");
    await asUser(person);
    await expect(db.query(`select worker_invite_request_new($1)`, [invite.code])).rejects.toThrow();
    await asServer();
    const ask = async (code: string) =>
      (await one<{ r: string }>(`select worker_invite_request_new($1) as r`, [code])).r;
    expect(await ask(invite.code)).toBe("sent");
    expect(await ask(invite.code)).toBe("already");
    expect(await ask("ffffffffffffffffffff")).toBe("unknown");
    const notes = await rows<{ kind: string; worker_id: string }>(
      `select kind, worker_id from account_notifications where user_id = $1 and kind = 'invite_requested'`,
      [owner],
    );
    expect(notes).toEqual([{ kind: "invite_requested", worker_id: invite.workerId }]);
  });
});

describe("support requests", () => {
  it("are written by the server with the per-address limit, never by a client", async () => {
    await asServer();
    const send = async (ip: string) =>
      (
        await one<{ id: string | null }>(
          `select bug_report_support(null, $1, 'bug', '/podpora', 'Nejde mi přihlášení', null, 'Who@Example.com', null, null, null, 'cs', null, 20, 2) as id`,
          [ip],
        )
      ).id;
    const firstId = await send("aaaaaaaaaaaaaaaa");
    expect(firstId).toBeTruthy();
    expect(await send("aaaaaaaaaaaaaaaa")).toBeTruthy();
    expect(await send("aaaaaaaaaaaaaaaa")).toBeNull();
    expect(await send("bbbbbbbbbbbbbbbb")).toBeTruthy();
    const row = await one<{ source: string; contact_email: string }>(
      `select source, contact_email from bug_reports where id = $1`,
      [firstId],
    );
    expect(row).toEqual({ source: "support", contact_email: "who@example.com" });
    await expect(
      db.query(`select bug_report_support(null, 'cccccccccccccccc', 'bug', '/podpora', '   ')`),
    ).rejects.toThrow();
    await asUser(person);
    await expect(
      db.query(`select bug_report_support(null, 'dddddddddddddddd', 'bug', '/podpora', 'x')`),
    ).rejects.toThrow();
    await asServer();
  });
});
