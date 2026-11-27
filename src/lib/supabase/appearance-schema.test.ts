// @vitest-environment node
//
// Themes through the day and custom themes (30.6) on the real migrations
// (PGlite): the shape checks match the app's, a custom theme is only its
// author's (at most 12, readable text, the code made by the database), a
// colleague reads it by code to import a copy and a stranger does not, and
// the schedule in user_settings respects locked themes and own custom ones.

import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { contrastRatio } from "@/features/appearance/color";
import {
  generateFromColor,
  isReadable,
  parseCustomThemeTokens,
  tokensFromBuiltin,
} from "@/features/appearance/custom-tokens";
import { parseThemeSchedule } from "@/features/appearance/schedule";
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

let db: PGlite;
let owner: string;
let worker: string;
let stranger: string;

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
  const { rows } = await db.query<{ id: string }>(
    `insert into auth.users (email, raw_user_meta_data) values ($1, '{"locale":"cs"}') returning id`,
    [`${crypto.randomUUID()}@example.com`],
  );
  return rows[0]!.id;
}
async function scalar<T>(sql: string, params: unknown[] = []): Promise<T> {
  const { rows } = await db.query<{ v: T }>(sql, params);
  return rows[0]!.v;
}
function insertTheme(uid: string, name: string, tokens: unknown) {
  return as(uid, () =>
    db.query<{ id: string; share_code: string; user_id: string }>(
      `insert into custom_themes (name, tokens) values ($1, $2) returning id, share_code, user_id`,
      [name, JSON.stringify(tokens)],
    ),
  );
}

const dark = tokensFromBuiltin("gradus");

beforeAll(async () => {
  db = new PGlite({ extensions: PGLITE_EXTENSIONS });
  await db.exec(SUPABASE_STUBS);
  for (const file of readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    await db.exec(readFileSync(path.join(MIGRATIONS_DIR, file), "utf8"));
  }
  owner = await createAuthUser();
  worker = await createAuthUser();
  stranger = await createAuthUser();
  await db.query(
    `insert into workers (owner_id, user_id, name, status) values ($1, $2, 'Worker', 'active')`,
    [owner, worker],
  );
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe("the shape checks match the app", () => {
  const samples: unknown[] = [
    dark,
    tokensFromBuiltin("light"),
    generateFromColor("#ff8a3d", "dark"),
    { ...dark, colors: { ...dark.colors, success: "#22aa66" } },
    { ...dark, colors: { ...dark.colors, canvas: "#FFFFFF" } },
    { ...dark, colors: { ...dark.colors, canvas: "red" } },
    { ...dark, colors: { ...dark.colors, extra: "#000000" } },
    { ...dark, radius: 25 },
    { ...dark, radius: 2.5 },
    { ...dark, density: "huge" },
    { ...dark, headingFont: "comic" },
    { ...dark, css: "x" },
    { ...dark, v: 2 },
    [],
  ];

  it.each(samples.map((sample, index) => [index, sample]))("tokens sample %i", async (_index, sample) => {
    const sql = await scalar<boolean>(`select public.valid_custom_theme_tokens($1::jsonb) as v`, [
      JSON.stringify(sample),
    ]);
    expect(sql).toBe(parseCustomThemeTokens(sample) !== null);
  });

  it("computes the same contrast", async () => {
    for (const [a, b] of [
      ["#ffffff", "#000000"],
      ["#7c5cff", "#0d1234"],
      ["#777777", "#ffffff"],
      ["#12162e", "#f4f5fb"],
    ]) {
      const sql = await scalar<number>(`select public.hex_contrast($1, $2) as v`, [a, b]);
      expect(sql).toBeCloseTo(contrastRatio(a, b), 6);
    }
  });

  it("agrees on what reads", async () => {
    for (const tokens of [
      dark,
      { ...dark, colors: { ...dark.colors, ink: "#20263f" } },
      { ...dark, colors: { ...dark.colors, accent: "#1a1f44" } },
      { ...dark, colors: { ...dark.colors, danger: "#2a1020" } },
    ]) {
      const sql = await scalar<boolean>(`select public.custom_theme_readable($1::jsonb) as v`, [
        JSON.stringify(tokens),
      ]);
      expect(sql).toBe(isReadable(tokens));
    }
  });

  const block = (id: string, start: number, theme = "gradus", extra: Record<string, unknown> = {}) => ({
    id,
    name: id,
    start,
    theme,
    caption: null,
    ...extra,
  });
  const schedules: unknown[] = [
    null,
    { v: 1, enabled: true, mode: "same", days: { all: [block("a", 360), block("b", 1080)] } },
    {
      v: 1,
      enabled: false,
      mode: "weekdays",
      days: { weekdays: [block("a", 0), block("b", 60)], weekend: [block("c", 0, "light"), block("d", 1439)] },
    },
    { v: 1, enabled: true, mode: "same", days: { all: [block("a", 360)] } },
    { v: 1, enabled: true, mode: "same", days: { all: [block("a", 360), block("b", 360)] } },
    { v: 1, enabled: true, mode: "same", days: { all: [block("a", 360), block("a", 400)] } },
    { v: 1, enabled: true, mode: "same", days: { all: [block("a", 360), block("b", 1440)] } },
    { v: 1, enabled: true, mode: "same", days: { all: [block("a", 360), block("b", 400, "neon")] } },
    {
      v: 1,
      enabled: true,
      mode: "same",
      days: { all: [block("a", 360), block("b", 400, "custom:0f8fad5b-d9cb-469f-a165-70867728950e")] },
    },
    { v: 1, enabled: true, mode: "same", days: { all: [block("a", 360), block("b", 400, "gradus", { caption: " x" })] } },
    { v: 1, enabled: true, mode: "same", days: { all: [block("a", 360), block("b", 400, "gradus", { caption: "Káva" })] } },
    { v: 1, enabled: true, mode: "same", days: { all: [block("a", 360), block("b", 400)], weekend: [] } },
    { v: 1, enabled: true, mode: "each", days: { all: [block("a", 360), block("b", 400)] } },
  ];

  it.each(schedules.map((sample, index) => [index, sample]))("schedule sample %i", async (_index, sample) => {
    const sql = await scalar<boolean>(`select public.valid_theme_schedule($1::jsonb) as v`, [
      sample === null ? null : JSON.stringify(sample),
    ]);
    expect(sql).toBe(sample === null || parseThemeSchedule(sample) !== null);
  });

  it("the plan catalog takes the flag custom_themes, only as true or false", async () => {
    const plan = await scalar<Record<string, unknown>>(
      `select payload -> 0 as v from plan_catalog_versions where status = 'published' limit 1`,
    );
    const ok = (value: unknown) =>
      scalar<boolean>(`select public.plan_catalog_plan_ok($1::jsonb) as v`, [JSON.stringify(value)]);
    expect(await ok(plan)).toBe(true);
    expect(await ok({ ...plan, custom_themes: false })).toBe(true);
    expect(await ok({ ...plan, custom_themes: "no" })).toBe(false);
  });
});

describe("custom_themes", () => {
  let themeId = "";
  let code = "";

  it("the author makes one; the database picks the code and the owner", async () => {
    const { rows } = await insertTheme(owner, "Ráno", dark);
    themeId = rows[0]!.id;
    code = rows[0]!.share_code;
    expect(code).toMatch(/^[2-9A-HJKMNP-TV-Z]{10}$/);
    expect(rows[0]!.user_id).toBe(owner);
  });

  it("refuses unreadable text, a bad shape and a padded name", async () => {
    await expect(insertTheme(owner, "Šedé", { ...dark, colors: { ...dark.colors, ink: "#20263f" } })).rejects.toThrow();
    await expect(insertTheme(owner, "Zlé", { ...dark, css: "body{}" })).rejects.toThrow();
    await expect(insertTheme(owner, " Mezera", dark)).rejects.toThrow();
  });

  it("nobody changes the code or the owner, and the author renames it", async () => {
    await expect(
      as(owner, () => db.query(`update custom_themes set share_code = 'ABCDEFGHJK' where id = $1`, [themeId])),
    ).rejects.toThrow(/permission denied/);
    await expect(
      as(owner, () => db.query(`update custom_themes set user_id = $2 where id = $1`, [themeId, stranger])),
    ).rejects.toThrow(/permission denied/);
    await expect(
      as(owner, () => db.query(`insert into custom_themes (name, tokens, share_code) values ('x', $1, 'ABCDEFGHJK')`, [JSON.stringify(dark)])),
    ).rejects.toThrow(/permission denied/);
    const renamed = await as(owner, () =>
      db.query(`update custom_themes set name = 'Svítání' where id = $1`, [themeId]),
    );
    expect(renamed.affectedRows).toBe(1);
    expect(await scalar<string>(`select share_code as v from custom_themes where id = $1`, [themeId])).toBe(code);
  });

  it("only the author sees, changes or deletes it", async () => {
    for (const uid of [worker, stranger]) {
      const seen = await as(uid, () => db.query(`select id from custom_themes where id = $1`, [themeId]));
      expect(seen.rows).toEqual([]);
      const changed = await as(uid, () => db.query(`update custom_themes set name = 'x' where id = $1`, [themeId]));
      expect(changed.affectedRows).toBe(0);
      const deleted = await as(uid, () => db.query(`delete from custom_themes where id = $1`, [themeId]));
      expect(deleted.affectedRows).toBe(0);
    }
  });

  it("a colleague reads it by code to import a copy; a stranger does not", async () => {
    const colleague = await as(worker, () =>
      db.query<{ name: string }>(`select name from custom_theme_by_code($1)`, [code.toLowerCase()]),
    );
    expect(colleague.rows.map((row) => row.name)).toEqual(["Svítání"]);
    const outsider = await as(stranger, () =>
      db.query(`select name from custom_theme_by_code($1)`, [code]),
    );
    expect(outsider.rows).toEqual([]);
    await expect(db.query(`set role anon; select * from custom_theme_by_code('${code}')`)).rejects.toThrow();
    await db.exec(`reset role`);
  });

  it("a worker who left the company reads it no more", async () => {
    await db.query(`update workers set status = 'inactive' where user_id = $1`, [worker]);
    const after = await as(worker, () => db.query(`select name from custom_theme_by_code($1)`, [code]));
    expect(after.rows).toEqual([]);
    await db.query(`update workers set status = 'active' where user_id = $1`, [worker]);
  });

  it("twelve at most", async () => {
    const count = await scalar<number>(`select count(*)::int as v from custom_themes where user_id = $1`, [owner]);
    for (let i = count; i < 12; i += 1) await insertTheme(owner, `T${i}`, dark);
    await expect(insertTheme(owner, "Třináctý", dark)).rejects.toThrow(/custom_theme_limit/);
  });
});

describe("the schedule and the pick in user_settings", () => {
  const schedule = (theme: string) => ({
    v: 1,
    enabled: true,
    mode: "same",
    days: {
      all: [
        { id: "a", name: "Ráno", start: 360, theme, caption: null },
        { id: "b", name: "Večer", start: 1080, theme: "gradus", caption: null },
      ],
    },
  });
  const save = (uid: string, value: unknown) =>
    as(uid, () =>
      db.query(`update user_settings set theme_schedule = $2::jsonb where user_id = $1`, [uid, JSON.stringify(value)]),
    );

  it("an open theme and the account's own custom theme go in", async () => {
    const id = await scalar<string>(`select id as v from custom_themes where user_id = $1 limit 1`, [owner]);
    expect((await save(owner, schedule("gradus"))).affectedRows).toBe(1);
    expect((await save(owner, schedule(`custom:${id}`))).affectedRows).toBe(1);
    const picked = await as(owner, () =>
      db.query(`update user_settings set custom_theme_id = $2 where user_id = $1`, [owner, id]),
    );
    expect(picked.affectedRows).toBe(1);
  });

  it("a theme locked in game mode does not", async () => {
    await expect(save(owner, schedule("light"))).rejects.toThrow(/theme_locked/);
    await db.query(`update profiles set mode = 'tool' where id = $1`, [owner]);
    expect((await save(owner, schedule("light"))).affectedRows).toBe(1);
    await db.query(`update profiles set mode = 'game' where id = $1`, [owner]);
  });

  it("someone else's custom theme does not, neither in the schedule nor as the pick", async () => {
    const theirs = (await insertTheme(stranger, "Cizí", dark)).rows[0]!.id;
    await expect(save(owner, schedule(`custom:${theirs}`))).rejects.toThrow(/custom_theme_missing/);
    await expect(
      as(owner, () => db.query(`update user_settings set custom_theme_id = $2 where user_id = $1`, [owner, theirs])),
    ).rejects.toThrow(/custom_theme_missing/);
  });

  it("a broken schedule is refused by the check", async () => {
    await expect(save(owner, { v: 1, enabled: true, mode: "same", days: {} })).rejects.toThrow();
  });

  it("deleting the picked custom theme clears the pick", async () => {
    const id = await scalar<string>(`select custom_theme_id as v from user_settings where user_id = $1`, [owner]);
    expect(id).toBeTruthy();
    const deleted = await as(owner, () => db.query(`delete from custom_themes where id = $1`, [id]));
    expect(deleted.affectedRows).toBe(1);
    expect(await scalar<string | null>(`select custom_theme_id as v from user_settings where user_id = $1`, [owner])).toBeNull();
  });

  it("an override time is the account's own to set", async () => {
    const result = await as(owner, () =>
      db.query(`update user_settings set theme_override_until = now() + interval '1 hour' where user_id = $1`, [owner]),
    );
    expect(result.affectedRows).toBe(1);
    expect(
      (await as(stranger, () =>
        db.query(`update user_settings set theme_override_until = now() where user_id = $1`, [owner]),
      )).affectedRows,
    ).toBe(0);
  });
});
