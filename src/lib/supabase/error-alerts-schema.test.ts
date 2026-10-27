// @vitest-environment node
//
// E-mails about errors in the database (step 16.2): error_events and
// error_alert_sends are closed to every client; the server records errors
// through error_event_record() (limits for browsers, one row per code, the
// browser's copy of a server error linked) and decides every e-mail in
// error_alert_claim() — the same error at most once per 15 minutes, at most
// 30 e-mails an hour and then one "there are more", the digest mode, the
// tests' mock transport counted apart. The setting 'error_alerts' is the
// owner's e-mail at first, is checked by valid_error_alerts() and is written
// only by the owner with aal2, audited without the addresses. Runs every
// migration in PGlite with the same Supabase stubs as ai-caps-schema.test.ts.

import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ERROR_ALERT_LIMITS } from "@/features/errors/alerts/settings";
import { PGLITE_EXTENSIONS } from "./pglite-extensions";

const MIGRATIONS_DIR = path.resolve(__dirname, "../../../supabase/migrations");
const THIS_MIGRATION = "20261027090000_error_alerts.sql";

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
  } = {},
): Promise<Recorded> {
  await asService();
  return one<Recorded>(
    `select * from public.error_event_record(
       _code => $1, _fingerprint => $2, _source => $3, _page => '/app/finance',
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

const OWNER_EMAIL = "Owner.Account@Example.com";
let owner: string;
let user: string;

beforeAll(async () => {
  db = new PGlite({ extensions: PGLITE_EXTENSIONS });
  await db.exec(SUPABASE_STUBS);
  for (const file of readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    // The owner exists before this step's migration, as in production.
    if (file === THIS_MIGRATION) owner = await createAuthUser(OWNER_EMAIL);
    await db.exec(readFileSync(path.join(MIGRATIONS_DIR, file), "utf8"));
  }
  user = await createAuthUser();
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe("the error_alerts setting", () => {
  it("starts with the owner's e-mail, every error on its own", async () => {
    await asServer();
    const role = await one<{ n: number }>(
      `select count(*)::int as n from user_roles where user_id = $1 and role = 'owner'`,
      [owner],
    );
    expect(role.n).toBe(1);
    const { value } = await one<{ value: unknown }>(
      `select value from app_settings where key = 'error_alerts'`,
    );
    expect(value).toEqual({
      emails: ["owner.account@example.com"],
      mode: "every",
      digest_minutes: 15,
    });
  });

  it("accepts only valid values", async () => {
    await asServer();
    const valid = async (value: unknown) =>
      (
        await one<{ ok: boolean }>(`select public.valid_error_alerts($1::jsonb) as ok`, [
          JSON.stringify(value),
        ])
      ).ok;
    const base = { emails: ["a@b.cz"], mode: "every", digest_minutes: 15 };
    expect(await valid(base)).toBe(true);
    expect(await valid({ ...base, emails: [], mode: "digest", digest_minutes: 1440 })).toBe(true);
    const ten = Array.from({ length: 10 }, (_, i) => `x${i}@gradus.cz`);
    expect(await valid({ ...base, emails: ten })).toBe(true);
    for (const bad of [
      { ...base, emails: [...ten, "y@gradus.cz"] },
      { ...base, emails: ["A@b.cz"] },
      { ...base, emails: ["a@b.cz", "a@b.cz"] },
      { ...base, emails: ["not an e-mail"] },
      { ...base, emails: [1] },
      { ...base, emails: "a@b.cz" },
      { ...base, mode: "sometimes" },
      { ...base, digest_minutes: 4 },
      { ...base, digest_minutes: 1441 },
      { ...base, digest_minutes: 15.5 },
      { ...base, extra: true },
      { emails: ["a@b.cz"], mode: "every" },
      [],
      "every",
    ]) {
      expect(await valid(bad), JSON.stringify(bad)).toBe(false);
    }
    await expect(
      db.query(
        `update app_settings set value = '{"emails":[],"mode":"x","digest_minutes":15}' where key = 'error_alerts'`,
      ),
    ).rejects.toThrow(/app_settings_error_alerts_valid/);
  });

  it("is written only by the owner with aal2, audited without the addresses", async () => {
    const next = {
      emails: ["owner.account@example.com", "dev@gradus.cz"],
      mode: "digest",
      digest_minutes: 30,
    };
    const save = (value: unknown) =>
      db.query(`select public.admin_set_app_setting('error_alerts', $1::jsonb, null) as old`, [
        JSON.stringify(value),
      ]);
    await asUser(user);
    await expect(save(next)).rejects.toThrow(/admin_required/);
    await asUser(owner, "aal1");
    await expect(save(next)).rejects.toThrow(/admin_required/);
    await asUser(owner);
    await expect(save({ ...next, mode: "never" })).rejects.toThrow(/invalid_value/);
    await save(next);
    await expect(db.query(`select * from app_settings`)).rejects.toThrow(/permission denied/);

    await asServer();
    const { value } = await one<{ value: unknown }>(
      `select value from app_settings where key = 'error_alerts'`,
    );
    expect(value).toEqual(next);
    const audit = await one<{ detail: { from: Row; to: Row } }>(
      `select detail from admin_audit where target = 'settings.error_alerts' order by id desc limit 1`,
    );
    expect(audit.detail.from).toMatchObject({ emails: 1, mode: "every", digest_minutes: 15 });
    expect(audit.detail.to).toMatchObject({ emails: 2, mode: "digest", digest_minutes: 30 });
    expect(JSON.stringify(audit.detail)).not.toContain("@");
  });
});

describe("error_events and error_alert_sends", () => {
  it("are closed to the browser, signed in or not", async () => {
    for (const as of [() => asUser(user), () => asAnon()]) {
      await as();
      for (const table of ["error_events", "error_alert_sends"]) {
        await expect(db.query(`select * from ${table}`)).rejects.toThrow(/permission denied/);
      }
      await expect(
        db.query(
          `insert into error_events (code, fingerprint, source, page, message) values ('GR-ZZZZZZ', $1, 'boundary', '/', 'x')`,
          [fp("x")],
        ),
      ).rejects.toThrow(/permission denied/);
      for (const call of [
        `select public.error_event_record('GR-ZZZZZZ', '${fp("x")}', 'boundary', '/', 'x')`,
        `select public.error_alert_claim(gen_random_uuid())`,
        `select public.error_alert_digest_claim()`,
        `select public.purge_error_events()`,
      ]) {
        await expect(db.query(call), call).rejects.toThrow(/permission denied/);
      }
    }
    await asServer();
  });
});

describe("error_event_record", () => {
  beforeEach(clearSends);

  it("keeps one row per code", async () => {
    const errorCode = code();
    expect((await record({ errorCode })).outcome).toBe("created");
    expect(await record({ errorCode })).toEqual({ event_id: null, outcome: "duplicate" });
  });

  it("limits a browser per account and anonymously per address, never the server", async () => {
    for (let i = 0; i < 2; i += 1) {
      expect((await record({ userId: user, limits: [2, 1] })).outcome).toBe("created");
    }
    expect((await record({ userId: user, limits: [2, 1] })).outcome).toBe("limited");
    expect((await record({ ipHash: "a1b2c3d4e5f60718", limits: [2, 1] })).outcome).toBe("created");
    expect((await record({ ipHash: "a1b2c3d4e5f60718", limits: [2, 1] })).outcome).toBe("limited");
    expect((await record({ ipHash: "ffffffffffffffff", limits: [2, 1] })).outcome).toBe("created");
    // The server's own errors have no limit.
    expect((await record({ userId: user, source: "render" })).outcome).toBe("created");
  });

  it("links the browser's copy of a server error instead of e-mailing it twice", async () => {
    await record({ source: "render", digest: "2385967390" });
    const copy = await record({ source: "boundary", digest: "2385967390" });
    await asServer();
    const { alert } = await one<{ alert: string }>(`select alert from error_events where id = $1`, [
      copy.event_id,
    ]);
    expect(alert).toBe("linked");
    expect((await claim(copy.event_id!)).decision).toBe("skip");
  });
});

describe("error_alert_claim", () => {
  const ALERTS = {
    emails: ["owner.account@example.com", "dev@gradus.cz"],
    mode: "every",
    digest_minutes: 15,
  };
  beforeEach(async () => {
    await clearSends();
    await setAlerts(ALERTS);
  });

  it("e-mails an error once, then holds the same error back for 15 minutes", async () => {
    const first = await recordAndClaim({ fingerprint: fp("same") });
    expect(first).toMatchObject({
      decision: "send",
      recipients: ALERTS.emails,
      since_last: 0,
      day_count: 1,
    });
    expect((await claim(first.id)).decision).toBe("skip");

    const second = await recordAndClaim({ fingerprint: fp("same") });
    expect(second).toMatchObject({ decision: "throttled", day_count: 2 });
    // Another error is not held back by it.
    expect((await recordAndClaim({ fingerprint: fp("other") })).decision).toBe("send");

    // 16 minutes later the same error goes again, with the held-back one counted in.
    await asServer();
    await db.exec(`update error_alert_sends set created_at = created_at - interval '16 minutes'`);
    const third = await recordAndClaim({ fingerprint: fp("same") });
    expect(third).toMatchObject({ decision: "send", since_last: 1, day_count: 3 });
    const sends = await rows<{ kind: string; events: number; recipients: number }>(
      `select kind, events, recipients from error_alert_sends where fingerprint = $1 order by created_at`,
      [fp("same")],
    );
    expect(sends).toEqual([
      { kind: "error", events: 1, recipients: 2 },
      { kind: "error", events: 2, recipients: 2 },
    ]);
    const { alert } = await one<{ alert: string }>(`select alert from error_events where id = $1`, [
      second.id,
    ]);
    expect(alert).toBe("counted");
  });

  it("sends at most 30 an hour, then one 'there are more' e-mail, then nothing", async () => {
    await asServer();
    await db.query(
      `insert into error_alert_sends (kind, transport, recipients, created_at)
       select 'error', 'resend', 1, now() - interval '30 minutes' from generate_series(1, $1)`,
      [ERROR_ALERT_LIMITS.perHour],
    );
    expect((await recordAndClaim({ fingerprint: fp("flood-1") })).decision).toBe("overflow");
    expect((await recordAndClaim({ fingerprint: fp("flood-2") })).decision).toBe("suppressed");
    // The tests' mock e-mails are counted apart: a real error still goes for them.
    expect((await recordAndClaim({ fingerprint: fp("flood-3"), transport: "mock" })).decision).toBe(
      "send",
    );
    // An hour later the window has room again.
    await asServer();
    await db.exec(`update error_alert_sends set created_at = created_at - interval '1 hour'`);
    expect((await recordAndClaim({ fingerprint: fp("flood-4") })).decision).toBe("send");
  });

  it("in digest mode sends at once only when nothing went out in digest_minutes", async () => {
    await setAlerts({ ...ALERTS, mode: "digest", digest_minutes: 20 });
    expect((await recordAndClaim({ fingerprint: fp("d-1") })).decision).toBe("send");
    expect((await recordAndClaim({ fingerprint: fp("d-2") })).decision).toBe("digest");
    await asServer();
    await db.exec(`update error_alert_sends set created_at = created_at - interval '21 minutes'`);
    expect((await recordAndClaim({ fingerprint: fp("d-3") })).decision).toBe("send");
  });

  it("does nothing without addresses", async () => {
    await setAlerts({ ...ALERTS, emails: [] });
    expect((await recordAndClaim()).decision).toBe("off");
    await asServer();
    expect((await one<{ n: number }>(`select count(*)::int as n from error_alert_sends`)).n).toBe(
      0,
    );
  });
});

describe("error_alert_digest_claim", () => {
  beforeEach(clearSends);

  it("says nothing outside the digest mode or when nothing waited", async () => {
    await setAlerts({ emails: ["dev@gradus.cz"], mode: "every", digest_minutes: 15 });
    await recordAndClaim({ fingerprint: fp("e-1") });
    await recordAndClaim({ fingerprint: fp("e-1") }); // throttled
    await asService();
    expect(await rows(`select * from public.error_alert_digest_claim()`)).toEqual([]);
    await setAlerts({ emails: ["dev@gradus.cz"], mode: "digest", digest_minutes: 15 });
    await asServer();
    await db.exec(`update error_events set alert = 'sent'`);
    await asService();
    expect(await rows(`select * from public.error_alert_digest_claim()`)).toEqual([]);
  });

  it("sums up what waited, each error once, and counts it as reported", async () => {
    await setAlerts({ emails: ["dev@gradus.cz"], mode: "digest", digest_minutes: 15 });
    await recordAndClaim({ fingerprint: fp("g-1") }); // sent
    await recordAndClaim({ fingerprint: fp("g-1"), userId: user }); // throttled
    await recordAndClaim({ fingerprint: fp("g-1") }); // throttled
    await recordAndClaim({ fingerprint: fp("g-2") }); // digest
    await asService();
    const digest = await one<{ total: number; recipients: string[]; groups: Row[] }>(
      `select * from public.error_alert_digest_claim()`,
    );
    expect(digest.total).toBe(3);
    expect(digest.recipients).toEqual(["dev@gradus.cz"]);
    expect(digest.groups.map((group) => [group.fingerprint, group.n, group.users])).toEqual([
      [fp("g-1"), 2, 1],
      [fp("g-2"), 1, 0],
    ]);
    expect(digest.groups[0]).toMatchObject({ page: "/app/finance", source: "boundary" });
    expect(await rows(`select * from public.error_alert_digest_claim()`)).toEqual([]);
  });
});
