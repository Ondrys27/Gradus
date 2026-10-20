// @vitest-environment node
//
// The plan catalog in the database (step 15.5): the first published version
// is the seed from src/config/pricing.ts, the table is closed to clients, only
// the owner with aal2 and a live admin session saves a draft, discards it,
// publishes it or brings back an earlier version (each audited, one at a
// time, never two published), history never changes, current_plan() reads
// the limits of the published version, and an account over a lowered
// workers or storage limit turns read-only only from the next day. Runs every
// migration in PGlite with the same Supabase stubs as ai-caps-schema.test.ts.

import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PlanCatalog } from "@/config/pricing";
import { seedPlanCatalog } from "@/features/plan/catalog-seed";
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
/** Signs in as `uid`; aal2 with a TOTP step a moment ago unless told otherwise. */
async function asUser(uid: string, aal: "aal1" | "aal2" = "aal2") {
  const now = Math.floor(Date.now() / 1000);
  const amr = [{ method: "password", timestamp: now - 60 }];
  if (aal === "aal2") amr.unshift({ method: "totp", timestamp: now - 30 });
  const claims = JSON.stringify({ sub: uid, aal, session_id: crypto.randomUUID(), amr });
  await asServer();
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid]);
  await db.query(`select set_config('request.jwt.claims', $1, false)`, [claims]);
  await db.exec(`set role authenticated;`);
}
async function createAuthUser() {
  await asServer();
  const { id } = await one<{ id: string }>(
    `insert into auth.users (email, raw_user_meta_data) values ($1, '{"locale":"cs"}') returning id`,
    [`${crypto.randomUUID()}@example.com`],
  );
  return id;
}

const json = (value: unknown) => JSON.stringify(value);
const saveDraft = (payload: unknown) =>
  db.query<{ id: string }>(`select public.admin_plan_catalog_save_draft($1::jsonb, null) as id`, [
    json(payload),
  ]);
const publish = (payload: unknown, expected: string) =>
  db.query<{ id: string }>(`select public.admin_plan_catalog_publish($1::jsonb, $2, null) as id`, [
    json(payload),
    expected,
  ]);
const restore = (version: string, expected: string) =>
  db.query<{ id: string }>(`select public.admin_plan_catalog_restore($1, $2, null) as id`, [
    version,
    expected,
  ]);

async function published() {
  await asServer();
  return one<{ id: string; payload: PlanCatalog; published_by: string | null }>(
    `select id, payload, published_by from plan_catalog_versions where status = 'published'`,
  );
}

/** The seed with one change to the plan `key`. */
function changed(key: string, change: (plan: PlanCatalog[number]) => void): PlanCatalog {
  const catalog = structuredClone(seedPlanCatalog());
  change(catalog.find((plan) => plan.key === key)!);
  return catalog;
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
  owner = await createAuthUser(); // first account = owner, beta
  user = await createAuthUser(); // pro trial
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe("the first version", () => {
  it("is the seed of src/config/pricing.ts, published, and nothing else", async () => {
    await asServer();
    const all = await rows<{ status: string; payload: PlanCatalog }>(
      `select status, payload from plan_catalog_versions`,
    );
    expect(all).toHaveLength(1);
    expect(all[0].status).toBe("published");
    expect(all[0].payload).toEqual(seedPlanCatalog());
  });

  it("gives current_plan() the same limits as the plans table had", async () => {
    await asServer();
    const plan = await one<Row>(`select * from current_plan($1)`, [user]);
    const limits = await one<Row>(
      `select daily_generation_limit, monthly_generation_limit, ai_calls_limit, file_uploads_limit
       from plans where key = 'pro'`,
    );
    expect(plan).toMatchObject({ plan_key: "pro", status: "trialing", read_only: false, ...limits });
    // Beta is outside the catalog and keeps the plans table.
    expect(await one(`select plan_key, ai_calls_limit from current_plan($1)`, [owner])).toEqual({
      plan_key: "beta",
      ai_calls_limit: 3000,
    });
  });
});

describe("plan_catalog_versions", () => {
  it("is closed to every signed-in user, owner included", async () => {
    for (const uid of [user, owner]) {
      await asUser(uid);
      await expect(db.query(`select * from plan_catalog_versions`)).rejects.toThrow(
        /permission denied/,
      );
      await expect(
        db.query(`insert into plan_catalog_versions (status, payload) values ('draft', $1)`, [
          json(seedPlanCatalog()),
        ]),
      ).rejects.toThrow(/permission denied/);
      for (const fn of ["published_plan('pro')", `plan_overage('${uid}')`, `plan_catalog_impact('[]')`]) {
        await expect(db.query(`select * from ${fn}`), fn).rejects.toThrow(/permission denied/);
      }
    }
    await asServer();
  });

  it("never holds two published versions or two drafts, even for the server", async () => {
    await asServer();
    await expect(
      db.query(
        `insert into plan_catalog_versions (status, published_at, payload) values ('published', now(), $1)`,
        [json(seedPlanCatalog())],
      ),
    ).rejects.toThrow(/plan_catalog_versions_one_published/);
    await db.query(`insert into plan_catalog_versions (status, payload) values ('draft', $1)`, [
      json(seedPlanCatalog()),
    ]);
    await expect(
      db.query(`insert into plan_catalog_versions (status, payload) values ('draft', $1)`, [
        json(seedPlanCatalog()),
      ]),
    ).rejects.toThrow(/plan_catalog_versions_one_draft/);
    await db.query(`delete from plan_catalog_versions where status = 'draft'`);
  });

  it("keeps published history unchanged, even for the server", async () => {
    const { id } = await published();
    await expect(
      db.query(`update plan_catalog_versions set payload = $1 where id = $2`, [
        json(changed("solo", (plan) => (plan.monthly.CZK = 1))),
        id,
      ]),
    ).rejects.toThrow(/plan_catalog_history/);
    await expect(db.query(`delete from plan_catalog_versions where id = $1`, [id])).rejects.toThrow(
      /plan_catalog_history/,
    );
  });

  it("refuses an invalid payload, even from the server", async () => {
    await asServer();
    const seed = seedPlanCatalog();
    const bad: unknown[] = [
      seed.slice(0, 2),
      changed("solo", (plan) => (plan.monthly.CZK = -1)),
      changed("solo", (plan) => (plan.monthly.EUR = 0)),
      changed("solo", (plan) => (plan.monthly.EUR = 19.999)),
      changed("solo", (plan) => (plan.yearly.CZK = 12 * 490 + 1)),
      changed("solo", (plan) => (plan.key = "beta" as never)),
      changed("solo", (plan) => (plan.recommended = true)),
      changed("solo", (plan) => (plan.order = 1)),
      changed("solo", (plan) => (plan.limits.ai_calls = -1)),
      changed("solo", (plan) => (plan.limits.ai_calls = 1.5)),
      changed("solo", (plan) => (plan.limits.ai_calls = null as never)),
      changed("solo", (plan) => (plan.limits.workers = "5" as never)),
      changed("solo", (plan) => (plan.name.cs = " ")),
      changed("solo", (plan) => (plan.name.en = "x".repeat(41))),
      changed("solo", (plan) => (plan.features[0].cs = "")),
      changed("solo", (plan) => (plan.features[0].highlight = "yes" as never)),
      changed("solo", (plan) => Object.assign(plan, { extra: 1 })),
      changed("solo", (plan) => Object.assign(plan.monthly, { USD: 20 })),
      changed("solo", (plan) => (plan.features = Array(13).fill(plan.features[0]))),
    ];
    for (const payload of bad) {
      expect(
        (await one<{ ok: boolean }>(`select valid_plan_catalog($1::jsonb) as ok`, [json(payload)])).ok,
        json(payload).slice(0, 200),
      ).toBe(false);
    }
    expect(
      (await one<{ ok: boolean }>(`select valid_plan_catalog($1::jsonb) as ok`, [json(seed)])).ok,
    ).toBe(true);
    for (const scalar of ["1", '"x"', "{}", "null", "[1, 2, 3]"]) {
      expect((await one<{ ok: boolean }>(`select valid_plan_catalog($1::jsonb) as ok`, [scalar])).ok).toBe(
        false,
      );
    }
  });
});

describe("the writers", () => {
  it("refuse a regular user and the owner without the second factor", async () => {
    await asUser(user);
    await expect(saveDraft(seedPlanCatalog())).rejects.toThrow(/admin_required/);
    await asUser(owner, "aal1");
    await expect(saveDraft(seedPlanCatalog())).rejects.toThrow(/admin_required/);
    const { id } = await published();
    await asUser(owner, "aal1");
    await expect(publish(seedPlanCatalog(), id)).rejects.toThrow(/admin_required/);
    await expect(restore(id, id)).rejects.toThrow(/admin_required/);
    await expect(db.query(`select public.admin_plan_catalog_discard_draft(null)`)).rejects.toThrow(
      /admin_required/,
    );
    await asServer();
    expect(await rows(`select 1 from plan_catalog_versions where status = 'draft'`)).toHaveLength(0);
  });

  it("save a draft without publishing it, then discard it", async () => {
    const before = await published();
    const draft = changed("solo", (plan) => (plan.monthly.CZK = 520));
    await asUser(owner);
    const first = (await saveDraft(draft)).rows[0].id;
    const again = (await saveDraft(changed("solo", (plan) => (plan.monthly.CZK = 530)))).rows[0].id;
    expect(again).toBe(first);
    expect(await published()).toEqual(before);
    await asServer();
    expect(
      (await one<{ n: number }>(`select count(*)::int as n from plan_catalog_versions where status = 'draft'`)).n,
    ).toBe(1);

    await asUser(owner);
    expect(
      (await one<{ ok: boolean }>(`select public.admin_plan_catalog_discard_draft(null) as ok`)).ok,
    ).toBe(true);
    expect(
      (await one<{ ok: boolean }>(`select public.admin_plan_catalog_discard_draft(null) as ok`)).ok,
    ).toBe(false);
    await asServer();
    expect(await rows(`select 1 from plan_catalog_versions where status = 'draft'`)).toHaveLength(0);
    const audit = await rows<{ target: string; detail: { action: string } }>(
      `select target, detail from admin_audit where target like 'settings.plans%' order by id`,
    );
    expect(audit.map((row) => row.detail.action)).toEqual([
      "save_draft",
      "save_draft",
      "discard_draft",
    ]);
  });

  it("refuse an invalid draft", async () => {
    await asUser(owner);
    await expect(saveDraft(changed("pro", (plan) => (plan.monthly.EUR = -5)))).rejects.toThrow(
      /invalid_value/,
    );
    await asServer();
  });

  it("publish the draft the owner confirmed, archive the old one and change the limits", async () => {
    const before = await published();
    const draft = changed("pro", (plan) => {
      plan.monthly.CZK = 990;
      plan.limits.ai_calls = 1200;
    });
    await asUser(owner);
    await saveDraft(draft);
    // The confirmation compared with another version, or showed other values: nothing happens.
    await expect(publish(draft, crypto.randomUUID())).rejects.toThrow(/stale/);
    await expect(publish(seedPlanCatalog(), before.id)).rejects.toThrow(/stale/);
    const { id } = (await publish(draft, before.id)).rows[0];

    const now = await published();
    expect(now).toEqual({ id, payload: draft, published_by: owner });
    expect(
      await one(`select status from plan_catalog_versions where id = $1`, [before.id]),
    ).toEqual({ status: "archived" });
    expect(await rows(`select 1 from plan_catalog_versions where status = 'draft'`)).toHaveLength(0);
    expect((await one<{ ai_calls_limit: number }>(`select * from current_plan($1)`, [user])).ai_calls_limit).toBe(1200);

    // A second publish against the same old version (another tab) loses.
    await asUser(owner);
    await saveDraft(seedPlanCatalog());
    await expect(publish(seedPlanCatalog(), before.id)).rejects.toThrow(/stale/);
    expect(
      (await one<{ ok: boolean }>(`select public.admin_plan_catalog_discard_draft(null) as ok`)).ok,
    ).toBe(true);
    await asServer();
    const audit = await one<{ detail: Row }>(
      `select detail from admin_audit where target = 'settings.plans' order by id desc limit 1`,
    );
    expect(audit.detail).toEqual({ action: "publish", from: before.id, to: id });
  });

  it("bring back an earlier version as a new published copy", async () => {
    await asServer();
    const original = await one<{ id: string }>(
      `select id from plan_catalog_versions where status = 'archived' order by published_at limit 1`,
    );
    const current = await published();
    await asUser(owner);
    await expect(restore(current.id, current.id)).rejects.toThrow(/invalid_value/);
    await expect(restore(original.id, original.id)).rejects.toThrow(/stale/);
    const { id } = (await restore(original.id, current.id)).rows[0];
    const now = await published();
    expect(now.id).toBe(id);
    expect(now.id).not.toBe(original.id);
    expect(now.payload).toEqual(seedPlanCatalog());
    expect((await one<{ ai_calls_limit: number }>(`select * from current_plan($1)`, [user])).ai_calls_limit).toBe(1000);
    expect(
      (await one<{ n: number }>(`select count(*)::int as n from plan_catalog_versions where status = 'published'`)).n,
    ).toBe(1);
  });
});

describe("limits of what an account holds", () => {
  async function addWorkers(count: number, daysAgo: number) {
    await asServer();
    for (let index = 0; index < count; index += 1) {
      await db.query(
        `insert into workers (owner_id, name, status, created_at) values ($1, 'W', 'active', now() - make_interval(days => $2))`,
        [user, daysAgo],
      );
    }
  }
  async function publishAsOwner(payload: PlanCatalog) {
    const { id } = await published();
    await asUser(owner);
    await saveDraft(payload);
    await publish(payload, id);
    await asServer();
  }

  it("show in the impact before publishing", async () => {
    await addWorkers(3, 5);
    await asServer();
    const impact = await rows<{ plan_key: string; users: number; over_limit: number }>(
      `select * from plan_catalog_impact($1::jsonb) order by plan_key`,
      [json(changed("pro", (plan) => (plan.limits.workers = 2)))],
    );
    const pro = impact.find((row) => row.plan_key === "pro");
    expect(pro).toEqual({ plan_key: "pro", users: 1, over_limit: 1 });
    expect(impact.find((row) => row.plan_key === "team")).toEqual({
      plan_key: "team",
      users: 0,
      over_limit: 0,
    });
  });

  it("make the workspace read-only only from the next day, without deleting anything", async () => {
    await publishAsOwner(changed("pro", (plan) => (plan.limits.workers = 2)));
    const overage = await one<Row>(`select * from plan_overage($1)`, [user]);
    expect(overage).toMatchObject({ plan_key: "pro", workers_used: 3, workers_limit: 2 });
    expect(new Date(overage.read_only_from as string).getTime()).toBeGreaterThan(Date.now());
    expect((await one<{ read_only: boolean }>(`select * from current_plan($1)`, [user])).read_only).toBe(
      false,
    );

    // A day later (the version published two days ago) the same account is read-only.
    await db.exec(`set session_replication_role = replica;`);
    await db.query(
      `update plan_catalog_versions set published_at = now() - interval '2 days' where status = 'published'`,
    );
    await db.exec(`set session_replication_role = origin;`);
    const plan = await one<Row>(`select * from current_plan($1)`, [user]);
    expect(plan).toMatchObject({ plan_key: "pro", status: "trialing", read_only: true, ai_calls_limit: 0 });
    await asUser(user);
    await expect(
      db.query(`insert into milestones (user_id, title) values ($1, 'New')`, [user]),
    ).rejects.toThrow(/read_only/);
    // Taking a worker's access away is still possible, and brings the account back.
    await db.query(
      `update workers set status = 'inactive' where id = (select id from workers where owner_id = $1 order by created_at limit 1)`,
      [user],
    );
    await asServer();
    expect(await rows(`select 1 from workers where owner_id = $1`, [user])).toHaveLength(3);
    expect((await one<{ read_only: boolean }>(`select * from current_plan($1)`, [user])).read_only).toBe(
      false,
    );
  });

  it("count storage the same way", async () => {
    await asServer();
    await db.query(
      `insert into attachments (user_id, entity_type, entity_id, storage_path, file_name, mime_type, size_bytes, created_at)
       values ($1::uuid, 'jarvis_message', gen_random_uuid(), $1::text || '/' || gen_random_uuid(), 'a.pdf', 'application/pdf', 3 * 1048576, now() - interval '3 days')`,
      [user],
    );
    await publishAsOwner(changed("pro", (plan) => (plan.limits.storage_mb = 2)));
    const overage = await one<Row>(`select * from plan_overage($1)`, [user]);
    expect(overage).toMatchObject({ storage_bytes: 3 * 1048576, storage_limit_bytes: 2 * 1048576 });
    expect(overage.read_only_from).not.toBeNull();
    expect((await one<{ read_only: boolean }>(`select * from current_plan($1)`, [user])).read_only).toBe(
      false,
    );
  });
});

describe("deleted accounts", () => {
  it("leave their versions in the history without an author", async () => {
    await asServer();
    await expect(
      db.query(`update plan_catalog_versions set published_by = $1 where status = 'published'`, [user]),
    ).rejects.toThrow(/plan_catalog_history/);
    const before = await one<{ n: number }>(`select count(*)::int as n from plan_catalog_versions`);
    await db.query(`delete from auth.users where id = $1`, [owner]);
    const after = await rows<{ created_by: string | null; published_by: string | null; status: string }>(
      `select created_by, published_by, status from plan_catalog_versions`,
    );
    expect(after).toHaveLength(before.n);
    expect(after.every((row) => row.created_by === null && row.published_by === null)).toBe(true);
    expect(after.filter((row) => row.status === "published")).toHaveLength(1);
  });
});
