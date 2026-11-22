// @vitest-environment node
//
// Company members and invites (28.1) on the real migrations (PGlite): the one
// list of active members, group memberships ending with the worker, the
// username rules (one change in 30 days, the old one reserved) and the exact,
// limited lookup of somebody to invite.

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
let owner: string;
let stranger: string;
let accountActive: string;
let accountLeft: string;
const ids: Record<string, string> = {};

async function as<T>(uid: string, run: () => Promise<T>): Promise<T> {
  await db.exec(
    `select set_config('request.jwt.claim.sub', '${uid}', false); set role authenticated;`,
  );
  try {
    return await run();
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
  }
}
async function rows<T = Row>(sql: string, params?: unknown[]): Promise<T[]> {
  return (await db.query<T>(sql, params as never)).rows;
}
async function createAuthUser() {
  const [row] = await rows<{ id: string }>(
    `insert into auth.users (email, raw_user_meta_data) values ($1, '{"locale":"cs"}') returning id`,
    [`${crypto.randomUUID()}@example.com`],
  );
  return row!.id;
}
async function addWorker(ownerId: string, name: string, account: string | null, status: string) {
  const [row] = await rows<{ id: string }>(
    `insert into workers (owner_id, user_id, name, status) values ($1, $2, $3, $4) returning id`,
    [ownerId, account, name, status],
  );
  return row!.id;
}
const members = (uid: string, space: string) =>
  as(uid, () =>
    rows<{ user_id: string; worker_id: string | null; is_owner: boolean; name: string }>(
      `select user_id, worker_id, is_owner, name from active_members($1)`,
      [space],
    ),
  );

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
  accountActive = await createAuthUser();
  accountLeft = await createAuthUser();
  await db.query(`update profiles set display_name = 'Majitel' where id = $1`, [owner]);
  ids.active = await addWorker(owner, "Aktivní", accountActive, "active");
  ids.invited = await addWorker(owner, "Pozvaný", null, "invited");
  ids.left = await addWorker(owner, "Bývalý", accountLeft, "active");
  await db.query(`update workers set status = 'inactive' where id = $1`, [ids.left]);
});

afterAll(async () => {
  await db?.close();
});

describe("active_members", () => {
  it("lists the owner and the active workers only, owner first", async () => {
    const list = await members(owner, owner);
    expect(list.map((row) => row.name)).toEqual(["Majitel", "Aktivní"]);
    expect(list[0]!.is_owner).toBe(true);
    expect(list[1]!.worker_id).toBe(ids.active);
  });

  it("is the same list for an active worker of the space", async () => {
    const list = await members(accountActive, owner);
    expect(list.map((row) => row.user_id)).toEqual([owner, accountActive]);
  });

  it("is empty for a stranger and for a worker who left", async () => {
    expect(await members(stranger, owner)).toEqual([]);
    expect(await members(accountLeft, owner)).toEqual([]);
  });
});

describe("group memberships end with the worker", () => {
  it("drops the groups of a worker who becomes inactive", async () => {
    const [group] = await as(owner, () =>
      rows<{ id: string }>(`insert into worker_groups (name, color) values ('Tým', 'teal') returning id`),
    );
    await as(owner, () =>
      db.query(`insert into worker_group_members (group_id, worker_id) values ($1, $2), ($1, $3)`, [
        group!.id,
        ids.active,
        ids.invited,
      ]),
    );
    await db.query(`update workers set status = 'inactive' where id = $1`, [ids.invited]);
    const left = await rows<{ worker_id: string }>(
      `select worker_id from worker_group_members where group_id = $1`,
      [group!.id],
    );
    expect(left.map((row) => row.worker_id)).toEqual([ids.active]);
    await expect(
      as(owner, () =>
        db.query(`insert into worker_group_members (group_id, worker_id) values ($1, $2)`, [group!.id, ids.left]),
      ),
    ).rejects.toThrow(/worker_inactive/);
  });

  it("puts nobody under a worker who left", async () => {
    await expect(
      as(owner, () => db.query(`update workers set manager_id = $2 where id = $1`, [ids.active, ids.left])),
    ).rejects.toThrow(/worker_inactive/);
  });
});

describe("usernames", () => {
  const setName = (uid: string, name: string | null) =>
    as(uid, () => db.query(`update profiles set username = $2 where id = $1`, [uid, name]));

  it("sets the first username freely and then waits 30 days for a change", async () => {
    await setName(accountActive, "jana.n");
    await setName(accountActive, "jana_n");
    await expect(setName(accountActive, "jana")).rejects.toThrow(/username_cooldown/);
    const [row] = await rows<{ username: string; username_changed_at: string | null }>(
      `select username, username_changed_at from profiles where id = $1`,
      [accountActive],
    );
    expect(row!.username).toBe("jana_n");
    expect(row!.username_changed_at).not.toBeNull();
  });

  it("keeps the change stamp out of the client's hands", async () => {
    await as(accountActive, () =>
      db.query(`update profiles set username_changed_at = null where id = $1`, [accountActive]),
    );
    await expect(setName(accountActive, "jana")).rejects.toThrow(/username_cooldown/);
  });

  it("reserves the old name for 30 days for its owner only", async () => {
    await expect(setName(stranger, "jana.n")).rejects.toThrow(/username_reserved/);
    const [available] = await as(stranger, () =>
      rows<{ ok: boolean }>(`select username_available('jana.n') as ok`),
    );
    expect(available!.ok).toBe(false);
    const [own] = await as(accountActive, () =>
      rows<{ ok: boolean }>(`select username_available('jana.n') as ok`),
    );
    expect(own!.ok).toBe(true);
  });

  it("lets the server change it anyway (no session)", async () => {
    await db.query(`update profiles set username = 'jana' where id = $1`, [accountActive]);
    const [row] = await rows<{ username: string }>(`select username from profiles where id = $1`, [
      accountActive,
    ]);
    expect(row!.username).toBe("jana");
  });
});

describe("invite_account_lookup", () => {
  const lookup = async (actor: string, value: string) => {
    const [row] = await rows<{ result: Record<string, unknown> }>(
      `select invite_account_lookup($1, $2) as result`,
      [actor, value],
    );
    return row!.result;
  };

  it("finds by the exact @username or short id, never by part of it", async () => {
    await db.query(`update profiles set username = 'karel.k', display_name = 'Karel' where id = $1`, [
      stranger,
    ]);
    const [{ public_id }] = await rows<{ public_id: string }>(`select public_id from profiles where id = $1`, [
      stranger,
    ]);
    expect(await lookup(owner, "@Karel.K")).toMatchObject({ outcome: "found", id: stranger, name: "Karel", username: "karel.k" });
    expect(await lookup(owner, "karel.k")).toMatchObject({ outcome: "found", id: stranger });
    expect(await lookup(owner, public_id.toLowerCase())).toMatchObject({ outcome: "found", id: stranger });
    expect(await lookup(owner, "@karel")).toEqual({ outcome: "not_found" });
    expect(await lookup(owner, "kar%")).toEqual({ outcome: "invalid" });
  });

  it("stops after 10 misses in an hour", async () => {
    const actor = await createAuthUser();
    for (let i = 0; i < 10; i++) {
      expect(await lookup(actor, `@nobody${i}`)).toEqual({ outcome: "not_found" });
    }
    expect(await lookup(actor, "@karel.k")).toEqual({ outcome: "limited" });
  });

  it("is for the server only", async () => {
    await expect(as(owner, () => db.query(`select invite_account_lookup($1, 'karel.k')`, [owner]))).rejects.toThrow(
      /permission denied/,
    );
    await expect(as(owner, () => db.query(`select * from account_lookup_attempts`))).rejects.toThrow(
      /permission denied/,
    );
    await expect(as(owner, () => db.query(`select * from username_reservations`))).rejects.toThrow(
      /permission denied/,
    );
  });
});

describe("worker billing switch", () => {
  it("accepts only { visible: boolean }", async () => {
    const check = async (value: string) =>
      (await rows<{ ok: boolean }>(`select valid_worker_billing($1::jsonb) as ok`, [value]))[0]!.ok;
    expect(await check('{"visible":false}')).toBe(true);
    expect(await check('{"visible":"yes"}')).toBe(false);
    expect(await check('{"visible":true,"x":1}')).toBe(false);
  });
});
