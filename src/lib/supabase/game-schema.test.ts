// @vitest-environment node
//
// The game core in the database: definitions and paths, award_xp() with its
// checks and daily caps, levels and level rewards, unlocks from template
// milestones, choose_path(), tool mode, badges and the streak. Runs every
// migration in PGlite with the same Supabase stubs as schema.test.ts, and
// checks that the SQL rules agree with src/features/game/rules.ts.

import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { computeStreak, DAILY_CAPS, levelForXp, xpForLevel } from "@/features/game/rules";
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
type Award = {
  awarded: boolean;
  xp: number;
  total_xp: number;
  level: number;
  previous_level: number;
  leveled_up: boolean;
  unlocks: { key: string; source: string; level: number | null }[];
  achievements: { key: string }[];
  streak: number;
};

let db: PGlite;

async function rows<T = Row>(sql: string, params?: unknown[]): Promise<T[]> {
  return (await db.query<T>(sql, params as never)).rows;
}
async function one<T = Row>(sql: string, params?: unknown[]): Promise<T> {
  return (await rows<T>(sql, params))[0] as T;
}
async function count(sql: string, params?: unknown[]) {
  return (await one<{ n: number }>(`select count(*)::int as n from (${sql}) q`, params)).n;
}
async function asUser(uid: string) {
  await db.exec(
    `select set_config('request.jwt.claim.sub', '${uid}', false); set role authenticated;`,
  );
}
async function asServer() {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
}
async function createAuthUser(locale = "en") {
  const { id } = await one<{ id: string }>(
    `insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id`,
    [`${crypto.randomUUID()}@example.com`, JSON.stringify({ locale })],
  );
  return id;
}
async function award(uid: string, reason: string, ref: string | null = null): Promise<Award> {
  await asUser(uid);
  const { result } = await one<{ result: Award }>(`select award_xp($1, $2) as result`, [
    reason,
    ref,
  ]);
  await asServer();
  return result;
}
async function totalXp(uid: string) {
  return (
    await one<{ n: number }>(
      `select coalesce(sum(xp), 0)::int as n from xp_events where user_id = $1`,
      [uid],
    )
  ).n;
}
async function newMilestone(uid: string, title = "Own milestone") {
  return (
    await one<{ id: string }>(
      `insert into milestones (user_id, title) values ($1, $2) returning id`,
      [uid, title],
    )
  ).id;
}
async function newTask(uid: string, milestone: string, parent: string | null = null) {
  return (
    await one<{ id: string }>(
      `insert into tasks (user_id, milestone_id, parent_task_id, title, status)
       values ($1, $2, $3, 'Task', 'done') returning id`,
      [uid, milestone, parent],
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
});

describe("definitions and paths", () => {
  it("are readable by every signed-in user and writable by none", async () => {
    const user = await createAuthUser();
    await asUser(user);
    expect(await count(`select 1 from paths`)).toBe(8);
    expect(await count(`select 1 from achievements`)).toBe(16);
    expect(await count(`select 1 from level_rewards`)).toBeGreaterThan(0);
    expect(await count(`select 1 from unlock_definitions where kind = 'section'`)).toBe(6);
    await expect(
      db.query(
        `insert into paths (key, name, description, icon) values ('x', '{"en":"x","cs":"x"}', '{"en":"x","cs":"x"}', 'x')`,
      ),
    ).rejects.toThrow();
    await db.query(`update achievements set icon = 'hacked'`);
    await db.query(`delete from path_tasks`);
    await asServer();
    expect(await count(`select 1 from achievements where icon = 'hacked'`)).toBe(0);
    expect(await count(`select 1 from path_tasks`)).toBeGreaterThan(0);
  });

  it("gives every path 4 chapters, 10–12 milestones of 3–6 tasks, in both languages", async () => {
    const paths = await rows<{ key: string }>(`select key from paths`);
    for (const { key } of paths) {
      const milestones = await rows<{
        id: string;
        chapter: number;
        title: { en: string; cs: string };
        tasks: number;
      }>(
        `select pm.id, pm.chapter, pm.title,
                (select count(*)::int from path_tasks t where t.path_milestone_id = pm.id) as tasks
         from path_milestones pm where pm.path_key = $1`,
        [key],
      );
      expect(milestones.length).toBeGreaterThanOrEqual(10);
      expect(milestones.length).toBeLessThanOrEqual(12);
      expect(new Set(milestones.map((m) => m.chapter))).toEqual(new Set([1, 2, 3, 4]));
      for (const m of milestones) {
        expect(m.tasks).toBeGreaterThanOrEqual(3);
        expect(m.tasks).toBeLessThanOrEqual(6);
        expect(m.title.en.length).toBeGreaterThan(0);
        expect(m.title.cs.length).toBeGreaterThan(0);
      }
    }
    expect(
      await count(`select 1 from path_tasks where title->>'en' = '' or title->>'cs' = ''`),
    ).toBe(0);
  });

  it("unlocks Contacts → Cold Calling → Pipeline → Calendar → Finance along every path", async () => {
    const paths = await rows<{ key: string }>(`select key from paths`);
    for (const { key } of paths) {
      const order = await rows<{ unlock_key: string }>(
        `select unlock_key from path_milestones
         where path_key = $1 and unlock_key is not null order by chapter, position`,
        [key],
      );
      expect(order.map((r) => r.unlock_key)).toEqual([
        "section_contacts",
        "section_cold_calling",
        "section_pipeline",
        "section_calendar",
        "section_finance",
      ]);
    }
    const workers = await one<{ level: number }>(
      `select level from level_rewards where unlock_key = 'section_workers'`,
    );
    expect(workers.level).toBe(10);
  });
});

describe("levels", () => {
  it("match the curve in rules.ts at every level and boundary", async () => {
    for (let level = 1; level <= 30; level++) {
      const sql = await one<{ xp: number; at: number; below: number }>(
        `select game_level_threshold($1)::int as xp,
                game_level_for_xp(game_level_threshold($1)) as at,
                game_level_for_xp(greatest(game_level_threshold($1) - 1, 0)) as below`,
        [level],
      );
      expect(sql.xp).toBe(xpForLevel(level));
      expect(sql.at).toBe(levelForXp(xpForLevel(level)));
      expect(sql.below).toBe(levelForXp(Math.max(0, xpForLevel(level) - 1)));
    }
    const top = await one<{ level: number }>(`select game_level_for_xp(10000000) as level`);
    expect(top.level).toBe(30);
  });

  it("caps match rules.ts", async () => {
    for (const [group, cap] of Object.entries(DAILY_CAPS)) {
      const sql = await one<{ cap: number }>(`select game_daily_cap($1) as cap`, [group]);
      expect(sql.cap).toBe(cap);
    }
  });
});

describe("award_xp", () => {
  it("pays a task 10 and a subtask 5, once, only for the caller's own finished ones", async () => {
    const user = await createAuthUser();
    const stranger = await createAuthUser();
    const milestone = await newMilestone(user);
    const task = await newTask(user, milestone);
    const subtask = await newTask(user, milestone, task);
    const open = (
      await one<{ id: string }>(
        `insert into tasks (user_id, milestone_id, title) values ($1, $2, 'Open') returning id`,
        [user, milestone],
      )
    ).id;

    expect((await award(user, "task_completed", task)).xp).toBe(10);
    expect((await award(user, "task_completed", subtask)).xp).toBe(5);
    const again = await award(user, "task_completed", task);
    expect(again.awarded).toBe(false);
    expect(again.xp).toBe(0);
    expect((await award(user, "task_completed", open)).xp).toBe(0);
    expect((await award(stranger, "task_completed", task)).xp).toBe(0);
    expect(await totalXp(user)).toBe(15);
    expect(await totalXp(stranger)).toBe(0);

    await asUser(user);
    await expect(db.query(`select award_xp('free_money', null)`)).rejects.toThrow(
      /unknown_xp_reason/,
    );
    await expect(db.query(`select award_xp('task_completed', 'not-a-uuid')`)).rejects.toThrow(
      /invalid_ref/,
    );
    await expect(
      db.query(
        `insert into xp_events (user_id, kind, xp, idempotency_key) values ($1, 'task_completed', 999, 'x')`,
        [user],
      ),
    ).rejects.toThrow();
    // Internal helpers are not callable from the client.
    await expect(
      db.query(`select game_grant($1, 'task_completed', 'y', 999, now())`, [user]),
    ).rejects.toThrow(/permission denied/);
    await asServer();
    expect(await totalXp(user)).toBe(15);
  });

  it("caps contact moves at 50, events at 25 and generated contacts at 30 a day", async () => {
    const user = await createAuthUser();
    const contact = (
      await one<{ id: string }>(
        `insert into contacts (user_id, company_name) values ($1, 'Acme') returning id`,
        [user],
      )
    ).id;
    for (let i = 0; i < 12; i++) {
      await db.query(
        `insert into contact_table_moves (user_id, actor_id, contact_id) values ($1, $1, $2)`,
        [user, contact],
      );
    }
    const moves: number[] = [];
    for (let i = 0; i < 12; i++) moves.push((await award(user, "contact_moved")).xp);
    expect(moves.reduce((a, b) => a + b, 0)).toBe(50);
    expect(moves.slice(10)).toEqual([0, 0]);

    for (let i = 0; i < 6; i++) {
      await db.query(
        `insert into calendar_events (user_id, actor_id, title, kind, starts_at) values ($1, $1, 'E', 'other', now())`,
        [user],
      );
    }
    let events = 0;
    for (let i = 0; i < 6; i++) events += (await award(user, "calendar_event")).xp;
    expect(events).toBe(25);

    // A meeting is paid as a meeting (40), not as an event.
    await db.query(
      `insert into calendar_events (user_id, actor_id, title, kind, starts_at) values ($1, $1, 'M', 'meeting', now())`,
      [user],
    );
    expect((await award(user, "calendar_event")).xp).toBe(0);
    expect((await award(user, "meeting_booked")).xp).toBe(40);

    for (let i = 0; i < 35; i++) {
      await db.query(
        `insert into contacts (user_id, company_name, source) values ($1, $2, 'generated')`,
        [user, `Gen ${i}`],
      );
    }
    expect((await award(user, "contact_generated")).xp).toBe(30);
    expect((await award(user, "contact_generated")).xp).toBe(0);
  });

  it("pays a won deal 150 plus 1 per 1 000, the bonus capped at 150", async () => {
    const user = await createAuthUser();
    const stages = await rows<{ id: string; is_won: boolean }>(
      `select id, is_won from pipeline_stages where user_id = $1 order by position`,
      [user],
    );
    const won = stages.find((s) => s.is_won)!.id;
    const open = stages.find((s) => !s.is_won)!.id;
    const deal = async (value: number) =>
      (
        await one<{ id: string }>(
          `insert into deals (user_id, stage_id, title, value) values ($1, $2, 'D', $3) returning id`,
          [user, open, value],
        )
      ).id;
    const small = await deal(5_500);
    const big = await deal(900_000);
    expect((await award(user, "deal_won", small)).xp).toBe(0); // not won yet
    await db.query(`update deals set stage_id = $1 where id in ($2, $3)`, [won, small, big]);
    expect((await award(user, "deal_won", small)).xp).toBe(155);
    expect((await award(user, "deal_won", big)).xp).toBe(300);
    expect((await award(user, "deal_won", big)).xp).toBe(0);
  });

  it("pays the daily login once a day", async () => {
    const user = await createAuthUser();
    expect((await award(user, "daily_login")).xp).toBe(10);
    expect((await award(user, "daily_login")).xp).toBe(0);
  });

  it("levels up, grants the level rewards and reports them", async () => {
    const user = await createAuthUser();
    const milestone = await newMilestone(user);
    const task = await newTask(user, milestone);
    // Just under level 3.
    await db.query(
      `insert into xp_events (user_id, kind, xp, idempotency_key) values ($1, 'onboarding_completed', $2, 'seed')`,
      [user, xpForLevel(3) - 5],
    );
    const result = await award(user, "task_completed", task);
    expect(result.leveled_up).toBe(true);
    expect(result.previous_level).toBe(2);
    expect(result.level).toBe(3);
    expect(result.unlocks.map((u) => u.key)).toEqual(["theme_midnight"]);
    expect(
      await count(`select 1 from unlocks where user_id = $1 and key = 'theme_midnight'`, [user]),
    ).toBe(1);

    // Level 10 opens Workers, computed from XP even without the row.
    await db.query(
      `insert into xp_events (user_id, kind, xp, idempotency_key) values ($1, 'onboarding_completed', $2, 'seed2')`,
      [user, xpForLevel(10)],
    );
    await asUser(user);
    const { state } = await one<{
      state: { level: number; sections: { key: string; unlocked: boolean }[] };
    }>(`select game_state() as state`);
    await asServer();
    expect(state.level).toBeGreaterThanOrEqual(10);
    expect(state.sections.find((s) => s.key === "section_workers")?.unlocked).toBe(true);
    expect(state.sections.find((s) => s.key === "section_finance")?.unlocked).toBe(false);
  });

  it("earns nothing in tool mode and nothing for a worker in the owner's space", async () => {
    const owner = await createAuthUser();
    const worker = await createAuthUser();
    await db.query(
      `insert into workers (owner_id, user_id, name, status) values ($1, $2, 'W', 'active')`,
      [owner, worker],
    );
    const milestone = await newMilestone(owner);
    const task = await newTask(owner, milestone);
    expect((await award(worker, "task_completed", task)).xp).toBe(0);
    expect((await award(worker, "daily_login")).xp).toBe(0);

    await asUser(owner);
    await db.query(`update profiles set mode = 'tool' where id = $1`, [owner]);
    const { state } = await one<{ state: { mode: string; sections: { unlocked: boolean }[] } }>(
      `select game_state() as state`,
    );
    await asServer();
    expect(state.mode).toBe("tool");
    expect(state.sections.every((s) => s.unlocked)).toBe(true);
    expect((await award(owner, "task_completed", task)).xp).toBe(0);
    expect(await totalXp(owner)).toBe(0);

    // Back in the game: the XP comes, and sections already in use stay open.
    await db.query(`insert into contacts (user_id, company_name) values ($1, 'Used')`, [owner]);
    await asUser(owner);
    await db.query(`update profiles set mode = 'game' where id = $1`, [owner]);
    await asServer();
    expect(
      await count(`select 1 from unlocks where user_id = $1 and key = 'section_contacts'`, [owner]),
    ).toBe(1);
    expect(
      await count(`select 1 from unlocks where user_id = $1 and key = 'section_pipeline'`, [owner]),
    ).toBe(0);
    expect((await award(owner, "task_completed", task)).xp).toBe(10);
  });
});

describe("paths and template milestones", () => {
  it("keeps template links and the path to the server", async () => {
    const user = await createAuthUser();
    const template = (await one<{ id: string }>(`select id from path_milestones limit 1`)).id;
    await asUser(user);
    const { id } = await one<{ id: string }>(
      `insert into milestones (user_id, title, template_id) values ($1, 'Fake', $2) returning id`,
      [user, template],
    );
    expect(
      (
        await one<{ template_id: string | null }>(
          `select template_id from milestones where id = $1`,
          [id],
        )
      ).template_id,
    ).toBeNull();
    await db.query(`update milestones set template_id = $1 where id = $2`, [template, id]);
    expect(
      (
        await one<{ template_id: string | null }>(
          `select template_id from milestones where id = $1`,
          [id],
        )
      ).template_id,
    ).toBeNull();
    await expect(
      db.query(`update profiles set path_key = 'general' where id = $1`, [user]),
    ).rejects.toThrow(/path_is_server_only/);
    await expect(db.query(`select choose_path('nope')`)).rejects.toThrow(/unknown_path/);
    await asServer();
  });

  it("copies a path in the user's language, unlocks with its milestones and pays template XP once", async () => {
    const user = await createAuthUser("cs");
    await asUser(user);
    const { result } = await one<{ result: { added: number } }>(
      `select choose_path('craftsman') as result`,
    );
    await asServer();
    const total = await count(`select 1 from path_milestones where path_key = 'craftsman'`);
    expect(result.added).toBe(total);
    const contactsStep = await one<{ id: string; title: string; xp: number }>(
      `select m.id, m.title, pm.xp from milestones m join path_milestones pm on pm.id = m.template_id
       where m.user_id = $1 and pm.unlock_key = 'section_contacts'`,
      [user],
    );
    expect(contactsStep.title).toBe("Ceník práce a materiálu");
    expect(await count(`select 1 from tasks where milestone_id = $1`, [contactsStep.id])).toBe(5);

    // Locked until the step is done; the menu names the step.
    await asUser(user);
    let { state } = await one<{
      state: {
        sections: { key: string; unlocked: boolean; milestone: { title: string } | null }[];
      };
    }>(`select game_state() as state`);
    const contacts = state.sections.find((s) => s.key === "section_contacts")!;
    expect(contacts.unlocked).toBe(false);
    expect(contacts.milestone?.title).toBe("Ceník práce a materiálu");

    await db.query(`update tasks set status = 'done' where milestone_id = $1`, [contactsStep.id]);
    await db.query(`update milestones set status = 'completed' where id = $1`, [contactsStep.id]);
    ({ state } = await one(`select game_state() as state`));
    expect(state.sections.find((s) => s.key === "section_contacts")!.unlocked).toBe(true);
    await asServer();

    const first = await award(user, "milestone_completed", contactsStep.id);
    expect(first.xp).toBeGreaterThanOrEqual(contactsStep.xp);
    expect(first.unlocks.map((u) => u.key)).toContain("section_contacts");
    expect(first.achievements.map((a) => a.key)).toEqual(
      expect.arrayContaining(["first_task", "first_milestone"]),
    );

    // Reopen and complete again: no XP, no second unlock.
    await asUser(user);
    await db.query(
      `update tasks set status = 'todo' where id = (select id from tasks where milestone_id = $1 limit 1)`,
      [contactsStep.id],
    );
    await db.query(`update tasks set status = 'done' where milestone_id = $1`, [contactsStep.id]);
    await db.query(`update milestones set status = 'completed' where id = $1`, [contactsStep.id]);
    await asServer();
    const second = await award(user, "milestone_completed", contactsStep.id);
    expect(second.xp).toBe(0);
    expect(second.unlocks).toEqual([]);

    // Changing the path: untouched steps go, completed ones stay, no step twice.
    await asUser(user);
    const { result: change } = await one<{ result: { added: number; removed: number } }>(
      `select choose_path('consultant') as result`,
    );
    await asServer();
    expect(change.removed).toBe(total - 1);
    expect(change.added).toBe(total - 1); // offer_pricing is already done
    expect(await count(`select 1 from milestones where id = $1`, [contactsStep.id])).toBe(1);
    expect(
      (await one<{ path_key: string }>(`select path_key from profiles where id = $1`, [user]))
        .path_key,
    ).toBe("consultant");
  });

  it("pays a custom milestone 100 once and caps custom milestones per day", async () => {
    const user = await createAuthUser();
    const paid: number[] = [];
    for (let i = 0; i < 4; i++) {
      const milestone = await newMilestone(user, `Custom ${i}`);
      await newTask(user, milestone);
      await db.query(`update milestones set status = 'completed' where id = $1`, [milestone]);
      paid.push((await award(user, "milestone_completed", milestone)).xp);
    }
    expect(paid).toEqual([100, 100, 100, 0]);
  });
});

describe("badges", () => {
  it("are granted by the server, readable only by their owner", async () => {
    const user = await createAuthUser();
    const stranger = await createAuthUser();
    const milestone = await newMilestone(user);
    // A tree three levels deep: Mapper.
    const a = await newTask(user, milestone);
    const b = await newTask(user, milestone, a);
    await newTask(user, milestone, b);
    const result = await award(user, "task_completed", a);
    expect(result.achievements.map((x) => x.key)).toEqual(
      expect.arrayContaining(["first_task", "mapper"]),
    );
    expect((await award(user, "task_completed", b)).achievements).toEqual([]);

    await asUser(stranger);
    expect(await count(`select 1 from user_achievements where user_id = $1`, [user])).toBe(0);
    await expect(
      db.query(`insert into user_achievements (user_id, achievement_key) values ($1, 'path')`, [
        stranger,
      ]),
    ).rejects.toThrow();
    await asUser(user);
    expect(await count(`select 1 from user_achievements`)).toBe(2);
    await expect(db.query(`delete from user_achievements`)).resolves.toBeDefined();
    await asServer();
    expect(await count(`select 1 from user_achievements where user_id = $1`, [user])).toBe(2);
  });
});

describe("streak", () => {
  it("agrees with computeStreak, saves included, on random histories", async () => {
    const user = await createAuthUser();
    const today = (await one<{ d: string }>(`select (now() at time zone 'UTC')::date::text as d`))
      .d;
    let seed = 7;
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (let round = 0; round < 25; round++) {
      await db.query(`delete from xp_events where user_id = $1`, [user]);
      const days: string[] = [];
      for (let back = 0; back < 45; back++) {
        if (random() < 0.8) {
          const day = (
            await one<{ d: string }>(`select ($1::date - $2::int)::text as d`, [today, back])
          ).d;
          days.push(day);
          await db.query(
            `insert into xp_events (user_id, kind, xp, idempotency_key, created_at)
             values ($1, 'task_completed', 10, $2::text, ($2::text::date + time '12:00') at time zone 'UTC')`,
            [user, day],
          );
        }
      }
      // A login alone never keeps a streak alive.
      await db.query(
        `insert into xp_events (user_id, kind, xp, idempotency_key, created_at)
         values ($1, 'daily_login', 10, 'login', now())`,
        [user],
      );
      const sql = await one<{ streak: number; freeze_available: boolean }>(
        `select * from game_streak($1, 'UTC')`,
        [user],
      );
      const ts = computeStreak(days, today);
      expect({ streak: sql.streak, freeze: sql.freeze_available }).toEqual({
        streak: ts.streak,
        freeze: ts.freezeAvailable,
      });
    }
  });
});

describe("themes, seen level and the path notice (step 9.4)", () => {
  it("has the six themes of the design system on levels 3, 7, 12, 18 and 25", async () => {
    const rewards = await rows<{ level: number; unlock_key: string }>(
      `select r.level, r.unlock_key from level_rewards r
       join unlock_definitions d on d.key = r.unlock_key
       where d.kind = 'theme' order by r.level`,
    );
    expect(rewards).toEqual([
      { level: 3, unlock_key: "theme_midnight" },
      { level: 7, unlock_key: "theme_forest" },
      { level: 12, unlock_key: "theme_sunset" },
      { level: 18, unlock_key: "theme_steel" },
      { level: 25, unlock_key: "theme_light" },
    ]);
    expect(await count(`select 1 from unlock_definitions where kind = 'theme'`)).toBe(5);
  });

  it("lets the client pick only a theme it has unlocked, any theme in tool mode", async () => {
    const user = await createAuthUser();
    await asUser(user);
    await expect(
      db.query(`update user_settings set theme = 'midnight' where user_id = $1`, [user]),
    ).rejects.toThrow(/theme_locked/);
    await expect(
      db.query(`update user_settings set theme = 'unknown' where user_id = $1`, [user]),
    ).rejects.toThrow();
    // The default is always open, other columns stay writable.
    await db.query(
      `update user_settings set theme = 'gradus', sound_enabled = false where user_id = $1`,
      [user],
    );
    await asServer();

    // Level 3 by XP opens Midnight, not Forest.
    await db.query(
      `insert into xp_events (user_id, kind, xp, idempotency_key) values ($1, 'onboarding_completed', $2, 'seed')`,
      [user, xpForLevel(3)],
    );
    await asUser(user);
    await db.query(`update user_settings set theme = 'midnight' where user_id = $1`, [user]);
    await expect(
      db.query(`update user_settings set theme = 'forest' where user_id = $1`, [user]),
    ).rejects.toThrow(/theme_locked/);

    // Tool mode opens all of them.
    await db.query(`update profiles set mode = 'tool' where id = $1`, [user]);
    await db.query(`update user_settings set theme = 'light' where user_id = $1`, [user]);
    await asServer();
    expect(
      (await one<{ theme: string }>(`select theme from user_settings where user_id = $1`, [user]))
        .theme,
    ).toBe("light");
  });

  it("stores the seen level on the user's own profile only, within 1–30", async () => {
    const user = await createAuthUser();
    const other = await createAuthUser();
    expect(
      (await one<{ seen_level: number }>(`select seen_level from profiles where id = $1`, [user]))
        .seen_level,
    ).toBe(1);
    await asUser(user);
    await db.query(`update profiles set seen_level = 4 where id = $1`, [user]);
    await expect(
      db.query(`update profiles set seen_level = 31 where id = $1`, [user]),
    ).rejects.toThrow();
    await db.query(`update profiles set seen_level = 9 where id = $1`, [other]);
    await asServer();
    expect(
      (await one<{ seen_level: number }>(`select seen_level from profiles where id = $1`, [user]))
        .seen_level,
    ).toBe(4);
    expect(
      (await one<{ seen_level: number }>(`select seen_level from profiles where id = $1`, [other]))
        .seen_level,
    ).toBe(1);
  });

  it("accepts a pathReady suggestion from the server only", async () => {
    const user = await createAuthUser();
    await db.query(
      `insert into jarvis_suggestions (user_id, type, text, dedupe_key) values ($1, 'pathReady', 'x', 'pathReady:general')`,
      [user],
    );
    await asUser(user);
    await expect(
      db.query(
        `insert into jarvis_suggestions (user_id, type, text) values ($1, 'pathReady', 'x')`,
        [user],
      ),
    ).rejects.toThrow();
    await asServer();
    expect(await count(`select 1 from jarvis_suggestions where user_id = $1`, [user])).toBe(1);
  });
});
