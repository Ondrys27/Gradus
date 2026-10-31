// @vitest-environment node
//
// The deal detail (17.2) on the real migrations (PGlite): the primary contact
// kept in step with deals.contact_id, the delivery date's calendar event, who
// looks after a deal, its last activity, the history log and notes on a deal.

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
type DealContactRow = {
  contact_id: string;
  is_primary: boolean;
  note: string | null;
  position: number;
};
type DealRow = {
  id: string;
  contact_id: string | null;
  assignee_id: string | null;
  last_activity_at: string;
  deadline_date: string | null;
};
type EventRow = {
  id: string;
  title: string;
  kind: string;
  source: string;
  all_day: boolean;
  starts_at: string;
  ends_at: string | null;
  user_id: string;
};

let db: PGlite;
let owner: string;
let stranger: string;
let viewer: string; // worker who may see the pipeline
let editor: string; // worker who may edit the pipeline, nothing of the calendar

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
  const { id } = await one<{ id: string }>(
    `insert into contacts (user_id, company_name) values ($1, $2) returning id`,
    [uid, name],
  );
  return id;
}
async function stageOf(uid: string, which: "open" | "won" | "lost", nth = 0) {
  const { id } = await one<{ id: string }>(
    `select id from pipeline_stages
     where user_id = $1
       and case $2 when 'won' then is_won when 'lost' then is_lost else not is_won and not is_lost end
     order by position offset $3 limit 1`,
    [uid, which, nth],
  );
  return id;
}
/** A deal made by the signed-in owner (as the client would). */
async function addDeal(title: string, contactId: string | null = null) {
  const stage = await stageOf(owner, "open");
  return as(owner, () =>
    one<DealRow>(
      `insert into deals (user_id, stage_id, title, contact_id) values ($1, $2, $3, $4) returning *`,
      [owner, stage, title, contactId],
    ),
  );
}
function dealContacts(dealId: string) {
  return rows<DealContactRow>(
    `select contact_id, is_primary, note, position from deal_contacts where deal_id = $1 order by position`,
    [dealId],
  );
}
async function dealContactId(dealId: string) {
  return (
    await one<{ contact_id: string | null }>(`select contact_id from deals where id = $1`, [dealId])
  ).contact_id;
}
function deadlineEvents(dealId: string) {
  return rows<EventRow>(
    `select * from calendar_events where deal_id = $1 and source = 'deal_deadline'`,
    [dealId],
  );
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
  await addWorker(owner, viewer, [["pipeline", true, false]]);
  await addWorker(owner, editor, [["pipeline", true, true]]);
});

afterAll(async () => {
  await db?.close();
});

describe("deal contacts: the primary one is the deal's contact", () => {
  it("makes the contact of a new deal its primary contact", async () => {
    const anna = await addContact(owner, "Anna");
    const deal = await addDeal("Web", anna);
    expect(await dealContacts(deal.id)).toEqual([
      { contact_id: anna, is_primary: true, note: null, position: 0 },
    ]);
  });

  it("adds more contacts behind it, with a trimmed note, and swaps the primary on request", async () => {
    const anna = await addContact(owner, "Anna");
    const petr = await addContact(owner, "Petr");
    const deal = await addDeal("E-shop", anna);

    await as(owner, () =>
      rows(
        `insert into deal_contacts (user_id, deal_id, contact_id, note) values ($1, $2, $3, $4)`,
        [owner, deal.id, petr, "  fakturace  "],
      ),
    );
    expect(await dealContacts(deal.id)).toEqual([
      { contact_id: anna, is_primary: true, note: null, position: 0 },
      { contact_id: petr, is_primary: false, note: "fakturace", position: 1 },
    ]);
    expect(await dealContactId(deal.id)).toBe(anna);

    await as(owner, () =>
      rows(`update deal_contacts set is_primary = true where deal_id = $1 and contact_id = $2`, [
        deal.id,
        petr,
      ]),
    );
    expect((await dealContacts(deal.id)).map((c) => [c.contact_id, c.is_primary])).toEqual([
      [anna, false],
      [petr, true],
    ]);
    expect(await dealContactId(deal.id)).toBe(petr);

    // The mark is never simply taken away.
    await expect(
      as(owner, () =>
        rows(`update deal_contacts set is_primary = false where deal_id = $1 and contact_id = $2`, [
          deal.id,
          petr,
        ]),
      ),
    ).rejects.toThrow(/deal_contact_primary_required/);
  });

  it("hands the primary mark on when the primary contact is removed, and clears it with the last one", async () => {
    const anna = await addContact(owner, "Anna");
    const petr = await addContact(owner, "Petr");
    const deal = await addDeal("Logo", anna);
    await as(owner, () =>
      rows(`insert into deal_contacts (user_id, deal_id, contact_id) values ($1, $2, $3)`, [
        owner,
        deal.id,
        petr,
      ]),
    );

    await as(owner, () =>
      rows(`delete from deal_contacts where deal_id = $1 and contact_id = $2`, [deal.id, anna]),
    );
    expect(await dealContacts(deal.id)).toMatchObject([{ contact_id: petr, is_primary: true }]);
    expect(await dealContactId(deal.id)).toBe(petr);

    await as(owner, () =>
      rows(`delete from deal_contacts where deal_id = $1 and contact_id = $2`, [deal.id, petr]),
    );
    expect(await dealContacts(deal.id)).toEqual([]);
    expect(await dealContactId(deal.id)).toBeNull();

    // The first contact added to a deal without one becomes its contact.
    await as(owner, () =>
      rows(`insert into deal_contacts (user_id, deal_id, contact_id) values ($1, $2, $3)`, [
        owner,
        deal.id,
        anna,
      ]),
    );
    expect(await dealContacts(deal.id)).toMatchObject([{ contact_id: anna, is_primary: true }]);
    expect(await dealContactId(deal.id)).toBe(anna);
  });

  it("follows deals.contact_id set directly, keeping the previous contact on the deal", async () => {
    const anna = await addContact(owner, "Anna");
    const karel = await addContact(owner, "Karel");
    const deal = await addDeal("Kampaň", anna);
    await as(owner, () => rows(`update deals set contact_id = $2 where id = $1`, [deal.id, karel]));
    expect((await dealContacts(deal.id)).map((c) => [c.contact_id, c.is_primary])).toEqual([
      [anna, false],
      [karel, true],
    ]);
  });

  it("puts another contact in place when the primary contact is deleted", async () => {
    const anna = await addContact(owner, "Anna");
    const petr = await addContact(owner, "Petr");
    const deal = await addDeal("Fotky", anna);
    await as(owner, () =>
      rows(`insert into deal_contacts (user_id, deal_id, contact_id) values ($1, $2, $3)`, [
        owner,
        deal.id,
        petr,
      ]),
    );
    await as(owner, () => rows(`delete from contacts where id = $1`, [anna]));
    expect(await dealContacts(deal.id)).toMatchObject([{ contact_id: petr, is_primary: true }]);
    expect(await dealContactId(deal.id)).toBe(petr);
  });

  it("keeps the links fixed and other spaces out", async () => {
    const anna = await addContact(owner, "Anna");
    const deal = await addDeal("Pevné", anna);
    const theirs = await addContact(stranger, "Cizí");
    await expect(
      as(owner, () =>
        rows(`insert into deal_contacts (user_id, deal_id, contact_id) values ($1, $2, $3)`, [
          owner,
          deal.id,
          theirs,
        ]),
      ),
    ).rejects.toThrow(/foreign key/);
    // The client may change only the note and the primary mark.
    await expect(
      as(owner, () =>
        rows(`update deal_contacts set contact_id = $2 where deal_id = $1`, [deal.id, theirs]),
      ),
    ).rejects.toThrow(/permission denied/);
    expect(
      await as(stranger, () => rows(`select id from deal_contacts where deal_id = $1`, [deal.id])),
    ).toHaveLength(0);
  });

  it("lets a worker read them with the pipeline, change them only with edit", async () => {
    const anna = await addContact(owner, "Anna");
    const petr = await addContact(owner, "Petr");
    const deal = await addDeal("Sdílený", anna);
    expect(
      await as(viewer, () => rows(`select id from deal_contacts where deal_id = $1`, [deal.id])),
    ).toHaveLength(1);
    await expect(
      as(viewer, () =>
        rows(`insert into deal_contacts (user_id, deal_id, contact_id) values ($1, $2, $3)`, [
          owner,
          deal.id,
          petr,
        ]),
      ),
    ).rejects.toThrow(/row-level security/);
    await as(editor, () =>
      rows(
        `insert into deal_contacts (user_id, deal_id, contact_id, note) values ($1, $2, $3, 'web')`,
        [owner, deal.id, petr],
      ),
    );
    expect(await dealContacts(deal.id)).toHaveLength(2);
  });
});

describe("deal delivery date in the calendar", () => {
  it("keeps one all-day event on the date in the owner's zone, moves, renames and removes it", async () => {
    const deal = await addDeal("Dodávka webu");
    await as(owner, () =>
      rows(`update deals set deadline_date = '2026-11-20' where id = $1`, [deal.id]),
    );
    let events = await deadlineEvents(deal.id);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      title: "Dodávka webu",
      kind: "deadline",
      all_day: true,
      ends_at: null,
      user_id: owner,
    });
    // Midnight in Prague (CET, UTC+1).
    expect(new Date(events[0]!.starts_at).toISOString()).toBe("2026-11-19T23:00:00.000Z");

    await as(owner, () =>
      rows(
        `update deals set deadline_date = '2026-12-01', title = 'Dodávka e-shopu' where id = $1`,
        [deal.id],
      ),
    );
    events = await deadlineEvents(deal.id);
    expect(events).toHaveLength(1);
    expect(events[0]!.title).toBe("Dodávka e-shopu");
    expect(new Date(events[0]!.starts_at).toISOString()).toBe("2026-11-30T23:00:00.000Z");

    await as(owner, () => rows(`update deals set deadline_date = null where id = $1`, [deal.id]));
    expect(await deadlineEvents(deal.id)).toHaveLength(0);

    await as(owner, () =>
      rows(`update deals set deadline_date = '2026-12-05' where id = $1`, [deal.id]),
    );
    expect(await deadlineEvents(deal.id)).toHaveLength(1);
    await as(owner, () => rows(`delete from deals where id = $1`, [deal.id]));
    expect(
      await rows(
        `select id from calendar_events where source = 'deal_deadline' and title = 'Dodávka e-shopu'`,
      ),
    ).toHaveLength(0);
  });

  it("never lets the calendar change or delete the deadline event", async () => {
    const deal = await addDeal("Termín");
    await as(owner, () =>
      rows(`update deals set deadline_date = '2026-11-20' where id = $1`, [deal.id]),
    );
    const [event] = await deadlineEvents(deal.id);
    await expect(
      as(owner, () =>
        rows(`update calendar_events set starts_at = now() where id = $1`, [event!.id]),
      ),
    ).rejects.toThrow(/calendar_event_from_deal/);
    await expect(
      as(owner, () => rows(`delete from calendar_events where id = $1`, [event!.id])),
    ).rejects.toThrow(/calendar_event_from_deal/);
    // And the client can not pass an event off as one.
    const forged = await as(owner, () =>
      one<EventRow>(
        `insert into calendar_events (user_id, title, kind, starts_at, all_day, deal_id, source)
         values ($1, 'Falešný', 'deadline', now(), true, $2, 'deal_deadline') returning *`,
        [owner, deal.id],
      ),
    );
    expect(forged.source).toBe("manual");
  });

  it("puts the event in the owner's calendar when a worker without the calendar sets the date", async () => {
    const deal = await addDeal("Od pracovníka");
    await as(editor, () =>
      rows(`update deals set deadline_date = '2026-11-25' where id = $1`, [deal.id]),
    );
    const events = await deadlineEvents(deal.id);
    expect(events).toHaveLength(1);
    expect(events[0]!.user_id).toBe(owner);
  });
});

describe("deal: who looks after it and when it last moved", () => {
  it("gives a new deal to whoever made it, only ever to someone of the space", async () => {
    const stage = await stageOf(owner, "open");
    const byWorker = await as(editor, () =>
      one<DealRow>(
        `insert into deals (user_id, stage_id, title) values ($1, $2, 'Od pracovníka') returning *`,
        [owner, stage],
      ),
    );
    expect(byWorker.assignee_id).toBe(editor);
    const toOwner = await as(editor, () =>
      one<DealRow>(`update deals set assignee_id = $2 where id = $1 returning *`, [
        byWorker.id,
        owner,
      ]),
    );
    expect(toOwner.assignee_id).toBe(owner);
    await expect(
      as(owner, () =>
        rows(`update deals set assignee_id = $2 where id = $1`, [byWorker.id, stranger]),
      ),
    ).rejects.toThrow(/deal_assignee_outside/);
  });

  it("stamps last activity itself, on edits and on things around the deal", async () => {
    const anna = await addContact(owner, "Anna");
    const deal = await addDeal("Aktivita", anna);
    const past = "2026-01-01T00:00:00Z";
    const reset = () =>
      db.query(`update deals set last_activity_at = $2 where id = $1`, [deal.id, past]);
    const last = async () =>
      new Date(
        (
          await one<{ last_activity_at: string }>(
            `select last_activity_at from deals where id = $1`,
            [deal.id],
          )
        ).last_activity_at,
      ).getTime();

    // The client can not set it…
    await reset();
    await as(owner, () =>
      rows(
        `update deals set last_activity_at = now() + interval '1 day', position = 7 where id = $1`,
        [deal.id],
      ),
    );
    expect(await last()).toBe(Date.parse(past));

    // …an edit of the deal moves it…
    await as(owner, () => rows(`update deals set value = 1000 where id = $1`, [deal.id]));
    expect(await last()).toBeGreaterThan(Date.parse(past));

    // …and so do a task, an e-mail, a meeting and a contact added.
    const actions = [
      `insert into crm_tasks (user_id, title, due_at, deal_id) values ('${owner}', 'Zavolat', now(), '${deal.id}')`,
      `insert into contact_activities (user_id, contact_id, deal_id, type, content) values ('${owner}', '${anna}', '${deal.id}', 'email_sent', 'x')`,
      `insert into calendar_events (user_id, title, kind, starts_at, deal_id) values ('${owner}', 'Schůzka', 'meeting', now(), '${deal.id}')`,
    ];
    for (const sql of actions) {
      await reset();
      await as(owner, () => rows(sql));
      expect(await last(), sql).toBeGreaterThan(Date.parse(past));
    }
    const petr = await addContact(owner, "Petr");
    await reset();
    await as(owner, () =>
      rows(`insert into deal_contacts (user_id, deal_id, contact_id) values ($1, $2, $3)`, [
        owner,
        deal.id,
        petr,
      ]),
    );
    expect(await last()).toBeGreaterThan(Date.parse(past));
  });
});

describe("deal history log", () => {
  it("records stage, value and Close Date changes with who did them", async () => {
    const deal = await addDeal("Historie");
    const second = await stageOf(owner, "open", 1);
    const lost = await stageOf(owner, "lost");
    await as(editor, () => rows(`update deals set stage_id = $2 where id = $1`, [deal.id, second]));
    await as(owner, () =>
      rows(`update deals set value = 25000, expected_close_date = '2026-12-15' where id = $1`, [
        deal.id,
      ]),
    );
    await as(owner, () =>
      rows(`update deals set stage_id = $2, lost_reason = 'Drahé' where id = $1`, [deal.id, lost]),
    );
    const events = await as(owner, () =>
      rows<{ kind: string; actor_id: string; payload: Record<string, unknown> }>(
        `select kind, actor_id, payload from deal_events where deal_id = $1 order by occurred_at, kind`,
        [deal.id],
      ),
    );
    expect(events.map((e) => e.kind)).toEqual(["stage", "close_date", "value", "stage"]);
    expect(events[0]!.actor_id).toBe(editor);
    expect(events[0]!.payload).toMatchObject({ to_stage_id: second, won: false, lost: false });
    expect(events[1]!.payload).toEqual({ from: null, to: "2026-12-15" });
    expect(events[2]!.payload).toMatchObject({ from: null, to: 25000, to_currency: "CZK" });
    expect(events[3]!.payload).toMatchObject({ lost: true, reason: "Drahé" });
    expect(typeof events[3]!.payload.to_name).toBe("string");

    // Read with the pipeline; never written by the client; strangers see nothing.
    expect(
      await as(viewer, () => rows(`select id from deal_events where deal_id = $1`, [deal.id])),
    ).toHaveLength(4);
    expect(
      await as(stranger, () => rows(`select id from deal_events where deal_id = $1`, [deal.id])),
    ).toHaveLength(0);
    await expect(
      as(owner, () =>
        rows(`insert into deal_events (user_id, deal_id, kind) values ($1, $2, 'value')`, [
          owner,
          deal.id,
        ]),
      ),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("notes on a deal", () => {
  it("ties the owner's note to their own deal only", async () => {
    const deal = await addDeal("Poznámky");
    const note = await as(owner, () =>
      one<{ id: string }>(
        `insert into notes (user_id, title) values ($1, 'K obchodu') returning id`,
        [owner],
      ),
    );
    await as(owner, () =>
      rows(`insert into note_links (note_id, deal_id) values ($1, $2)`, [note.id, deal.id]),
    );
    const workerNote = await as(editor, () =>
      one<{ id: string }>(`insert into notes (user_id, title) values ($1, 'Moje') returning id`, [
        editor,
      ]),
    );
    await expect(
      as(editor, () =>
        rows(`insert into note_links (note_id, deal_id) values ($1, $2)`, [workerNote.id, deal.id]),
      ),
    ).rejects.toThrow(/row-level security/);
    await expect(
      as(owner, () =>
        rows(`insert into note_links (note_id, deal_id, task_id) values ($1, $2, null)`, [
          note.id,
          null,
        ]),
      ),
    ).rejects.toThrow(/note_links_one_target/);
  });
});

describe("the migration on existing deals", () => {
  it("makes their contact primary, gives them to their maker and dates their last activity", async () => {
    const old = new PGlite({ extensions: PGLITE_EXTENSIONS });
    try {
      await old.exec(SUPABASE_STUBS);
      const files = readdirSync(MIGRATIONS_DIR)
        .filter((f) => f.endsWith(".sql"))
        .sort();
      const mine = files.findIndex((f) => f.endsWith("_deal_detail.sql"));
      for (const file of files.slice(0, mine)) {
        await old.exec(readFileSync(path.join(MIGRATIONS_DIR, file), "utf8"));
      }
      await old.query(`insert into auth.users (email) values ('first@example.com')`);
      const { rows: users } = await old.query<{ id: string }>(
        `insert into auth.users (email) values ('owner@example.com') returning id`,
      );
      const uid = users[0]!.id;
      const { rows: contacts } = await old.query<{ id: string }>(
        `insert into contacts (user_id, company_name) values ($1, 'Anna') returning id`,
        [uid],
      );
      await old.query(
        `insert into deals (user_id, stage_id, title, contact_id, created_at)
         select $1, id, 'Starý', $2, '2026-05-01' from pipeline_stages where user_id = $1 order by position limit 1`,
        [uid, contacts[0]!.id],
      );
      // In its stage since May, like any deal that has been around.
      const { rows: deals } = await old.query<{ id: string; updated_at: string }>(
        `update deals set entered_stage_at = '2026-05-01' where user_id = $1 returning id, updated_at`,
        [uid],
      );
      await old.query(
        `insert into contact_activities (user_id, contact_id, deal_id, type, content, occurred_at)
         values ($1, $2, $3, 'email_sent', 'x', '2026-06-01T00:00:00Z')`,
        [uid, contacts[0]!.id, deals[0]!.id],
      );

      await old.exec(readFileSync(path.join(MIGRATIONS_DIR, files[mine]!), "utf8"));

      const { rows: after } = await old.query<{
        assignee_id: string;
        last_activity_at: string;
        updated_at: string;
      }>(`select assignee_id, last_activity_at, updated_at from deals where id = $1`, [
        deals[0]!.id,
      ]);
      expect(after[0]!.assignee_id).toBe(uid);
      expect(new Date(after[0]!.last_activity_at).toISOString()).toBe("2026-06-01T00:00:00.000Z");
      expect(after[0]!.updated_at).toEqual(deals[0]!.updated_at);
      const { rows: links } = await old.query(
        `select contact_id, is_primary, position from deal_contacts where deal_id = $1`,
        [deals[0]!.id],
      );
      expect(links).toEqual([{ contact_id: contacts[0]!.id, is_primary: true, position: 0 }]);
    } finally {
      await old.close();
    }
  });
});
