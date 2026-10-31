// @vitest-environment node
//
// Sales tasks (crm_tasks) on the real migrations (PGlite): who sees and
// changes them, what the database stamps itself, and what deleting a deal or
// a contact does to them.

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
type Task = {
  id: string;
  user_id: string;
  title: string;
  status: string;
  assignee_id: string | null;
  created_by: string | null;
  completed_at: string | null;
  completed_by: string | null;
  completion_note: string | null;
  deal_id: string | null;
  contact_id: string | null;
};

let db: PGlite;
let owner: string;
let stranger: string;
let viewer: string; // worker who may see the pipeline
let editor: string; // worker who may edit the pipeline
let doer: string; // worker without any section, only tasks given to them
let contactsWorker: string; // worker who may edit contacts only
let viewerWorkerId: string;

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
async function asServer() {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
}
async function as<T>(uid: string, run: () => Promise<T>): Promise<T> {
  await asUser(uid);
  try {
    return await run();
  } finally {
    await asServer();
  }
}
async function createAuthUser() {
  const { id } = await one<{ id: string }>(
    `insert into auth.users (email, raw_user_meta_data) values ($1, '{"locale":"cs"}') returning id`,
    [`${crypto.randomUUID()}@example.com`],
  );
  return id;
}
async function addWorker(ownerId: string, userId: string, sections: [string, boolean, boolean][]) {
  const { id } = await one<{ id: string }>(
    `insert into workers (owner_id, user_id, name, status) values ($1, $2, 'Worker', 'active') returning id`,
    [ownerId, userId],
  );
  for (const [section, view, edit] of sections) {
    await db.query(
      `insert into worker_permissions (owner_id, worker_id, section, can_view, can_edit)
       values ($1, $2, $3, $4, $5)`,
      [ownerId, id, section, view, edit],
    );
  }
  return id;
}
async function addContact(uid: string, name: string) {
  return one<{ id: string }>(
    `insert into contacts (user_id, company_name) values ($1, $2) returning id`,
    [uid, name],
  );
}
async function addDeal(uid: string, title: string, contactId: string | null = null) {
  const stage = await one<{ id: string }>(
    `select id from pipeline_stages where user_id = $1 order by position limit 1`,
    [uid],
  );
  return one<{ id: string }>(
    `insert into deals (user_id, stage_id, title, contact_id) values ($1, $2, $3, $4) returning id`,
    [uid, stage.id, title, contactId],
  );
}
function insertTask(
  space: string,
  values: {
    title?: string;
    deal?: string | null;
    contact?: string | null;
    assignee?: string | null;
    status?: string;
  },
) {
  return one<Task>(
    `insert into crm_tasks (user_id, title, due_at, deal_id, contact_id, assignee_id, status)
     values ($1, $2, now() + interval '1 day', $3, $4, coalesce($5::uuid, auth.uid()), coalesce($6, 'open')::crm_task_status)
     returning *`,
    [
      space,
      values.title ?? "Zavolat",
      values.deal ?? null,
      values.contact ?? null,
      values.assignee ?? null,
      values.status ?? null,
    ],
  );
}
function visibleTasks(uid: string) {
  return as(uid, () => rows<{ id: string }>(`select id from crm_tasks order by created_at`));
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
  viewer = await createAuthUser();
  editor = await createAuthUser();
  doer = await createAuthUser();
  contactsWorker = await createAuthUser();
  viewerWorkerId = await addWorker(owner, viewer, [["pipeline", true, false]]);
  await addWorker(owner, editor, [["pipeline", true, true]]);
  await addWorker(owner, doer, []);
  await addWorker(owner, contactsWorker, [["contacts", true, true]]);
});

afterAll(async () => {
  await db?.close();
});

describe("crm tasks: what the database stamps", () => {
  it("makes a new task open, by the caller, given to the caller", async () => {
    const deal = await addDeal(owner, "Web pro pekárnu");
    const task = await as(owner, () =>
      insertTask(owner, { deal: deal.id, assignee: null, status: "done" }),
    );
    expect(task.status).toBe("open");
    expect(task.created_by).toBe(owner);
    expect(task.assignee_id).toBe(owner);
    expect(task.completed_at).toBeNull();
  });

  it("needs a deal or a contact, and only of the same space", async () => {
    await expect(as(owner, () => insertTask(owner, {}))).rejects.toThrow(/crm_tasks_target/);
    const theirs = await addDeal(stranger, "Cizí obchod");
    await expect(as(owner, () => insertTask(owner, { deal: theirs.id }))).rejects.toThrow(
      /foreign key/,
    );
  });

  it("stamps the finish, trims the note and clears both when ticked back", async () => {
    const contact = await addContact(owner, "Pekárna Novák");
    const task = await as(owner, () => insertTask(owner, { contact: contact.id }));
    const done = await as(owner, () =>
      one<Task>(
        `update crm_tasks set status = 'done', completion_note = '  Pošle podklady v pondělí  ',
           completed_by = $2, completed_at = '2020-01-01'
         where id = $1 returning *`,
        [task.id, stranger],
      ),
    );
    expect(done.completed_by).toBe(owner);
    expect(new Date(done.completed_at!).getFullYear()).toBeGreaterThan(2020);
    expect(done.completion_note).toBe("Pošle podklady v pondělí");

    // Editing the note later keeps the finish as it was.
    const edited = await as(owner, () =>
      one<Task>(
        `update crm_tasks set completion_note = 'Opraveno', completed_at = now() + interval '5 days'
         where id = $1 returning *`,
        [task.id],
      ),
    );
    expect(edited.completed_at).toEqual(done.completed_at);
    expect(edited.completion_note).toBe("Opraveno");

    const reopened = await as(owner, () =>
      one<Task>(`update crm_tasks set status = 'open' where id = $1 returning *`, [task.id]),
    );
    expect(reopened.completed_at).toBeNull();
    expect(reopened.completed_by).toBeNull();
    expect(reopened.completion_note).toBeNull();
  });

  it("gives a task only to the owner or an active worker of the space", async () => {
    const deal = await addDeal(owner, "Přiřazení");
    const toWorker = await as(owner, () => insertTask(owner, { deal: deal.id, assignee: viewer }));
    expect(toWorker.assignee_id).toBe(viewer);
    await expect(
      as(owner, () => insertTask(owner, { deal: deal.id, assignee: stranger })),
    ).rejects.toThrow(/crm_task_assignee_outside/);

    // A deactivated worker can not get new tasks; the old ones stay theirs.
    await db.query(`update workers set status = 'inactive' where id = $1`, [viewerWorkerId]);
    await expect(
      as(owner, () => insertTask(owner, { deal: deal.id, assignee: viewer })),
    ).rejects.toThrow(/crm_task_assignee_outside/);
    const renamed = await as(owner, () =>
      one<Task>(`update crm_tasks set title = 'Stále jeho' where id = $1 returning *`, [
        toWorker.id,
      ]),
    );
    expect(renamed.assignee_id).toBe(viewer);
    await db.query(`update workers set status = 'active' where id = $1`, [viewerWorkerId]);
  });
});

describe("crm tasks: who sees and changes them", () => {
  it("keeps a stranger out completely", async () => {
    const deal = await addDeal(owner, "Tajný obchod");
    const task = await as(owner, () => insertTask(owner, { deal: deal.id }));
    expect((await visibleTasks(stranger)).map((r) => r.id)).not.toContain(task.id);
    // Refused either way: the stranger is no one to give it to, and not of the space.
    await expect(as(stranger, () => insertTask(owner, { deal: deal.id }))).rejects.toThrow(
      /row-level security|crm_task_assignee_outside/,
    );
    await expect(
      as(stranger, () => insertTask(owner, { deal: deal.id, assignee: owner })),
    ).rejects.toThrow(/row-level security|crm_task_assignee_outside/);
    const changed = await as(stranger, () =>
      rows(`update crm_tasks set title = 'x' where id = $1 returning id`, [task.id]),
    );
    expect(changed).toHaveLength(0);
  });

  it("lets a worker see deal tasks with the right to see the pipeline, change them only with edit", async () => {
    const deal = await addDeal(owner, "Sdílený obchod");
    const task = await as(owner, () => insertTask(owner, { deal: deal.id }));

    expect((await visibleTasks(viewer)).map((r) => r.id)).toContain(task.id);
    await expect(as(viewer, () => insertTask(owner, { deal: deal.id }))).rejects.toThrow(
      /row-level security/,
    );
    const viewerChange = await as(viewer, () =>
      rows(`update crm_tasks set title = 'x' where id = $1 returning id`, [task.id]),
    );
    expect(viewerChange).toHaveLength(0);

    // With edit: a new task (given to the worker by default) and a change.
    const own = await as(editor, () => insertTask(owner, { deal: deal.id }));
    expect(own.user_id).toBe(owner);
    expect(own.created_by).toBe(editor);
    expect(own.assignee_id).toBe(editor);
    const renamed = await as(editor, () =>
      one<Task>(`update crm_tasks set title = 'Upraveno' where id = $1 returning *`, [task.id]),
    );
    expect(renamed.title).toBe("Upraveno");
    // A worker may give the task to the owner, never to someone outside.
    await as(editor, () =>
      rows(`update crm_tasks set assignee_id = $2 where id = $1`, [own.id, owner]),
    );
    await expect(
      as(editor, () =>
        rows(`update crm_tasks set assignee_id = $2 where id = $1`, [own.id, stranger]),
      ),
    ).rejects.toThrow(/crm_task_assignee_outside/);
  });

  it("lets the person given a task tick it off, and nothing else", async () => {
    const deal = await addDeal(owner, "Obchod bez práv");
    const theirs = await as(owner, () => insertTask(owner, { deal: deal.id, assignee: doer }));
    const other = await as(owner, () => insertTask(owner, { deal: deal.id }));

    const seen = (await visibleTasks(doer)).map((r) => r.id);
    expect(seen).toContain(theirs.id);
    expect(seen).not.toContain(other.id);

    const done = await as(doer, () =>
      one<Task>(
        `update crm_tasks set status = 'done', completion_note = 'Hotovo' where id = $1 returning *`,
        [theirs.id],
      ),
    );
    expect(done.completed_by).toBe(doer);
    await expect(
      as(doer, () => rows(`update crm_tasks set title = 'Jinak' where id = $1`, [theirs.id])),
    ).rejects.toThrow(/crm_task_only_status/);
    await expect(
      as(doer, () =>
        rows(`update crm_tasks set assignee_id = $2 where id = $1`, [theirs.id, owner]),
      ),
    ).rejects.toThrow(/crm_task_only_status/);
    const deleted = await as(doer, () =>
      rows(`delete from crm_tasks where id = $1 returning id`, [theirs.id]),
    );
    expect(deleted).toHaveLength(0);
    await expect(as(doer, () => insertTask(owner, { deal: deal.id }))).rejects.toThrow(
      /row-level security/,
    );
  });

  it("opens contact tasks with the contacts right, not deal tasks", async () => {
    const contact = await addContact(owner, "Kontakt pro úkoly");
    const deal = await addDeal(owner, "Jen obchod");
    const contactTask = await as(owner, () => insertTask(owner, { contact: contact.id }));
    const dealTask = await as(owner, () => insertTask(owner, { deal: deal.id }));
    const seen = (await visibleTasks(contactsWorker)).map((r) => r.id);
    expect(seen).toContain(contactTask.id);
    expect(seen).not.toContain(dealTask.id);
    const created = await as(contactsWorker, () => insertTask(owner, { contact: contact.id }));
    expect(created.created_by).toBe(contactsWorker);
  });

  it("names the people of the space for the picker, to the owner and to a worker", async () => {
    const forOwner = await as(owner, () =>
      rows<{ user_id: string; is_owner: boolean }>(`select * from crm_task_assignees()`),
    );
    expect(forOwner[0]).toMatchObject({ user_id: owner, is_owner: true });
    expect(forOwner.map((r) => r.user_id)).toEqual(
      expect.arrayContaining([viewer, editor, doer, contactsWorker]),
    );
    const forWorker = await as(doer, () =>
      rows<{ user_id: string }>(`select * from crm_task_assignees()`),
    );
    expect(forWorker.map((r) => r.user_id)).toEqual(forOwner.map((r) => r.user_id));
    const forStranger = await as(stranger, () =>
      rows<{ user_id: string }>(`select * from crm_task_assignees()`),
    );
    expect(forStranger.map((r) => r.user_id)).toEqual([stranger]);
  });
});

describe("crm tasks: deleting what they belong to", () => {
  it("drops a task of a deleted deal, but keeps one that also has a contact", async () => {
    const contact = await addContact(owner, "Zůstávající kontakt");
    const deal = await addDeal(owner, "Mazaný obchod", contact.id);
    const onlyDeal = await as(owner, () => insertTask(owner, { deal: deal.id }));
    const both = await as(owner, () => insertTask(owner, { deal: deal.id, contact: contact.id }));
    // A worker with the right to edit deletes the deal.
    await as(editor, () => rows(`delete from deals where id = $1`, [deal.id]));
    expect(await rows(`select id from crm_tasks where id = $1`, [onlyDeal.id])).toHaveLength(0);
    const kept = await one<Task>(`select * from crm_tasks where id = $1`, [both.id]);
    expect(kept.deal_id).toBeNull();
    expect(kept.contact_id).toBe(contact.id);
    expect(kept.user_id).toBe(owner);

    await as(owner, () => rows(`delete from contacts where id = $1`, [contact.id]));
    expect(await rows(`select id from crm_tasks where id = $1`, [both.id])).toHaveLength(0);
  });
});
