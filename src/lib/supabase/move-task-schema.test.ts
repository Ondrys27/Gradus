// @vitest-environment node
//
// Moving milestone tasks (17.5) on the real migrations (PGlite): move_task()
// renumbers positions, keeps the subtree together, refuses cycles, other
// milestones and trees past the level limit, follows the reopen rules, and
// only the owner or a worker with milestones edit may move.

import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MAX_TASK_LEVELS } from "@/features/milestones/task-tree";
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
let editor: string; // worker: milestones edit
let viewer: string; // worker: milestones view only
let milestone: string;
let otherMilestone: string;
/** Task ids by title, for the tree built before every test. */
let ids: Record<string, string>;

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
async function addWorker(ownerId: string, userId: string, view: boolean, edit: boolean) {
  const { id } = await one<{ id: string }>(
    `insert into workers (owner_id, user_id, name, status) values ($1, $2, 'Worker', 'active') returning id`,
    [ownerId, userId],
  );
  await db.query(
    `insert into worker_permissions (owner_id, worker_id, section, can_view, can_edit)
     values ($1, $2, 'milestones', $3, $4)`,
    [ownerId, id, view, edit],
  );
}
async function addTask(
  title: string,
  parent: string | null,
  position: number,
  status = "todo",
  milestoneId = milestone,
) {
  const { id } = await one<{ id: string }>(
    `insert into tasks (user_id, milestone_id, parent_task_id, title, position, status)
     values ($1, $2, $3, $4, $5, $6) returning id`,
    [owner, milestoneId, parent, title, position, status],
  );
  ids[title] = id;
  return id;
}
function move(uid: string, title: string, parent: string | null, position: number) {
  return as(uid, () =>
    db.query(`select move_task($1, $2, $3)`, [ids[title], parent ? ids[parent] : null, position]),
  );
}
/** Children of a parent as "title:position" in their order. */
async function children(parent: string | null) {
  const list = await rows<{ title: string; position: number }>(
    `select title, position from tasks
     where milestone_id = $1 and parent_task_id is not distinct from $2
     order by position, created_at`,
    [milestone, parent ? ids[parent] : null],
  );
  return list.map((row) => `${row.title}:${row.position}`);
}
async function statusOf(title: string) {
  return (await one<{ status: string }>(`select status from tasks where id = $1`, [ids[title]]))
    .status;
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
  editor = await createAuthUser();
  viewer = await createAuthUser();
  await addWorker(owner, editor, true, true);
  await addWorker(owner, viewer, true, false);
});

afterAll(async () => {
  await db?.close();
});

/**
 *   A        (0)
 *   ├ A1     (0)
 *   │ └ A1x  (0)
 *   └ A2     (1)
 *   B        (1)
 *   C        (2)
 */
beforeEach(async () => {
  ids = {};
  milestone = (
    await one<{ id: string }>(
      `insert into milestones (user_id, title) values ($1, 'Move') returning id`,
      [owner],
    )
  ).id;
  otherMilestone = (
    await one<{ id: string }>(
      `insert into milestones (user_id, title) values ($1, 'Other') returning id`,
      [owner],
    )
  ).id;
  await addTask("A", null, 0);
  await addTask("B", null, 1);
  await addTask("C", null, 2);
  await addTask("A1", ids.A, 0);
  await addTask("A2", ids.A, 1);
  await addTask("A1x", ids.A1, 0);
});

describe("move_task · position", () => {
  it("reorders siblings and renumbers them from 0", async () => {
    await move(owner, "C", null, 0);
    expect(await children(null)).toEqual(["C:0", "A:1", "B:2"]);
  });

  it("moves a task under another with its subtree and closes the gap it left", async () => {
    await move(owner, "A1", "B", 0);
    expect(await children("B")).toEqual(["A1:0"]);
    expect(await children("A")).toEqual(["A2:0"]);
    expect(await children("A1")).toEqual(["A1x:0"]);
  });

  it("puts a subtask on level 1 and clamps the position", async () => {
    await move(owner, "A1x", null, 99);
    expect(await children(null)).toEqual(["A:0", "B:1", "C:2", "A1x:3"]);
    await move(owner, "A1x", "A", -5);
    expect(await children("A")).toEqual(["A1x:0", "A1:1", "A2:2"]);
    expect(await children(null)).toEqual(["A:0", "B:1", "C:2"]);
  });
});

describe("move_task · cycle, milestone and depth", () => {
  it("refuses to put a task under itself or its own subtask", async () => {
    await expect(move(owner, "A", "A", 0)).rejects.toThrow();
    await expect(move(owner, "A", "A1x", 0)).rejects.toThrow(/task_move_cycle/);
    expect(await children(null)).toEqual(["A:0", "B:1", "C:2"]);
  });

  it("refuses the same cycle written directly, without move_task", async () => {
    await expect(
      as(owner, () =>
        db.query(`update tasks set parent_task_id = $1 where id = $2`, [ids.A1x, ids.A]),
      ),
    ).rejects.toThrow(/task_move_cycle/);
  });

  it("refuses a parent from another milestone", async () => {
    const foreign = await addTask("F", null, 0, "todo", otherMilestone);
    await expect(
      as(owner, () => db.query(`select move_task($1, $2, 0)`, [ids.B, foreign])),
    ).rejects.toThrow(/task_parent_invalid/);
    await expect(
      as(owner, () =>
        db.query(`update tasks set parent_task_id = $1 where id = $2`, [foreign, ids.B]),
      ),
    ).rejects.toThrow(/task_parent_invalid/);
  });

  it("allows as many levels as the app and not one more", async () => {
    // A chain of MAX_TASK_LEVELS levels under B (B is level 1).
    let parent = ids.B;
    for (let level = 2; level <= MAX_TASK_LEVELS; level++) {
      parent = await addTask(`L${level}`, parent, 0);
    }
    await expect(addTask("too deep", parent, 0)).rejects.toThrow(/task_too_deep/);
    // C fits on the last level; A with two levels below it does not.
    await expect(move(owner, "A", `L${MAX_TASK_LEVELS - 1}`, 0)).rejects.toThrow(/task_too_deep/);
    await move(owner, "C", `L${MAX_TASK_LEVELS - 1}`, 0);
    expect(await children(`L${MAX_TASK_LEVELS - 1}`)).toEqual(["C:0", `L${MAX_TASK_LEVELS}:1`]);
  });
});

describe("move_task · completion", () => {
  it("reopens a done parent and its done ancestors when an open task comes under it", async () => {
    await db.query(`update tasks set status = 'done' where id = $1`, [ids.C]);
    await addTask("Cdone", ids.C, 0, "done");
    await db.query(`update tasks set status = 'done' where id = $1`, [ids.B]);
    await move(owner, "B", "Cdone", 0);
    expect(await statusOf("B")).toBe("done");
    expect(await statusOf("C")).toBe("done");

    await move(owner, "A2", "B", 0);
    expect(await statusOf("A2")).toBe("todo");
    expect(await statusOf("B")).toBe("in_progress");
    expect(await statusOf("Cdone")).toBe("in_progress");
    expect(await statusOf("C")).toBe("in_progress");
  });

  it("never completes the parent an open task leaves", async () => {
    await db.query(`update tasks set status = 'done' where id = $1`, [ids.A1x]);
    await db.query(`update tasks set status = 'done' where id = $1`, [ids.A1]);
    // A's only open subtask is A2; it leaves, A is unlocked but stays open.
    await move(owner, "A2", null, 0);
    expect(await statusOf("A")).toBe("todo");
    const { status } = await one<{ status: string }>(
      `select status::text from milestones where id = $1`,
      [milestone],
    );
    expect(status).toBe("active");
  });
});

describe("move_task · who may move", () => {
  it("lets a worker with milestones edit move the owner's tasks", async () => {
    await move(editor, "C", "B", 0);
    expect(await children("B")).toEqual(["C:0"]);
  });

  it("refuses a worker who may only look, and a stranger", async () => {
    await expect(move(viewer, "C", "B", 0)).rejects.toThrow(/forbidden/);
    await expect(move(stranger, "C", "B", 0)).rejects.toThrow(/task_not_found/);
    expect(await children("B")).toEqual([]);
  });

  it("is not callable without a user", async () => {
    await db.exec(`set role anon;`);
    try {
      await expect(db.query(`select move_task($1, null, 0)`, [ids.C])).rejects.toThrow();
    } finally {
      await db.exec(`reset role;`);
    }
  });
});
