// @vitest-environment node
//
// The MCP server's tables and the trash (step 28.8) on the real migrations
// (PGlite): OAuth tables are the server's only, a person reads only their own
// grants and calls, the company switch is the owner's, a worker's right
// "integrations: MCP" and the plan decide mcp_space_open(), the activity of an
// MCP step names the client, and deals and contacts trashed by Grady or a
// connected app vanish for every client query and come back on restore.

import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PERMISSION_CATALOG,
  defaultAllowed,
  isGrantSection,
} from "@/features/workers/permissions-catalog";
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
let anna: string;
let annaWorker: string;

async function rows<T = Row>(sql: string, params?: unknown[]): Promise<T[]> {
  return (await db.query<T>(sql, params as never)).rows;
}
async function one<T = Row>(sql: string, params?: unknown[]): Promise<T> {
  return (await rows<T>(sql, params))[0] as T;
}
async function as<T>(
  uid: string,
  run: () => Promise<T>,
  headers: Record<string, string> = {},
): Promise<T> {
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid]);
  await db.query(`select set_config('request.headers', $1, false)`, [JSON.stringify(headers)]);
  await db.exec(`set role authenticated`);
  try {
    return await run();
  } finally {
    await db.exec(
      `reset role; select set_config('request.jwt.claim.sub', '', false); select set_config('request.headers', '', false);`,
    );
  }
}
async function createAuthUser() {
  const { id } = await one<{ id: string }>(
    `insert into auth.users (email, raw_user_meta_data) values ($1, '{"locale":"cs"}') returning id`,
    [`${crypto.randomUUID()}@example.com`],
  );
  return id;
}
async function addWorker(account: string, actions: Record<string, string[]>) {
  const { id } = await one<{ id: string }>(
    `insert into workers (owner_id, user_id, name, status) values ($1, $2, 'W', 'active') returning id`,
    [owner, account],
  );
  await as(owner, () =>
    db.query(
      `insert into worker_permission_grants (owner_id, worker_id, section, action, allowed)
       select $1, $2, c.section, c.action, coalesce((($3::jsonb) -> c.section) ? c.action, false)
       from permission_catalog() c where c.section = any ($4::text[])
       on conflict (worker_id, section, action) do update set allowed = excluded.allowed`,
      [owner, id, JSON.stringify(actions), Object.keys(actions)],
    ),
  );
  return id;
}
async function openStage() {
  return (
    await one<{ id: string }>(
      `select id from pipeline_stages where user_id = $1 and not is_won and not is_lost order by position limit 1`,
      [owner],
    )
  ).id;
}
async function grantFor(user: string, space: string, level = "write") {
  const client = `client-${crypto.randomUUID()}`;
  await db.query(
    `insert into oauth_clients (id, kind, client_name, redirect_uris) values ($1, 'dcr', 'Claude', '{https://claude.ai/api/mcp/auth_callback}')`,
    [client],
  );
  return (
    await one<{ id: string }>(
      `insert into mcp_grants (user_id, space_id, space_ids, client_id, client_name, level, session_cipher)
       values ($1, $2, array[$2]::uuid[], $3, 'Claude', $4, 'secret') returning id`,
      [user, space, client, level],
    )
  ).id;
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
  anna = await createAuthUser();
  annaWorker = await addWorker(anna, {
    contacts: ["view", "create", "update"],
    pipeline: ["view", "view_all", "create", "update"],
  });
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe("permission catalog: integrations", () => {
  it("has integrations: view and mcp, both on without a row, like the app's catalog", async () => {
    const dbRows = await rows<{ section: string; action: string }>(
      `select section, action from permission_catalog() where section = 'integrations' order by action`,
    );
    expect(dbRows.map((row) => row.action)).toEqual(["mcp", "view"]);
    const ts = PERMISSION_CATALOG.find((section) => section.key === "integrations");
    expect(ts?.actions.map((action) => action.key).sort()).toEqual(["mcp", "view"]);
    for (const section of PERMISSION_CATALOG) {
      if (!isGrantSection(section.key)) continue;
      for (const action of section.actions) {
        const { allowed } = await one<{ allowed: boolean }>(
          `select permission_default($1, $2) as allowed`,
          [section.key, action.key],
        );
        expect(allowed, `${section.key}.${action.key}`).toBe(
          defaultAllowed(section.key, action.key),
        );
      }
    }
  });
});

describe("mcp_space_open", () => {
  it("opens the own space, a company with the right, and closes on the switch or the right", async () => {
    expect(
      (await as(owner, () => one<{ ok: boolean }>(`select mcp_space_open($1) as ok`, [owner]))).ok,
    ).toBe(true);
    expect(
      (await as(anna, () => one<{ ok: boolean }>(`select mcp_space_open($1) as ok`, [owner]))).ok,
    ).toBe(true);
    expect(
      (await as(stranger, () => one<{ ok: boolean }>(`select mcp_space_open($1) as ok`, [owner])))
        .ok,
    ).toBe(false);

    // The owner switches connected apps off for the company: the worker is out, the owner not.
    await as(owner, () =>
      db.query(`insert into mcp_space_settings (space_id, enabled) values ($1, false)`, [owner]),
    );
    expect(
      (await as(anna, () => one<{ ok: boolean }>(`select mcp_space_open($1) as ok`, [owner]))).ok,
    ).toBe(false);
    expect(
      (await as(owner, () => one<{ ok: boolean }>(`select mcp_space_open($1) as ok`, [owner]))).ok,
    ).toBe(true);
    await as(owner, () =>
      db.query(`update mcp_space_settings set enabled = true where space_id = $1`, [owner]),
    );

    // The right "integrations: MCP" off.
    await as(owner, () =>
      db.query(
        `insert into worker_permission_grants (owner_id, worker_id, section, action, allowed)
         values ($1, $2, 'integrations', 'mcp', false)`,
        [owner, annaWorker],
      ),
    );
    expect(
      (await as(anna, () => one<{ ok: boolean }>(`select mcp_space_open($1) as ok`, [owner]))).ok,
    ).toBe(false);
    await as(owner, () =>
      db.query(
        `delete from worker_permission_grants where worker_id = $1 and section = 'integrations'`,
        [annaWorker],
      ),
    );
  });

  it("lets nobody but the owner switch it, and a worker only read it", async () => {
    await expect(
      as(anna, () =>
        db.query(`update mcp_space_settings set enabled = false where space_id = $1`, [owner]),
      ),
    ).resolves.toMatchObject({ affectedRows: 0 });
    const seen = await as(anna, () =>
      rows(`select enabled from mcp_space_settings where space_id = $1`, [owner]),
    );
    expect(seen).toHaveLength(1);
    await expect(
      as(stranger, () =>
        db.query(`insert into mcp_space_settings (space_id, enabled) values ($1, false)`, [
          stranger === owner ? stranger : owner,
        ]),
      ),
    ).rejects.toThrow();
  });
});

describe("OAuth tables", () => {
  it("are closed to clients; a person reads only their own grants and calls, never the session", async () => {
    const grant = await grantFor(anna, owner);
    await db.query(
      `insert into oauth_tokens (token_hash, grant_id, kind, resource, expires_at)
       values (repeat('a', 64), $1, 'access', 'https://x/api/mcp', now() + interval '1 hour')`,
      [grant],
    );
    await db.query(
      `insert into mcp_calls (grant_id, user_id, space_id, tool, level, ok) values ($1, $2, $3, 'list_deals', 'read', true)`,
      [grant, anna, owner],
    );
    for (const table of ["oauth_clients", "oauth_codes", "oauth_tokens", "mcp_rate"]) {
      await expect(
        as(anna, () => db.query(`select * from ${table}`)),
        table,
      ).rejects.toThrow();
    }
    const own = await as(anna, () => rows(`select id, level from mcp_grants`));
    expect(own).toHaveLength(1);
    await expect(
      as(anna, () => db.query(`select session_cipher from mcp_grants`)),
    ).rejects.toThrow();
    expect(await as(owner, () => rows(`select id from mcp_grants`))).toHaveLength(0);
    expect(await as(anna, () => rows(`select tool from mcp_calls`))).toHaveLength(1);
    expect(await as(stranger, () => rows(`select tool from mcp_calls`))).toHaveLength(0);
    await expect(
      as(anna, () => db.query(`update mcp_grants set level = 'full' where id = $1`, [grant])),
    ).rejects.toThrow();
    await expect(
      as(anna, () =>
        db.query(
          `insert into mcp_calls (grant_id, user_id, space_id, tool, level, ok) values ($1, $2, $3, 'x_y', 'read', true)`,
          [grant, anna, owner],
        ),
      ),
    ).rejects.toThrow();
  });

  it("counts calls per minute for the rate limit", async () => {
    const grant = await grantFor(owner, owner);
    const first = await one<{ hits: number }>(`select mcp_rate_hit($1) as hits`, [grant]);
    const second = await one<{ hits: number }>(`select mcp_rate_hit($1) as hits`, [grant]);
    expect([first.hits, second.hits]).toEqual([1, 2]);
    await expect(as(owner, () => db.query(`select mcp_rate_hit($1)`, [grant]))).rejects.toThrow();
  });

  it("shows the owner which workers have a client connected in the company", async () => {
    const list = await as(owner, () =>
      rows<{ worker_id: string; clients: number }>(
        `select worker_id, clients from company_mcp_clients()`,
      ),
    );
    expect(list).toEqual([{ worker_id: annaWorker, clients: 1 }]);
    expect(await as(anna, () => rows(`select * from company_mcp_clients()`))).toHaveLength(0);
  });

  it("names the client in the company's activity, only for a live grant of the account", async () => {
    const grant = (
      await one<{ id: string }>(`select id from mcp_grants where user_id = $1`, [anna])
    ).id;
    await as(
      anna,
      () =>
        db.query(`insert into contacts (user_id, first_name) values ($1, 'Přes Claude')`, [owner]),
      { "x-gradus-via": "mcp", "x-gradus-mcp-grant": grant },
    );
    const row = await one<{ via: string; mcp_grant_id: string | null }>(
      `select via, mcp_grant_id from activity_log where summary ->> 'title' = 'Přes Claude'`,
    );
    expect(row).toEqual({ via: "mcp", mcp_grant_id: grant });
    // Somebody else's grant id is ignored.
    await as(
      owner,
      () =>
        db.query(`insert into contacts (user_id, first_name) values ($1, 'Cizí grant')`, [owner]),
      { "x-gradus-via": "mcp", "x-gradus-mcp-grant": grant },
    );
    const other = await one<{ mcp_grant_id: string | null }>(
      `select mcp_grant_id from activity_log where summary ->> 'title' = 'Cizí grant'`,
    );
    expect(other.mcp_grant_id).toBeNull();
  });
});

describe("trash", () => {
  it("hides a trashed deal with its tasks and deadline, and restores it", async () => {
    const stage = await openStage();
    const deal = await as(owner, () =>
      one<{ id: string }>(
        `insert into deals (user_id, stage_id, title, deadline_date) values ($1, $2, 'Do koše', current_date + 3) returning id`,
        [owner, stage],
      ),
    );
    await as(owner, () =>
      db.query(
        `insert into crm_tasks (user_id, title, due_at, deal_id) values ($1, 'Úkol obchodu', now(), $2)`,
        [owner, deal.id],
      ),
    );
    const count = (sql: string) =>
      as(owner, () => one<{ n: number }>(sql, [deal.id]).then((row) => row.n));
    expect(await count(`select count(*)::int as n from calendar_events where deal_id = $1`)).toBe(
      1,
    );

    const item = await as(
      owner,
      () => one<{ id: string }>(`select trash_record('deal', $1) as id`, [deal.id]),
      {
        "x-gradus-via": "mcp",
      },
    );
    expect(item.id).toBeTruthy();
    expect(await count(`select count(*)::int as n from deals where id = $1`)).toBe(0);
    expect(await count(`select count(*)::int as n from crm_tasks where deal_id = $1`)).toBe(0);
    expect(await count(`select count(*)::int as n from calendar_events where deal_id = $1`)).toBe(
      0,
    );
    const listed = await as(owner, () =>
      rows<{ kind: string; via: string; title: string }>(
        `select kind, via, title from trash_items`,
      ),
    );
    expect(listed).toContainEqual({ kind: "deal", via: "mcp", title: "Do koše" });

    await as(owner, () => db.query(`select trash_restore_record('deal', $1)`, [deal.id]));
    expect(await count(`select count(*)::int as n from deals where id = $1`)).toBe(1);
    expect(await count(`select count(*)::int as n from crm_tasks where deal_id = $1`)).toBe(1);
  });

  it("refuses a client writing deleted_at itself, and a worker without the delete right", async () => {
    const stage = await openStage();
    const deal = await as(owner, () =>
      one<{ id: string }>(
        `insert into deals (user_id, stage_id, title) values ($1, $2, 'Nesmím') returning id`,
        [owner, stage],
      ),
    );
    await expect(
      as(owner, () => db.query(`update deals set deleted_at = now() where id = $1`, [deal.id])),
    ).rejects.toThrow(/trash_denied/);
    await expect(
      as(anna, () => db.query(`select trash_record('deal', $1)`, [deal.id])),
    ).rejects.toThrow(/not_allowed/);
    await expect(
      as(stranger, () => db.query(`select trash_record('deal', $1)`, [deal.id])),
    ).rejects.toThrow(/not_allowed/);
  });

  it("hides a trashed contact from tables and activities; purge removes it after the retention", async () => {
    const contact = await as(owner, () =>
      one<{ id: string }>(
        `insert into contacts (user_id, first_name) values ($1, 'Smazaná') returning id`,
        [owner],
      ),
    );
    await as(owner, () => db.query(`select trash_record('contact', $1)`, [contact.id]));
    const seen = await as(owner, () =>
      rows(
        `select 1 from contact_table_entries where contact_id = $1 union all select 1 from contacts where id = $1`,
        [contact.id],
      ),
    );
    expect(seen).toHaveLength(0);
    await db.query(`update contacts set deleted_at = now() - interval '8 days' where id = $1`, [
      contact.id,
    ]);
    await db.query(
      `update trash_items set deleted_at = now() - interval '8 days' where record_id = $1`,
      [contact.id],
    );
    const purged = await one<{ n: number }>(`select purge_trash() as n`);
    expect(purged.n).toBeGreaterThanOrEqual(2);
    expect(await rows(`select 1 from contacts where id = $1`, [contact.id])).toHaveLength(0);
  });

  it("keeps the retention between 1 and 90 days", async () => {
    expect(
      (await one<{ ok: boolean }>(`select valid_trash_retention('{"days":7}') as ok`)).ok,
    ).toBe(true);
    expect(
      (await one<{ ok: boolean }>(`select valid_trash_retention('{"days":0}') as ok`)).ok,
    ).toBe(false);
    expect(
      (await one<{ ok: boolean }>(`select valid_trash_retention('{"days":7,"x":1}') as ok`)).ok,
    ).toBe(false);
    expect((await one<{ n: number }>(`select trash_retention_days() as n`)).n).toBe(7);
  });
});
