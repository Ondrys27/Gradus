// @vitest-environment node
//
// Worker dashboard (19.3) on the real migrations (PGlite): names stay in sync,
// the fine rights live in worker_permission_grants and keep worker_permissions
// (the older coarse view / edit) in step both ways, the restrictive policies
// hold a worker to their actions, Company reads and changes people by its own
// rights, removing a worker ends their access and hands their work over, and
// documents belong to the owner and the person only.

import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PERMISSION_CATALOG,
  WORKER_DOCUMENT_MIMES,
  actionKind,
} from "@/features/workers/permissions-catalog";
import { PGLITE_EXTENSIONS } from "./pglite-extensions";

const MIGRATIONS_DIR = path.resolve(__dirname, "../../../supabase/migrations");
const MIGRATION = path.join(MIGRATIONS_DIR, "20261103200000_worker_dashboard.sql");

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
/** Accounts and worker rows. */
let manager: string;
let managerId: string;
let seller: string;
let sellerId: string;
let helper: string;
let helperId: string;

async function rows<T = Row>(sql: string, params?: unknown[]): Promise<T[]> {
  return (await db.query<T>(sql, params as never)).rows;
}
async function one<T = Row>(sql: string, params?: unknown[]): Promise<T> {
  return (await rows<T>(sql, params))[0] as T;
}
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
async function createAuthUser() {
  const { id } = await one<{ id: string }>(
    `insert into auth.users (email, raw_user_meta_data) values ($1, '{"locale":"cs"}') returning id`,
    [`${crypto.randomUUID()}@example.com`],
  );
  return id;
}
async function addWorker(account: string | null, name: string, managerOf: string | null = null) {
  const { id } = await one<{ id: string }>(
    `insert into workers (owner_id, user_id, name, status, manager_id)
     values ($1, $2, $3, $4, $5) returning id`,
    [owner, account, name, account ? "active" : "invited", managerOf],
  );
  return id;
}
/** Sets exactly these actions (and nothing else) for a worker, as the owner does. */
async function grant(workerId: string, actions: Record<string, string[]>) {
  await as(owner, async () => {
    await db.query(
      `insert into worker_permission_grants (owner_id, worker_id, section, action, allowed)
       select $1, $2, c.section, c.action, coalesce((($3::jsonb) -> c.section) ? c.action, false)
       from permission_catalog() c
       on conflict (worker_id, section, action) do update set allowed = excluded.allowed`,
      [owner, workerId, JSON.stringify(actions)],
    );
  });
}
async function coarse(workerId: string) {
  const list = await rows<{ section: string; can_view: boolean; can_edit: boolean }>(
    `select section::text, can_view, can_edit from worker_permissions where worker_id = $1`,
    [workerId],
  );
  return Object.fromEntries(list.map((r) => [r.section, [r.can_view, r.can_edit]]));
}
async function allowed(workerId: string) {
  const list = await rows<{ key: string }>(
    `select section || '.' || action as key from worker_permission_grants
     where worker_id = $1 and allowed order by 1`,
    [workerId],
  );
  return list.map((r) => r.key);
}
async function firstStage(uid: string, won = false) {
  return one<{ id: string }>(
    `select id from pipeline_stages where user_id = $1 and is_won = $2 and not is_lost
     order by position limit 1`,
    [uid, won],
  );
}
async function addDeal(title: string, assignee: string | null) {
  const stage = await firstStage(owner);
  return one<{ id: string }>(
    `insert into deals (user_id, stage_id, title, value, assignee_id)
     values ($1, $2, $3, 1000, $4) returning id`,
    [owner, stage.id, title, assignee ?? owner],
  );
}
async function count(sql: string, params?: unknown[]) {
  return (await rows(sql, params)).length;
}

beforeAll(async () => {
  db = new PGlite({ extensions: PGLITE_EXTENSIONS });
  await db.exec(SUPABASE_STUBS);
  for (const file of readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    await db.exec(readFileSync(path.join(MIGRATIONS_DIR, file), "utf8"));
  }
  await createAuthUser();
  owner = await createAuthUser();
  stranger = await createAuthUser();
  manager = await createAuthUser();
  seller = await createAuthUser();
  helper = await createAuthUser();
  managerId = await addWorker(manager, "Marta Vedoucí");
  sellerId = await addWorker(seller, "Petr Prodejce", managerId);
  helperId = await addWorker(helper, "Hana Pomocná");
});

afterAll(async () => {
  await db?.close();
});

describe("the catalog", () => {
  it("is the same in the database and in the app", async () => {
    const stored = await rows<{ section: string; action: string; kind: string }>(
      `select section, action, kind from permission_catalog() order by section, action`,
    );
    const expected = PERMISSION_CATALOG.flatMap((section) =>
      section.actions.map((action) => ({
        section: section.key,
        action: action.key,
        kind: actionKind(section.key, action.key),
      })),
    ).sort((a, b) =>
      a.section === b.section
        ? a.action < b.action
          ? -1
          : 1
        : a.section < b.section
          ? -1
          : 1,
    );
    expect(stored).toEqual(expected);
  });

  it("allows the same document types as the bucket and the table", async () => {
    const bucket = await one<{ allowed_mime_types: string[] }>(
      `select allowed_mime_types from storage.buckets where id = 'worker-documents'`,
    );
    expect([...bucket.allowed_mime_types].sort()).toEqual([...WORKER_DOCUMENT_MIMES].sort());
    const sql = readFileSync(MIGRATION, "utf8");
    for (const mime of WORKER_DOCUMENT_MIMES) expect(sql).toContain(`'${mime}'`);
  });
});

describe("names", () => {
  it("splits a name written as one and joins first and last name", async () => {
    const id = await addWorker(null, "Jana Marie Nováková");
    const split = await one(`select first_name, last_name, name from workers where id = $1`, [id]);
    expect(split).toEqual({ first_name: "Jana", last_name: "Marie Nováková", name: "Jana Marie Nováková" });

    await db.query(`update workers set last_name = 'Dvořáková' where id = $1`, [id]);
    expect(await one(`select name from workers where id = $1`, [id])).toEqual({
      name: "Jana Dvořáková",
    });
    await db.query(`update workers set name = 'Eva Malá' where id = $1`, [id]);
    expect(await one(`select first_name, last_name from workers where id = $1`, [id])).toEqual({
      first_name: "Eva",
      last_name: "Malá",
    });
  });

  it("takes only its own photo from the worker-avatars bucket", async () => {
    const good = `https://x.supabase.co/storage/v1/object/public/worker-avatars/${owner}/${helperId}/avatar.jpg?v=12`;
    await db.query(`update workers set avatar_url = $2 where id = $1`, [helperId, good]);
    await expect(
      db.query(`update workers set avatar_url = 'https://evil.example/pixel.gif' where id = $1`, [
        helperId,
      ]),
    ).rejects.toThrow(/worker_avatar_invalid/);
    const other = good.replace(helperId, sellerId);
    await expect(
      db.query(`update workers set avatar_url = $2 where id = $1`, [helperId, other]),
    ).rejects.toThrow(/worker_avatar_invalid/);
  });
});

describe("grants and the older rights", () => {
  it("derives view / edit from the grants", async () => {
    await grant(helperId, { pipeline: ["view", "change_stage"], finance: [], invoices: ["view"] });
    expect(await coarse(helperId)).toMatchObject({
      pipeline: [true, true],
      finance: [true, false],
      contacts: [false, false],
    });
    // An action without "view" opens nothing.
    await grant(helperId, { contacts: ["create"] });
    expect(await coarse(helperId)).toMatchObject({ contacts: [false, false] });
    expect(await as(helper, () => one(`select has_permission($1, 'contacts', 'create') as ok`, [owner])))
      .toEqual({ ok: false });
  });

  it("mirrors an older direct write into the grants, extras left out", async () => {
    await db.query(
      `insert into worker_permissions (owner_id, worker_id, section, can_view, can_edit)
       values ($1, $2, 'cold_calling', true, true)
       on conflict (worker_id, section) do update set can_view = true, can_edit = true`,
      [owner, helperId],
    );
    const keys = await allowed(helperId);
    expect(keys).toEqual(expect.arrayContaining(["cold_calling.call", "cold_calling.view"]));
    expect(keys).not.toContain("cold_calling.view_others_stats");
    // Tasks follow: editing a section with tasks lets them create and assign tasks.
    expect(keys).toEqual(
      expect.arrayContaining(["tasks.create", "tasks.assign_others", "tasks.view_all"]),
    );

    await db.query(
      `update worker_permissions set can_edit = false where worker_id = $1 and section = 'cold_calling'`,
      [helperId],
    );
    expect(await allowed(helperId)).not.toContain("cold_calling.call");
  });

  it("is the owner's to write and the worker's own to read", async () => {
    await expect(
      as(helper, () =>
        db.query(
          `insert into worker_permission_grants (owner_id, worker_id, section, action, allowed)
           values ($1, $2, 'finance', 'write', true)`,
          [owner, helperId],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
    expect(
      await as(helper, () => count(`select 1 from worker_permission_grants where worker_id = $1`, [helperId])),
    ).toBeGreaterThan(0);
    expect(
      await as(seller, () => count(`select 1 from worker_permission_grants where worker_id = $1`, [helperId])),
    ).toBe(0);
    await expect(
      db.query(
        `insert into worker_permission_grants (owner_id, worker_id, section, action, allowed)
         values ($1, $2, 'finance', 'fly', true)`,
        [owner, helperId],
      ),
    ).rejects.toThrow(/worker_permission_grants_known/);
  });
});

describe("pipeline: all or own, and what may change", () => {
  it("shows a worker only the deals in their care without 'all deals'", async () => {
    await grant(sellerId, { pipeline: ["view", "update", "change_stage"] });
    const mine = await addDeal("Mine", seller);
    await addDeal("Someone else's", owner);
    const seen = await as(seller, () => rows<{ id: string }>(`select id from deals`));
    expect(seen.map((r) => r.id)).toEqual([mine.id]);

    await grant(sellerId, { pipeline: ["view", "view_all", "update", "change_stage"] });
    expect(await as(seller, () => count(`select 1 from deals`))).toBeGreaterThan(1);
  });

  it("moves a deal with 'stage' but changes the amount only with 'amount'", async () => {
    await grant(sellerId, { pipeline: ["view", "change_stage"] });
    const deal = await addDeal("Stage only", seller);
    const won = await firstStage(owner, true);
    await as(seller, () =>
      db.query(`update deals set stage_id = $2 where id = $1`, [deal.id, won.id]),
    );
    await expect(
      as(seller, () => db.query(`update deals set value = 5 where id = $1`, [deal.id])),
    ).rejects.toThrow(/deal_change_amount_denied/);
    await expect(
      as(seller, () => db.query(`update deals set title = 'Renamed' where id = $1`, [deal.id])),
    ).rejects.toThrow(/deal_update_denied/);
  });

  it("creates and deletes only with those rights", async () => {
    const stage = await firstStage(owner);
    await grant(sellerId, { pipeline: ["view", "update"] });
    await expect(
      as(seller, () =>
        db.query(`insert into deals (user_id, stage_id, title) values ($1, $2, 'New')`, [
          owner,
          stage.id,
        ]),
      ),
    ).rejects.toThrow(/row-level security/);
    const deal = await addDeal("Keep", seller);
    await as(seller, () => db.query(`delete from deals where id = $1`, [deal.id]));
    expect(await count(`select 1 from deals where id = $1`, [deal.id])).toBe(1);

    await grant(sellerId, { pipeline: ["view", "create", "delete"] });
    await as(seller, () =>
      db.query(`insert into deals (user_id, stage_id, title) values ($1, $2, 'New')`, [
        owner,
        stage.id,
      ]),
    );
    await as(seller, () => db.query(`delete from deals where id = $1`, [deal.id]));
    expect(await count(`select 1 from deals where id = $1`, [deal.id])).toBe(0);
  });
});

describe("contacts, tasks, calendar, finance", () => {
  it("creates, changes and deletes contacts by their own rights", async () => {
    await grant(helperId, { contacts: ["view", "create"] });
    const contact = await as(helper, () =>
      one<{ id: string }>(
        `insert into contacts (user_id, company_name) values ($1, 'Pekárna') returning id`,
        [owner],
      ),
    );
    await as(helper, () =>
      db.query(`update contacts set company_name = 'X' where id = $1`, [contact.id]),
    );
    expect(await one(`select company_name from contacts where id = $1`, [contact.id])).toEqual({
      company_name: "Pekárna",
    });
    await as(helper, () => db.query(`delete from contacts where id = $1`, [contact.id]));
    expect(await count(`select 1 from contacts where id = $1`, [contact.id])).toBe(1);
  });

  it("gives a task to someone else only with 'assign to others'", async () => {
    await grant(sellerId, { pipeline: ["view", "view_all"], tasks: ["view", "view_all", "create"] });
    const deal = await addDeal("Tasks", seller);
    const insert = (assignee: string) =>
      as(seller, () =>
        db.query(
          `insert into crm_tasks (user_id, title, due_at, deal_id, assignee_id)
           values ($1, 'Call', now() + interval '1 day', $2, $3)`,
          [owner, deal.id, assignee],
        ),
      );
    await insert(seller);
    await expect(insert(owner)).rejects.toThrow(/crm_task_assign_denied/);
    await grant(sellerId, {
      pipeline: ["view", "view_all"],
      tasks: ["view", "view_all", "create", "assign_others"],
    });
    await insert(owner);
  });

  it("shows only the worker's own tasks without 'all tasks'", async () => {
    const deal = await addDeal("Shared", seller);
    await db.query(
      `insert into crm_tasks (user_id, title, due_at, deal_id, assignee_id, created_by)
       values ($1, 'Owner task', now(), $2, $1, $1), ($1, 'Seller task', now(), $2, $3, $1)`,
      [owner, deal.id, seller],
    );
    await grant(sellerId, { pipeline: ["view", "view_all"], tasks: ["view"] });
    const titles = await as(seller, () =>
      rows<{ title: string }>(`select title from crm_tasks where deal_id = $1`, [deal.id]),
    );
    expect(titles.map((r) => r.title)).toEqual(["Seller task"]);
  });

  it("keeps calendar events to the worker's own without 'all events'", async () => {
    await db.query(
      `insert into calendar_events (user_id, title, starts_at, actor_id) values ($1, 'Owner event', now(), $1)`,
      [owner],
    );
    await grant(helperId, { calendar: ["view", "create"] });
    await as(helper, () =>
      db.query(`insert into calendar_events (user_id, title, starts_at) values ($1, 'Mine', now())`, [
        owner,
      ]),
    );
    const titles = await as(helper, () => rows<{ title: string }>(`select title from calendar_events`));
    expect(titles.map((r) => r.title)).toEqual(["Mine"]);
  });

  it("reads finance with 'view' and writes it only with 'write'", async () => {
    await db.query(
      `insert into transactions (user_id, amount, occurred_on, type) values ($1, 100, current_date, 'income')`,
      [owner],
    );
    const ownerRows = () => count(`select 1 from transactions where user_id = $1`, [owner]);
    await grant(helperId, { invoices: ["view"] });
    expect(await as(helper, ownerRows)).toBe(0);
    await grant(helperId, { finance: ["view"] });
    expect(await as(helper, ownerRows)).toBe(await ownerRows());
    await expect(
      as(helper, () =>
        db.query(
          `insert into transactions (user_id, amount, occurred_on, type) values ($1, 5, current_date, 'expense')`,
          [owner],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
  });
});

describe("company", () => {
  it("shows a worker their branch, everyone with 'see everyone', nothing without Company", async () => {
    await grant(managerId, { company: ["view"] });
    const branch = await as(manager, () => rows<{ id: string }>(`select id from company_tree()`));
    expect(branch.map((r) => r.id).sort()).toEqual([managerId, sellerId].sort());

    await grant(managerId, { company: ["view", "view_all"] });
    expect(await as(manager, () => count(`select 1 from company_tree()`))).toBeGreaterThan(2);

    await as(owner, () =>
      db.query(
        `update worker_permission_grants set allowed = false where worker_id = $1 and section = 'company'`,
        [managerId],
      ),
    );
    expect(await as(manager, () => count(`select 1 from company_tree()`))).toBe(0);
    await grant(managerId, { company: ["view"] });
  });

  it("lets the person change only their phone and photo", async () => {
    await as(seller, () =>
      db.query(`select company_update_worker($1, '{"phone": "+420777123456"}')`, [sellerId]),
    );
    expect(await one(`select phone from workers where id = $1`, [sellerId])).toEqual({
      phone: "+420777123456",
    });
    await expect(
      as(seller, () =>
        db.query(`select company_update_worker($1, '{"job_title": "Boss"}')`, [sellerId]),
      ),
    ).rejects.toThrow(/company_access_denied/);
    await expect(
      as(seller, () => db.query(`select company_update_worker($1, '{"phone": "777"}')`, [sellerId])),
    ).rejects.toThrow(/worker_phone_invalid/);
  });

  it("lets a manager change their people only with 'update', never somebody outside", async () => {
    const patch = `{"job_title": "Obchodník", "first_name": "Petr", "last_name": "Novák"}`;
    await expect(
      as(manager, () => db.query(`select company_update_worker($1, $2)`, [sellerId, patch])),
    ).rejects.toThrow(/company_access_denied/);
    await grant(managerId, { company: ["view", "update"] });
    await as(manager, () => db.query(`select company_update_worker($1, $2)`, [sellerId, patch]));
    expect(await one(`select name, job_title from workers where id = $1`, [sellerId])).toEqual({
      name: "Petr Novák",
      job_title: "Obchodník",
    });
    // Hana is not in Marta's branch.
    await expect(
      as(manager, () => db.query(`select company_update_worker($1, $2)`, [helperId, patch])),
    ).rejects.toThrow(/company_access_denied/);
    expect(await as(stranger, () => count(`select 1 from company_worker($1)`, [sellerId]))).toBe(0);
    await grant(managerId, { company: ["view"] });
  });

  it("adds people to groups of the same owner", async () => {
    const group = await as(owner, () =>
      one<{ id: string }>(`insert into worker_groups (name) values ('Obchod') returning id`),
    );
    await as(owner, () =>
      db.query(`select company_set_group_member($1, $2, true)`, [sellerId, group.id]),
    );
    expect(
      await count(`select 1 from worker_group_members where group_id = $1 and worker_id = $2`, [
        group.id,
        sellerId,
      ]),
    ).toBe(1);
    await expect(
      as(seller, () => db.query(`select company_set_group_member($1, $2, false)`, [sellerId, group.id])),
    ).rejects.toThrow(/company_access_denied/);
  });
});

describe("documents", () => {
  async function addDocument(as_: string, workerId: string) {
    const id = crypto.randomUUID();
    await as(as_, () =>
      db.query(
        `insert into worker_documents (id, owner_id, worker_id, name, path, size, mime)
         values ($1::uuid, $2::uuid, $3::uuid, 'Smlouva.pdf', $2::text || '/' || $3::text || '/' || $1::text,
                 1024, 'application/pdf')`,
        [id, owner, workerId],
      ),
    );
    return id;
  }

  it("belong to the owner and the person, not to their manager", async () => {
    const id = await addDocument(owner, sellerId);
    const row = await one<{ uploaded_by: string }>(
      `select uploaded_by from worker_documents where id = $1`,
      [id],
    );
    expect(row.uploaded_by).toBe(owner);
    expect(await as(seller, () => count(`select 1 from worker_documents where id = $1`, [id]))).toBe(1);
    expect(await as(manager, () => count(`select 1 from worker_documents where id = $1`, [id]))).toBe(0);
    expect(await as(stranger, () => count(`select 1 from worker_documents where id = $1`, [id]))).toBe(0);

    // The person reads, but neither uploads nor deletes.
    await expect(addDocument(seller, sellerId)).rejects.toThrow(/row-level security/);
    await as(seller, () => db.query(`delete from worker_documents where id = $1`, [id]));
    expect(await count(`select 1 from worker_documents where id = $1`, [id])).toBe(1);

    const objectName = `${owner}/${sellerId}/${id}`;
    const access = (uid: string, write: boolean) =>
      as(uid, () =>
        one<{ ok: boolean }>(`select worker_document_object_access($1, $2) as ok`, [objectName, write]),
      );
    expect(await access(owner, true)).toEqual({ ok: true });
    expect(await access(seller, false)).toEqual({ ok: true });
    expect(await access(seller, true)).toEqual({ ok: false });
    expect(await access(manager, false)).toEqual({ ok: false });
  });

  it("opens to a manager with 'update' and renames only", async () => {
    await grant(managerId, { company: ["view", "update"] });
    const id = await addDocument(manager, sellerId);
    await as(manager, () =>
      db.query(`update worker_documents set name = 'Dodatek.pdf' where id = $1`, [id]),
    );
    await expect(
      as(manager, () => db.query(`update worker_documents set size = 5 where id = $1`, [id])),
    ).rejects.toThrow(/worker_document_fixed/);
    // Never their own documents.
    await expect(addDocument(manager, managerId)).rejects.toThrow(/row-level security/);
    await grant(managerId, { company: ["view"] });
  });
});

describe("removing a worker", () => {
  it("hands the open deals and tasks over, moves the people up and ends the access", async () => {
    const leaver = await createAuthUser();
    const leaverId = await addWorker(leaver, "Odcházející", managerId);
    const below = await addWorker(null, "Podřízený", leaverId);
    await grant(leaverId, { pipeline: ["view"] });
    const deal = await addDeal("Leaver's deal", leaver);
    await db.query(
      `insert into crm_tasks (user_id, title, due_at, deal_id, assignee_id, created_by)
       values ($1, 'Leaver task', now(), $2, $3, $1)`,
      [owner, deal.id, leaver],
    );

    const impact = await as(owner, () => one(`select * from company_worker_impact($1)`, [leaverId]));
    expect(impact).toEqual({ open_deals: 1, open_crm_tasks: 1, open_worker_tasks: 0 });
    expect(await as(seller, () => count(`select * from company_worker_impact($1)`, [leaverId]))).toBe(0);
    await expect(
      as(seller, () => db.query(`select company_remove_worker($1, null)`, [leaverId])),
    ).rejects.toThrow(/worker_not_found/);

    const moved = await as(owner, () =>
      one(`select * from company_remove_worker($1, $2)`, [leaverId, owner]),
    );
    expect(moved).toEqual({ deals: 1, crm_tasks: 1, worker_tasks: 0 });
    expect(await one(`select assignee_id from deals where id = $1`, [deal.id])).toEqual({
      assignee_id: owner,
    });
    expect(await one(`select status::text, manager_id from workers where id = $1`, [leaverId])).toEqual({
      status: "inactive",
      manager_id: managerId,
    });
    expect(await one(`select manager_id from workers where id = $1`, [below])).toEqual({
      manager_id: managerId,
    });
    expect(await as(leaver, () => count(`select 1 from deals`))).toBe(0);
    expect(
      await as(leaver, () => one(`select has_permission($1, 'pipeline', 'view') as ok`, [owner])),
    ).toEqual({ ok: false });
  });
});

describe("the migration of today's rights", () => {
  it("turns view / edit into grants and keeps every worker's branch", async () => {
    const old = new PGlite({ extensions: PGLITE_EXTENSIONS });
    try {
      await old.exec(SUPABASE_STUBS);
      const files = readdirSync(MIGRATIONS_DIR)
        .filter((f) => f.endsWith(".sql"))
        .sort();
      const index = files.indexOf(path.basename(MIGRATION));
      for (const file of files.slice(0, index)) {
        await old.exec(readFileSync(path.join(MIGRATIONS_DIR, file), "utf8"));
      }
      const q = async <T = Row>(sql: string, params?: unknown[]) =>
        (await old.query<T>(sql, params as never)).rows;
      await q(`insert into auth.users (email) values ('first@example.com')`);
      const [{ id: boss }] = await q<{ id: string }>(
        `insert into auth.users (email) values ('boss@example.com') returning id`,
      );
      const [{ id: worker }] = await q<{ id: string }>(
        `insert into workers (owner_id, name, status) values ($1, 'Jan Novák', 'invited') returning id`,
        [boss],
      );
      await q(
        `insert into worker_permissions (owner_id, worker_id, section, can_view, can_edit) values
           ($1, $2, 'pipeline', true, false), ($1, $2, 'finance', true, true)`,
        [boss, worker],
      );

      for (const file of files.slice(index)) {
        await old.exec(readFileSync(path.join(MIGRATIONS_DIR, file), "utf8"));
      }
      const granted = (
        await q<{ key: string }>(
          `select section || '.' || action as key from worker_permission_grants
           where worker_id = $1 and allowed order by 1`,
          [worker],
        )
      ).map((r) => r.key);
      expect(granted).toEqual([
        "company.view",
        "finance.summaries",
        "finance.view",
        "finance.write",
        "invoices.issue",
        "invoices.view",
        "pipeline.see_amounts",
        "pipeline.view",
        "pipeline.view_all",
        "tasks.view",
        "tasks.view_all",
      ]);
      const [names] = await q(`select first_name, last_name, name from workers where id = $1`, [
        worker,
      ]);
      expect(names).toEqual({ first_name: "Jan", last_name: "Novák", name: "Jan Novák" });
      // The older rights did not move.
      const coarseRows = await q(
        `select section::text, can_view, can_edit from worker_permissions where worker_id = $1 order by 1`,
        [worker],
      );
      expect(coarseRows).toEqual([
        { section: "finance", can_view: true, can_edit: true },
        { section: "pipeline", can_view: true, can_edit: false },
      ]);
    } finally {
      await old.close();
    }
  });
});
