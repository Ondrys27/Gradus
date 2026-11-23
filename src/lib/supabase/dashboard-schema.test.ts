// @vitest-environment node
//
// Dashboard of widgets (28.5) on the real migrations (PGlite): the shape of a
// layout, six tabs at most, only one's own dashboards in a space one belongs
// to, the owner's defaults hidden from workers and handed over only through
// dashboard_context() (a person's > a group's > the company's), and the list
// of widgets a worker may use.

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
let account: string;
let other: string;
let stranger: string;
let worker: string;
let group: string;

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
async function addWorker(ownerId: string, account: string) {
  const [row] = await rows<{ id: string }>(
    `insert into workers (owner_id, user_id, name, status) values ($1, $2, 'Member', 'active') returning id`,
    [ownerId, account],
  );
  return row!.id;
}
const item = (id: string, widget = "today", size = "M", x = 0, y = 0) => ({
  id,
  widget,
  size,
  x,
  y,
  settings: {},
});
async function errorOf(run: () => Promise<unknown>): Promise<string | null> {
  try {
    await run();
    return null;
  } catch (error) {
    return (error as Error).message;
  }
}
const context = (uid: string, space: string) =>
  as(uid, async () => {
    const [row] = await rows<{ ctx: Record<string, unknown> | null }>(
      `select dashboard_context($1) as ctx`,
      [space],
    );
    return row!.ctx;
  });

beforeAll(async () => {
  db = new PGlite({ extensions: PGLITE_EXTENSIONS });
  await db.exec(SUPABASE_STUBS);
  for (const file of readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    await db.exec(readFileSync(path.join(MIGRATIONS_DIR, file), "utf8"));
  }
  owner = await createAuthUser();
  account = await createAuthUser();
  other = await createAuthUser();
  stranger = await createAuthUser();
  worker = await addWorker(owner, account);
  await addWorker(owner, other);
  const [g] = await rows<{ id: string }>(
    `insert into worker_groups (owner_id, name, color) values ($1, 'Obchod', 'violet') returning id`,
    [owner],
  );
  group = g!.id;
  await db.query(
    `insert into worker_group_members (group_id, worker_id, owner_id) values ($1, $2, $3)`,
    [group, worker, owner],
  );
});

afterAll(async () => {
  await db?.close();
});

describe("dashboard_items_valid", () => {
  const valid = (value: unknown) =>
    rows<{ ok: boolean }>(`select dashboard_items_valid($1::jsonb) as ok`, [
      JSON.stringify(value),
    ]).then((result) => result[0]!.ok);

  it("takes the layout the app writes", async () => {
    expect(await valid([])).toBe(true);
    expect(
      await valid([
        item("a", "today", "L"),
        { ...item("b", "level", "S", 2, 0), settings: { x: 1 } },
      ]),
    ).toBe(true);
  });

  it("refuses anything else", async () => {
    expect(await valid({})).toBe(false);
    expect(await valid([item("a"), item("a")])).toBe(false);
    expect(await valid([item("a", "bad key")])).toBe(false);
    expect(await valid([item("a", "today", "XXL")])).toBe(false);
    expect(await valid([item("a", "today", "S", 4, 0)])).toBe(false);
    expect(await valid([{ ...item("a"), settings: "x" }])).toBe(false);
    expect(await valid([{ ...item("a"), settings: { t: "x".repeat(2100) } }])).toBe(false);
    expect(await valid(Array.from({ length: 41 }, (_, i) => item(`i${i}`)))).toBe(false);
  });
});

describe("dashboard_layouts", () => {
  it("a worker keeps their own dashboards in the company, six at most", async () => {
    await as(account, async () => {
      await db.query(
        `insert into dashboard_layouts (space_id, is_default, items) values ($1, true, null)`,
        [owner],
      );
      for (let i = 1; i < 6; i += 1) {
        await db.query(
          `insert into dashboard_layouts (space_id, name, position, items) values ($1, $2, $3, $4::jsonb)`,
          [owner, `Tab ${i}`, i, JSON.stringify([item("a")])],
        );
      }
      expect(
        await errorOf(() =>
          db.query(
            `insert into dashboard_layouts (space_id, name, position, items) values ($1, 'Seven', 5, '[]')`,
            [owner],
          ),
        ),
      ).toContain("dashboard_layout_limit");
    });
  });

  it("only one main tab, and only the main tab may follow the default", async () => {
    await as(account, async () => {
      expect(
        await errorOf(() =>
          db.query(`insert into dashboard_layouts (space_id, is_default) values ($1, true)`, [
            account,
          ]),
        ),
      ).toBeNull();
      expect(
        await errorOf(() =>
          db.query(`insert into dashboard_layouts (space_id, is_default) values ($1, true)`, [
            account,
          ]),
        ),
      ).toMatch(/duplicate|unique/);
      expect(
        await errorOf(() =>
          db.query(`insert into dashboard_layouts (space_id, name) values ($1, 'x')`, [account]),
        ),
      ).toContain("dashboard_layouts_items");
    });
  });

  it("nobody else reads, changes or adds them", async () => {
    for (const person of [owner, other, stranger]) {
      const seen = await as(person, () =>
        rows(`select id from dashboard_layouts where user_id = $1`, [account]),
      );
      expect(seen).toEqual([]);
    }
    expect(
      await errorOf(() =>
        as(stranger, () =>
          db.query(`insert into dashboard_layouts (space_id, name, items) values ($1, 'x', '[]')`, [
            owner,
          ]),
        ),
      ),
    ).not.toBeNull();
    expect(
      await errorOf(() =>
        as(stranger, () =>
          db.query(
            `insert into dashboard_layouts (user_id, space_id, name, items) values ($1, $2, 'x', '[]')`,
            [account, account],
          ),
        ),
      ),
    ).not.toBeNull();
  });

  it("who and where never change", async () => {
    const message = await errorOf(() =>
      as(account, () =>
        db.query(`update dashboard_layouts set space_id = $1 where space_id = $2`, [
          account,
          owner,
        ]),
      ),
    );
    expect(message).toContain("dashboard_layout_fixed");
  });

  it("a worker who left the company loses its dashboards", async () => {
    const leaver = await createAuthUser();
    const id = await addWorker(owner, leaver);
    await as(leaver, () =>
      db.query(`insert into dashboard_layouts (space_id, name, items) values ($1, 'Mine', '[]')`, [
        owner,
      ]),
    );
    await db.query(`update workers set status = 'inactive' where id = $1`, [id]);
    expect(
      await as(leaver, () => rows(`select id from dashboard_layouts where space_id = $1`, [owner])),
    ).toEqual([]);
  });
});

describe("dashboard_defaults and dashboard_context", () => {
  it("the owner has no company default for themselves", async () => {
    expect(await context(owner, owner)).toEqual({
      source: null,
      items: null,
      updated_at: null,
      allowed: null,
    });
  });

  it("a person's default beats a group's, which beats the company's", async () => {
    await as(owner, async () => {
      await db.query(
        `insert into dashboard_defaults (space_id, target, items) values ($1, 'space', $2::jsonb)`,
        [owner, JSON.stringify([item("c", "pipeline")])],
      );
    });
    expect((await context(account, owner))!.source).toBe("space");
    expect((await context(other, owner))!.source).toBe("space");

    await as(owner, () =>
      db.query(
        `insert into dashboard_defaults (space_id, target, group_id, items) values ($1, 'group', $2, $3::jsonb)`,
        [owner, group, JSON.stringify([item("g", "onFire", "XL")])],
      ),
    );
    const viaGroup = await context(account, owner);
    expect(viaGroup).toMatchObject({ source: "group", group_name: "Obchod" });
    expect((viaGroup!.items as Row[])[0]).toMatchObject({ widget: "onFire" });
    expect((await context(other, owner))!.source).toBe("space");

    await as(owner, () =>
      db.query(
        `insert into dashboard_defaults (space_id, target, worker_id, items) values ($1, 'worker', $2, '[]')`,
        [owner, worker],
      ),
    );
    expect((await context(account, owner))!.source).toBe("worker");
  });

  it("a newer save is a newer version", async () => {
    const before = (await context(other, owner))!.updated_at as string;
    await as(owner, () =>
      db.query(
        `update dashboard_defaults set items = '[]' where space_id = $1 and target = 'space'`,
        [owner],
      ),
    );
    const after = (await context(other, owner))!.updated_at as string;
    expect(Date.parse(after)).toBeGreaterThan(Date.parse(before));
  });

  it("workers and strangers never read or write the defaults directly", async () => {
    for (const person of [account, stranger]) {
      expect(await as(person, () => rows(`select id from dashboard_defaults`))).toEqual([]);
      expect(
        await errorOf(() =>
          as(person, () =>
            db.query(
              `insert into dashboard_defaults (space_id, target, items) values ($1, 'space', '[]')`,
              [owner],
            ),
          ),
        ),
      ).not.toBeNull();
    }
  });

  it("a stranger gets no context of a company", async () => {
    expect(await context(stranger, owner)).toBeNull();
  });

  it("the owner's list of widgets reaches the worker, nobody else", async () => {
    await as(owner, () =>
      db.query(
        `insert into worker_dashboard_widgets (worker_id, owner_id, widgets) values ($1, $2, '{today,pipeline}')`,
        [worker, owner],
      ),
    );
    expect((await context(account, owner))!.allowed).toEqual(["today", "pipeline"]);
    expect((await context(other, owner))!.allowed).toBeNull();
    expect(
      await as(account, () => rows(`select widgets from worker_dashboard_widgets`)),
    ).toHaveLength(1);
    expect(await as(other, () => rows(`select widgets from worker_dashboard_widgets`))).toEqual([]);
    expect(
      await errorOf(() =>
        as(account, () =>
          db
            .query(`update worker_dashboard_widgets set widgets = '{today,financeMonth}'`)
            .then((r) => {
              if (!r.affectedRows) throw new Error("not changed");
            }),
        ),
      ),
    ).not.toBeNull();
    expect(
      await errorOf(() =>
        as(owner, () =>
          db.query(
            `update worker_dashboard_widgets set widgets = '{"bad key"}' where worker_id = $1`,
            [worker],
          ),
        ),
      ),
    ).toContain("worker_dashboard_widgets_list");
  });
});
