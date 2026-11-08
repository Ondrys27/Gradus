// @vitest-environment node
//
// Invites by short id or e-mail, leaving a company, who pays for a worker and
// AI spend by space (step 22.5), on every migration in PGlite with the same
// Supabase stubs as spaces-schema.test.ts.

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

/** What the owner's own client does: a worker record and a code invite. */
async function inviteAs(owner: string, name = "Nový člověk") {
  await asUser(owner);
  const worker = await one<{ id: string }>(
    `insert into workers (owner_id, name) values ($1, $2) returning id`,
    [owner, name],
  );
  const invite = await one<{ id: string; code: string }>(
    `insert into worker_invites (owner_id, worker_id) values ($1, $2) returning id, code`,
    [owner, worker.id],
  );
  await asServer();
  return { workerId: worker.id, inviteId: invite.id, code: invite.code };
}

async function bind(owner: string, invite: string, invitee: string) {
  await asServer();
  return (
    await one<{ result: string }>(`select worker_invite_bind($1, $2, $3) as result`, [owner, invite, invitee])
  ).result;
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
  owner = await createAuthUser();
  person = await createAuthUser("Person@Example.com");
  other = await createAuthUser();
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe("finding an account to invite", () => {
  it("by short id and by e-mail, for the server only", async () => {
    await asServer();
    const { public_id } = await one<{ public_id: string }>(`select public_id from profiles where id = $1`, [person]);
    expect(
      (await one<{ id: string }>(`select account_by_public_id($1) as id`, [` ${public_id.toLowerCase()} `])).id,
    ).toBe(person);
    expect((await one<{ id: string }>(`select account_by_email($1) as id`, [" person@example.COM "])).id).toBe(
      person,
    );
    expect((await one<{ id: string | null }>(`select account_by_email('nobody@example.com') as id`)).id).toBeNull();
    await asUser(owner);
    await expect(db.query(`select account_by_email('person@example.com')`)).rejects.toThrow();
    await expect(db.query(`select account_by_public_id('ABCDEF')`)).rejects.toThrow();
    await asServer();
  });
});

describe("an invite for an existing account", () => {
  it("only the server binds it; the client can neither name an account nor answer", async () => {
    const { workerId, inviteId } = await inviteAs(owner);
    await asUser(owner);
    await expect(
      db.query(`insert into worker_invites (owner_id, worker_id, invitee_id) values ($1, $2, $3)`, [
        owner,
        workerId,
        person,
      ]),
    ).rejects.toThrow(/invite_account_is_server_only/);
    await expect(
      db.query(`update worker_invites set invitee_id = $2 where id = $1`, [inviteId, person]),
    ).rejects.toThrow(/invite_account_is_server_only/);
    await expect(db.query(`select worker_invite_bind($1, $2, $3)`, [owner, inviteId, person])).rejects.toThrow();
    await asServer();
    expect(await bind(owner, inviteId, owner)).toBe("self");
    expect(await bind(other, inviteId, person)).toBe("invalid");
    expect(await bind(owner, inviteId, person)).toBe("bound");
    expect(await bind(owner, inviteId, person)).toBe("invalid");
    // A second open invite of the same company for the same account.
    const second = await inviteAs(owner);
    expect(await bind(owner, second.inviteId, person)).toBe("already_member");
  });

  it("the invitee sees it with the company and rights, nobody else does", async () => {
    await asServer();
    await db.query(`update profiles set company_name = 'Novák s.r.o.', display_name = 'Václav Novák' where id = $1`, [
      owner,
    ]);
    await asUser(person);
    const mine = await rows<{ company_name: string; owner_name: string; space_id: string }>(
      `select * from my_worker_invites()`,
    );
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ company_name: "Novák s.r.o.", owner_name: "Václav Novák", space_id: owner });
    await asUser(other);
    expect(await rows(`select * from my_worker_invites()`)).toHaveLength(0);
    // The invite table itself stays the owner's.
    expect(await rows(`select 1 from worker_invites`)).toHaveLength(0);
    await asServer();
  });

  it("accepting makes the account an active member, the owner hears it", async () => {
    await asUser(person);
    const [invite] = await rows<{ invite_id: string }>(`select invite_id from my_worker_invites()`);
    // Somebody else can not answer it.
    await asUser(other);
    await expect(db.query(`select worker_invite_respond($1, true)`, [invite.invite_id])).rejects.toThrow(
      /invite_invalid/,
    );
    await asUser(person);
    const { space } = await one<{ space: string }>(`select worker_invite_respond($1, true) as space`, [
      invite.invite_id,
    ]);
    expect(space).toBe(owner);
    await expect(db.query(`select worker_invite_respond($1, true)`, [invite.invite_id])).rejects.toThrow(
      /invite_invalid/,
    );
    const spaces = await rows<{ space_id: string }>(`select space_id from my_spaces()`);
    expect(spaces.map((s) => s.space_id)).toContain(owner);
    await asUser(owner);
    const notes = await rows<{ kind: string }>(`select kind from account_notifications`);
    expect(notes.map((n) => n.kind)).toEqual(["invite_accepted"]);
    // Read only through the function; no client writes.
    await expect(db.query(`insert into account_notifications (user_id, kind) values ($1, 'worker_left')`, [owner]))
      .rejects.toThrow();
    const updated = await db
      .query(`update account_notifications set read_at = now()`)
      .catch(() => ({ affectedRows: 0 }));
    expect(updated.affectedRows ?? 0).toBe(0);
    expect((await one<{ n: number }>(`select account_notifications_read() as n`)).n).toBe(1);
    expect(await rows(`select 1 from account_notifications where read_at is null`)).toHaveLength(0);
    await asUser(person);
    expect(await rows(`select 1 from account_notifications`)).toHaveLength(0);
    await asServer();
  });

  it("declining ends the record; the owner sees it declined", async () => {
    const { inviteId, workerId } = await inviteAs(owner, "Odmítne");
    expect(await bind(owner, inviteId, other)).toBe("bound");
    await asUser(other);
    await db.query(`select worker_invite_respond($1, false)`, [inviteId]);
    await asServer();
    expect((await one<{ status: string }>(`select status from workers where id = $1`, [workerId])).status).toBe(
      "inactive",
    );
    const seats = await rows<{ worker_id: string; declined: boolean }>(`select * from worker_seats($1)`, [owner]);
    expect(seats.find((s) => s.worker_id === workerId)?.declined).toBe(true);
  });

  it("leaving: the record ends, the membership says left, the owner hears it", async () => {
    await asUser(other);
    await expect(db.query(`select space_leave($1)`, [owner])).rejects.toThrow(/not_member/);
    await asUser(person);
    await db.query(`select space_leave($1)`, [owner]);
    expect((await rows<{ space_id: string }>(`select space_id from my_spaces()`)).map((s) => s.space_id)).not.toContain(
      owner,
    );
    await asServer();
    expect(
      (await one<{ status: string }>(`select status from memberships where user_id = $1 and space_id = $2`, [
        person,
        owner,
      ])).status,
    ).toBe("left");
    expect(
      (await rows<{ kind: string }>(`select kind from account_notifications where user_id = $1 order by created_at`, [
        owner,
      ])).map((n) => n.kind),
    ).toContain("worker_left");
  });

  it("invited again after leaving: accepting takes the account over to the new record", async () => {
    const { inviteId, workerId } = await inviteAs(owner, "Znovu");
    expect(await bind(owner, inviteId, person)).toBe("bound");
    await asUser(person);
    await db.query(`select worker_invite_respond($1, true)`, [inviteId]);
    await asServer();
    expect(
      (await rows<{ id: string }>(`select id from workers where owner_id = $1 and user_id = $2`, [owner, person])).map(
        (w) => w.id,
      ),
    ).toEqual([workerId]);
    expect(
      (await one<{ status: string; worker_id: string }>(
        `select status, worker_id from memberships where user_id = $1 and space_id = $2`,
        [person, owner],
      )),
    ).toMatchObject({ status: "active", worker_id: workerId });
  });
});

describe("who pays for a worker", () => {
  it("a worker with a valid plan of their own is free; one from an invite is not", async () => {
    const fresh = await createAuthUser();
    await asServer();
    await db.query(`select grant_worker_plan($1)`, [fresh]);
    const { id: workerId } = await one<{ id: string }>(
      `insert into workers (owner_id, user_id, name, status) values ($1, $2, 'Z pozvánky', 'active') returning id`,
      [owner, fresh],
    );
    const seats = await rows<{ worker_id: string; own_plan: boolean }>(`select * from worker_seats($1)`, [owner]);
    expect(seats.find((s) => s.worker_id === workerId)?.own_plan).toBe(false);
    const accepted = await rows<{ user_id: string }>(
      `select user_id from workers where owner_id = $1 and user_id = $2`,
      [owner, person],
    );
    expect(accepted).toHaveLength(1);
    // The person registered with a beta code: a plan of their own.
    const ofPerson = await one<{ own_plan: boolean }>(
      `select s.own_plan from worker_seats($1) s join workers w on w.id = s.worker_id where w.user_id = $2`,
      [owner, person],
    );
    expect(ofPerson.own_plan).toBe(true);

    // Another plan is their own from then on.
    await db.query(`update subscriptions set plan_key = 'pro' where user_id = $1`, [fresh]);
    expect(
      (await one<{ v: boolean }>(`select via_worker_invite as v from subscriptions where user_id = $1`, [fresh])).v,
    ).toBe(false);
    expect((await one<{ own: boolean }>(`select account_has_own_plan($1) as own`, [fresh])).own).toBe(true);
    // An ended trial is no plan of their own.
    await db.query(
      `update subscriptions set status = 'trialing', trial_ends_at = now() - interval '1 day' where user_id = $1`,
      [fresh],
    );
    expect((await one<{ own: boolean }>(`select account_has_own_plan($1) as own`, [fresh])).own).toBe(false);
  });

  it("only the owner reads the seats of their company", async () => {
    await asUser(other);
    await expect(db.query(`select * from worker_seats($1)`, [owner])).rejects.toThrow();
    await asUser(owner);
    expect((await rows(`select * from worker_seats($1)`, [owner])).length).toBeGreaterThan(0);
    await asServer();
  });

  it("beta carries the price per extra worker; the catalog accepts included_workers", async () => {
    await asServer();
    const beta = await one<{ included_workers: number; per_worker: { CZK: number } }>(
      `select included_workers, per_worker from plans where key = 'beta'`,
    );
    expect(beta).toMatchObject({ included_workers: 0, per_worker: { CZK: 290, EUR: 12 } });
    const draft = await one<{ payload: Array<Record<string, unknown>> }>(
      `select payload from plan_catalog_versions where status = 'draft'`,
    );
    const byKey = Object.fromEntries(draft.payload.map((plan) => [plan.key, plan]));
    expect(byKey.solo).toMatchObject({ included_workers: 0, per_worker: null });
    expect(byKey.pro).toMatchObject({ included_workers: 0, per_worker: { CZK: 290, EUR: 12 } });
    expect(byKey.team).toMatchObject({ included_workers: 10, per_worker: { CZK: 290, EUR: 12 } });
    const bad = draft.payload.map((plan) => (plan.key === "team" ? { ...plan, included_workers: -1 } : plan));
    expect((await one<{ ok: boolean }>(`select valid_plan_catalog($1::jsonb) as ok`, [JSON.stringify(bad)])).ok).toBe(
      false,
    );
  });
});

describe("AI spend by space", () => {
  it("a call without a space is the account's own; a space sums everybody's calls in it", async () => {
    await asServer();
    await db.query(
      `insert into ai_usage (user_id, purpose, model, input_tokens, output_tokens) values ($1, 'chat', 'x', 1, 1)`,
      [owner],
    );
    await db.query(
      `insert into ai_usage (user_id, space_id, purpose, model, input_tokens, output_tokens) values ($1, $2, 'chat', 'x', 1, 1)`,
      [person, owner],
    );
    const spaces = await rows<{ space_id: string }>(`select space_id from ai_usage order by created_at`);
    expect(spaces.map((s) => s.space_id)).toEqual([owner, owner]);
    expect(
      Number((await one<{ n: number }>(`select jarvis_space_calls($1, $2, now() - interval '1 day') as n`, [person, owner])).n),
    ).toBe(1);
    expect(
      Number((await one<{ n: number }>(`select jarvis_space_calls($1, $2, now() - interval '1 day') as n`, [person, person])).n),
    ).toBe(0);
    await asUser(owner);
    await expect(db.query(`select jarvis_space_month_spend($1, now())`, [owner])).rejects.toThrow();
    await asServer();
  });
});
