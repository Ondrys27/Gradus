// @vitest-environment node
//
// The administration's overview (step 29.2) in the database: the overview's
// tabs are the server's alone (no client access at all), the default layout
// for new administrators is an app setting the owner or a full admin writes
// (audited as counts), the e-mails about errors are off by default and the
// stored setting was switched off, "only critical" e-mails only a crash of
// signing in, signing up or payments or the same error at five people in an
// hour, and the Errors widget's numbers and the badge come from error_events
// and error_groups. Runs every migration in PGlite like
// error-alerts-schema.test.ts.

import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CRITICAL_PLACE_PATTERN, CRITICAL_USERS, isCriticalPlace } from "@/features/errors/alerts/critical";
import { ERROR_ALERT_LIMITS } from "@/features/errors/alerts/settings";
import { PGLITE_EXTENSIONS } from "./pglite-extensions";

const MIGRATIONS_DIR = path.resolve(__dirname, "../../../supabase/migrations");
const ALERTS_MIGRATION = "20261027090000_error_alerts.sql";
const THIS_MIGRATION = "20261206090000_admin_dashboard.sql";

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
async function asService() {
  await asServer();
  await db.exec(`set role service_role;`);
}
async function asAnon() {
  await asServer();
  await db.exec(`set role anon;`);
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
async function createAuthUser(email = `${crypto.randomUUID()}@example.com`) {
  await asServer();
  const { id } = await one<{ id: string }>(
    `insert into auth.users (email, raw_user_meta_data) values ($1, '{"locale":"cs"}') returning id`,
    [email],
  );
  return id;
}

let counter = 0;
function code() {
  counter += 1;
  return `GR-${counter.toString(36).toUpperCase().padStart(6, "A")}`;
}
function fp(label: string) {
  // 32 hex characters, the same for the same label.
  return Array.from(label.padEnd(16, "-").slice(0, 16), (char) =>
    char.charCodeAt(0).toString(16).padStart(2, "0").slice(-2),
  ).join("");
}

type Recorded = { event_id: string | null; outcome: string };
async function record(
  options: {
    fingerprint?: string;
    source?: string;
    userId?: string | null;
    ipHash?: string | null;
    digest?: string | null;
    transport?: "resend" | "mock";
    limits?: [number, number];
    errorCode?: string;
    page?: string;
  } = {},
): Promise<Recorded> {
  await asService();
  return one<Recorded>(
    `select * from public.error_event_record(
       _code => $1, _fingerprint => $2, _source => $3, _page => $10,
       _message => 'TypeError: x is undefined', _action => '/app/finance', _stack => 'at a (x.js:1:2)',
       _digest => $4, _user_id => $5, _browser => 'chrome', _device => 'desktop',
       _viewport => '1440x900', _locale => 'cs', _app_version => 'abc1234', _ip_hash => $6,
       _transport => $7, _limit_user => $8, _limit_anonymous => $9)`,
    [
      options.errorCode ?? code(),
      options.fingerprint ?? fp("default"),
      options.source ?? "boundary",
      options.digest ?? null,
      options.userId ?? null,
      options.ipHash ?? null,
      options.transport ?? "resend",
      options.limits?.[0] ?? null,
      options.limits?.[1] ?? null,
      options.page ?? "/app/finance",
    ],
  );
}

type Claim = {
  decision: string;
  send_id: string | null;
  recipients: string[] | null;
  since_last: number;
  day_count: number;
};
async function claim(eventId: string): Promise<Claim> {
  await asService();
  return one<Claim>(`select * from public.error_alert_claim($1, $2, $3)`, [
    eventId,
    ERROR_ALERT_LIMITS.fingerprintMinutes,
    ERROR_ALERT_LIMITS.perHour,
  ]);
}
async function recordAndClaim(options: Parameters<typeof record>[0] = {}) {
  const recorded = await record(options);
  if (!recorded.event_id) throw new Error(`not recorded: ${recorded.outcome}`);
  return { id: recorded.event_id, ...(await claim(recorded.event_id)) };
}
async function setAlerts(value: unknown) {
  await asServer();
  await db.query(
    `insert into app_settings (key, value) values ('error_alerts', $1::jsonb)
     on conflict (key) do update set value = excluded.value`,
    [JSON.stringify(value)],
  );
}
async function clearSends() {
  await asServer();
  await db.exec(`delete from error_alert_sends; delete from error_events;`);
}

const OWNER_EMAIL = "owner.dash@example.com";
let owner: string;
let fullAdmin: string;
let limitedAdmin: string;

beforeAll(async () => {
  db = new PGlite({ extensions: PGLITE_EXTENSIONS });
  await db.exec(SUPABASE_STUBS);
  for (const file of readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    // The owner exists before the alerts are set up, as in production: the
    // first setting is the owner's e-mail, mode "every" (16.2).
    if (file === ALERTS_MIGRATION) owner = await createAuthUser(OWNER_EMAIL);
    if (file === THIS_MIGRATION) {
      await asServer();
      const { value } = await one<{ value: { mode: string } }>(
        `select value from app_settings where key = 'error_alerts'`,
      );
      expect(value.mode).toBe("every");
    }
    await db.exec(readFileSync(path.join(MIGRATIONS_DIR, file), "utf8"));
  }
  fullAdmin = await createAuthUser();
  limitedAdmin = await createAuthUser();
  await asServer();
  await db.query(
    `insert into user_roles (user_id, role, level) values ($1, 'admin', 'full'), ($2, 'admin', 'limited')`,
    [fullAdmin, limitedAdmin],
  );
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe("admin_dashboard_layouts", () => {
  it("is closed to the browser, even to an administrator", async () => {
    for (const as of [() => asUser(owner), () => asUser(fullAdmin), () => asAnon()]) {
      await as();
      await expect(db.query(`select * from admin_dashboard_layouts`)).rejects.toThrow(
        /permission denied/,
      );
      await expect(
        db.query(`insert into admin_dashboard_layouts (user_id, is_default) values ($1, true)`, [
          owner,
        ]),
      ).rejects.toThrow(/permission denied/);
    }
  });

  it("keeps the shape of a layout, one main tab and six tabs at most", async () => {
    await asServer();
    const items = JSON.stringify([
      { id: "a1", widget: "errors", size: "L", x: 0, y: 0, settings: {} },
    ]);
    await db.query(
      `insert into admin_dashboard_layouts (user_id, is_default, position) values ($1, true, 0)`,
      [owner],
    );
    await expect(
      db.query(
        `insert into admin_dashboard_layouts (user_id, is_default, position, items) values ($1, true, 1, $2::jsonb)`,
        [owner, items],
      ),
    ).rejects.toThrow(/admin_dashboard_layouts_main_idx/);
    for (let position = 1; position <= 5; position += 1) {
      await db.query(
        `insert into admin_dashboard_layouts (user_id, name, position, items) values ($1, $2, $3, $4::jsonb)`,
        [owner, `Tab ${position}`, position, items],
      );
    }
    await expect(
      db.query(
        `insert into admin_dashboard_layouts (user_id, name, position, items) values ($1, 'Seven', 6, $2::jsonb)`,
        [owner, items],
      ),
    ).rejects.toThrow(/admin_dashboard_layouts_position/);
    await expect(
      db.query(
        `insert into admin_dashboard_layouts (user_id, name, position, items) values ($1, 'Bad', 1, '[{"widget":"x"}]'::jsonb)`,
        [fullAdmin],
      ),
    ).rejects.toThrow(/admin_dashboard_layouts_items/);
    await expect(
      db.query(
        `insert into admin_dashboard_layouts (user_id, position, items) values ($1, 2, $2::jsonb)`,
        [fullAdmin, items],
      ),
    ).rejects.toThrow(/admin_dashboard_layouts_name/);
  });
});

describe("the default overview for administrators", () => {
  const layout = [{ id: "a1", widget: "errors", size: "L", x: 0, y: 0, settings: {} }];
  const save = (value: unknown) =>
    db.query(`select public.admin_set_app_setting('admin_dashboard_default', $1::jsonb, null)`, [
      JSON.stringify(value),
    ]);

  it("is written by the owner or a full admin with aal2, never a limited one", async () => {
    await asUser(limitedAdmin);
    await expect(save(layout)).rejects.toThrow(/admin_required/);
    await asUser(owner, "aal1");
    await expect(save(layout)).rejects.toThrow(/admin_required/);
    await asUser(fullAdmin);
    await expect(save([{ widget: "x" }])).rejects.toThrow(/invalid_value/);
    await save(layout);
    await asUser(owner);
    await save([...layout, { id: "a2", widget: "health", size: "M", x: 2, y: 0, settings: {} }]);
    await asServer();
    const { value } = await one<{ value: unknown[] }>(
      `select value from app_settings where key = 'admin_dashboard_default'`,
    );
    expect(value).toHaveLength(2);
    const audit = await one<{ detail: Row }>(
      `select detail from admin_audit where target = 'settings.admin_dashboard_default' order by id desc limit 1`,
    );
    expect(audit.detail).toEqual({
      key: "admin_dashboard_default",
      from: { widgets: 1 },
      to: { widgets: 2 },
    });
  });
});

describe("error e-mails", () => {
  const ALERTS = { emails: ["owner.dash@example.com"], mode: "every", digest_minutes: 15 };
  beforeEach(async () => {
    await clearSends();
  });

  it("were switched off by the migration, and off is a valid mode", async () => {
    await asServer();
    const { value } = await one<{ value: { mode: string; emails: string[] } }>(
      `select value from app_settings where key = 'error_alerts'`,
    );
    expect(value).toEqual({ emails: ["owner.dash@example.com"], mode: "off", digest_minutes: 15 });
    for (const mode of ["off", "critical", "digest", "every"]) {
      const { ok } = await one<{ ok: boolean }>(`select public.valid_error_alerts($1::jsonb) as ok`, [
        JSON.stringify({ ...ALERTS, mode }),
      ]);
      expect(ok, mode).toBe(true);
    }
  });

  it("send nothing in mode off, addresses or not", async () => {
    await setAlerts({ ...ALERTS, mode: "off" });
    const claimed = await recordAndClaim({ fingerprint: fp("off-1") });
    expect(claimed.decision).toBe("off");
    await asServer();
    expect((await one<{ n: number }>(`select count(*)::int as n from error_alert_sends`)).n).toBe(0);
    const { alert } = await one<{ alert: string }>(`select alert from error_events where id = $1`, [
      claimed.id,
    ]);
    expect(alert).toBe("off");
  });

  it("in mode critical send a crash of signing in, signing up or payments", async () => {
    await setAlerts({ ...ALERTS, mode: "critical" });
    expect((await recordAndClaim({ fingerprint: fp("plain"), page: "/app/finance" })).decision).toBe(
      "off",
    );
    for (const [label, page] of [
      ["login", "/prihlaseni"],
      ["login-en", "/en/login"],
      ["signup", "/registrace"],
      ["stripe", "/api/stripe/webhook"],
      ["plan", "/app/nastaveni/predplatne"],
    ] as const) {
      expect((await recordAndClaim({ fingerprint: fp(label), page })).decision, page).toBe("send");
      expect(isCriticalPlace(page, null), page).toBe(true);
    }
    expect(isCriticalPlace("/app/finance", null)).toBe(false);
  });

  it("in mode critical send the same error once it hits five people within an hour", async () => {
    await setAlerts({ ...ALERTS, mode: "critical" });
    const people: string[] = [];
    for (let i = 0; i < CRITICAL_USERS; i += 1) people.push(await createAuthUser());
    for (let i = 0; i < CRITICAL_USERS - 1; i += 1) {
      const claimed = await recordAndClaim({ fingerprint: fp("spread"), userId: people[i] });
      expect(claimed.decision, `person ${i + 1}`).toBe("off");
    }
    // The same person again is not a fifth person.
    expect(
      (await recordAndClaim({ fingerprint: fp("spread"), userId: people[0] })).decision,
    ).toBe("off");
    const fifth = await recordAndClaim({
      fingerprint: fp("spread"),
      userId: people[CRITICAL_USERS - 1],
    });
    expect(fifth.decision).toBe("send");
  });

  it("use the same critical places as the code", () => {
    const sql = readFileSync(path.join(MIGRATIONS_DIR, THIS_MIGRATION), "utf8");
    expect(sql).toContain(`'${CRITICAL_PLACE_PATTERN}'`);
  });
});

describe("the Errors widget and the badge", () => {
  beforeEach(clearSends);

  async function overview() {
    await asService();
    const today = (
      await one<{ d: string }>(
        `select to_char((now() at time zone public.metrics_timezone())::date, 'YYYY-MM-DD') as d`,
      )
    ).d;
    const { o } = await one<{ o: Row }>(`select public.admin_error_overview($1, $2) as o`, [
      today,
      today,
    ]);
    return o as {
      new_today: number;
      open: number;
      users: number;
      returned: number;
      top: { fingerprint: string; occurrences: number; code: string }[];
    };
  }
  async function badge() {
    await asService();
    return (await one<{ n: number }>(`select public.admin_error_badge(30) as n`)).n;
  }

  it("counts new and open errors, the people hit and the top three", async () => {
    const someone = await createAuthUser();
    const other = await createAuthUser();
    await record({ fingerprint: fp("w-a"), userId: someone });
    await record({ fingerprint: fp("w-a"), userId: other });
    await record({ fingerprint: fp("w-a"), userId: someone });
    await record({ fingerprint: fp("w-b"), userId: someone });
    await record({ fingerprint: fp("w-c") });
    const now = await overview();
    expect(now).toMatchObject({ new_today: 3, open: 3, users: 2, returned: 0 });
    expect(now.top.map((group) => group.fingerprint)).toEqual([fp("w-a"), expect.any(String), expect.any(String)]);
    expect(now.top[0]!.occurrences).toBe(3);
    expect(await badge()).toBe(3);

    // Resolved is neither open nor new; in progress is open but not new.
    await asServer();
    await db.query(
      `insert into error_groups (fingerprint, status) values ($1, 'resolved'), ($2, 'in_progress')`,
      [fp("w-b"), fp("w-c")],
    );
    expect(await overview()).toMatchObject({ open: 2, new_today: 1 });
    expect(await badge()).toBe(1);

    // An error that happened before today and again today is not new today.
    await asServer();
    await db.query(
      `update error_events set created_at = now() - interval '3 days' where fingerprint = $1
       and id = (select id from error_events where fingerprint = $1 order by created_at limit 1)`,
      [fp("w-a")],
    );
    expect((await overview()).new_today).toBe(0);
    await asServer();
    await db.exec(`delete from error_groups`);
  });

  it("is closed to the browser", async () => {
    await asUser(owner);
    for (const call of [
      `select public.admin_error_overview(current_date, current_date)`,
      `select public.admin_error_badge(30)`,
      `select * from public.admin_users_at_risk(14, 10, false)`,
    ]) {
      await expect(db.query(call), call).rejects.toThrow(/permission denied/);
    }
    await asService();
    const rows = await rows_(`select * from public.admin_users_at_risk(14, 10, true)`);
    expect(Array.isArray(rows)).toBe(true);
  });
});

async function rows_(sql: string) {
  return rows(sql);
}
