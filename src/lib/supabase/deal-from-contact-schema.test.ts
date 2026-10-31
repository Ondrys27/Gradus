// @vitest-environment node
//
// Deals from contacts and Cold Calling (17.4) on the real migrations (PGlite):
// the table "Klient má zájem" in new and untouched spaces, the stage a deal
// from Cold Calling lands in, and the booked meeting a new deal takes along.

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
let stranger: string;
let caller: string; // worker: pipeline edit + cold calling edit, no calendar
let viewer: string; // worker: pipeline view only
let doer: string; // worker without any section

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
async function createAuthUser(locale = "cs") {
  const { id } = await one<{ id: string }>(
    `insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id`,
    [`${crypto.randomUUID()}@example.com`, JSON.stringify({ locale })],
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
}
function tableNames(uid: string) {
  return rows<{ name: string; system_key: string | null }>(
    `select name, system_key from contact_tables where user_id = $1 order by position`,
    [uid],
  ).then((list) => list.map((row) => row.name));
}
async function tableId(uid: string, key: string) {
  return (
    await one<{ id: string }>(
      `select id from contact_tables where user_id = $1 and system_key = $2`,
      [uid, key],
    )
  ).id;
}
async function stageId(uid: string, key: string) {
  return (
    await one<{ id: string }>(
      `select id from pipeline_stages where user_id = $1 and system_key = $2`,
      [uid, key],
    )
  ).id;
}
async function addContact(uid: string, name: string) {
  return (
    await one<{ id: string }>(
      `insert into contacts (user_id, company_name) values ($1, $2) returning id`,
      [uid, name],
    )
  ).id;
}
/** Moves as `actor` into the meeting table, booking a meeting. */
async function bookMeeting(actor: string, space: string, contactId: string) {
  const meetingTable = await tableId(space, "meeting_scheduled");
  const { id: field } = await one<{ id: string }>(
    `select id from contact_table_fields where table_id = $1 and system_key = 'meeting_at'`,
    [meetingTable],
  );
  await as(actor, () =>
    db.query(`select move_contact($1, $2, $3)`, [
      contactId,
      meetingTable,
      JSON.stringify({ [field]: "2026-11-05T09:00:00Z" }),
    ]),
  );
}
async function addDeal(space: string, contactId: string | null) {
  return (
    await one<{ id: string }>(
      `insert into deals (user_id, stage_id, title, contact_id) values ($1, $2, 'Obchod', $3) returning id`,
      [space, await stageId(space, "lead"), contactId],
    )
  ).id;
}
function link(uid: string, dealId: string) {
  return as(uid, () =>
    one<{ event: string | null }>(`select link_deal_to_booked_meeting($1) as event`, [dealId]),
  ).then((row) => row.event);
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
  caller = await createAuthUser();
  viewer = await createAuthUser();
  doer = await createAuthUser();
  await addWorker(owner, caller, [
    ["pipeline", true, true],
    ["cold_calling", true, true],
  ]);
  await addWorker(owner, viewer, [["pipeline", true, false]]);
  await addWorker(owner, doer, []);
});

afterAll(async () => {
  await db?.close();
});

describe("the table Klient má zájem", () => {
  it("is in a new space between Domluvená schůzka and Odeslán e-mail, with its questions", async () => {
    expect(await tableNames(owner)).toEqual([
      "Neoslovení klienti",
      "Nezvedají telefon",
      "Neúspěch",
      "Domluvená schůzka",
      "Klient má zájem",
      "Odeslán e-mail",
      "Ozvat se",
      "Klienti",
    ]);
    const fields = await rows<{ label: string; type: string; required: boolean }>(
      `select label, type::text, required from contact_table_fields
       where table_id = $1 order by position`,
      [await tableId(owner, "interested")],
    );
    expect(fields).toEqual([
      { label: "O co má zájem", type: "text", required: false },
      { label: "Kdy se ozvat", type: "datetime", required: false },
    ]);
  });

  it("is named in English for an English space", async () => {
    const english = await createAuthUser("en");
    await db.exec(`select initialize_user('${english}', 'en')`);
    const names = await tableNames(english);
    expect(names.slice(3, 6)).toEqual(["Meeting scheduled", "Interested", "Email sent"]);
  });

  it("counts a space as untouched only with the seven seeded tables as seeded", async () => {
    const old = await createAuthUser();
    // An older space: the seed before 17.4, without the new table.
    await db.query(`delete from contact_tables where user_id = $1 and system_key = 'interested'`, [
      old,
    ]);
    const untouched = (uid: string) =>
      one<{ ok: boolean }>(`select contact_tables_untouched($1) as ok`, [uid]).then((r) => r.ok);
    expect(await untouched(old)).toBe(true);
    // The migration adds it to such a space, in the same place as for a new one.
    await db.query(`select contact_tables_add_interested($1, true)`, [old]);
    expect((await tableNames(old)).slice(3, 6)).toEqual([
      "Domluvená schůzka",
      "Klient má zájem",
      "Odeslán e-mail",
    ]);

    const renamed = await createAuthUser();
    await db.query(`delete from contact_tables where user_id = $1 and system_key = 'interested'`, [
      renamed,
    ]);
    await db.query(
      `update contact_tables set name = 'Volat znovu' where user_id = $1 and system_key = 'follow_up'`,
      [renamed],
    );
    expect(await untouched(renamed)).toBe(false);

    const reordered = await createAuthUser();
    await db.query(`delete from contact_tables where user_id = $1 and system_key = 'interested'`, [
      reordered,
    ]);
    await db.query(
      `update contact_tables set position = 99 where user_id = $1 and system_key = 'no_answer'`,
      [reordered],
    );
    expect(await untouched(reordered)).toBe(false);

    // A space that already has it (any new one) is not untouched either: nothing twice.
    expect(await untouched(owner)).toBe(false);
  });

  it("is offered in the editor: added once, with the right to edit the tables", async () => {
    const customised = await createAuthUser();
    await db.query(`delete from contact_tables where user_id = $1 and system_key = 'interested'`, [
      customised,
    ]);
    await db.query(
      `update contact_tables set name = 'Volat znovu' where user_id = $1 and system_key = 'follow_up'`,
      [customised],
    );
    const added = await as(customised, () =>
      one<{ id: string }>(`select add_interested_contact_table() as id`),
    );
    expect(added.id).toBe(await tableId(customised, "interested"));
    const again = await as(customised, () =>
      one<{ id: string }>(`select add_interested_contact_table() as id`),
    );
    expect(again.id).toBe(added.id);
    expect(
      (
        await one<{ count: number }>(
          `select count(*)::int as count from contact_tables where user_id = $1`,
          [customised],
        )
      ).count,
    ).toBe(8);
  });

  it("is added by a worker only into the space they work in, and only with edit rights", async () => {
    // The worker with cold calling edits the owner's space (which already has it).
    const viaWorker = await as(caller, () =>
      one<{ id: string }>(`select add_interested_contact_table() as id`),
    );
    expect(viaWorker.id).toBe(await tableId(owner, "interested"));
    await expect(
      as(doer, () => db.query(`select add_interested_contact_table()`)),
    ).rejects.toThrow(/section_access_denied/);
    await expect(
      as(viewer, () => db.query(`select add_interested_contact_table()`)),
    ).rejects.toThrow(/section_access_denied/);
  });

  it("can not be made by a client as a system table", async () => {
    await expect(
      as(owner, () =>
        db.query(
          `insert into contact_tables (user_id, name, system_key) values ($1, 'Fake', 'interested')`,
          [owner],
        ),
      ),
    ).rejects.toThrow(/system_table_readonly/);
    await expect(
      as(owner, () => db.query(`select contact_tables_add_interested($1, true)`, [owner])),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("the stage of a deal from Cold Calling", () => {
  function setStage(uid: string, stage: string | null) {
    return as(uid, () =>
      db.query(`update user_settings set cold_calling_deal_stage_id = $2 where user_id = $1`, [
        uid,
        stage,
      ]),
    );
  }

  it("is an open stage of the owner's own pipeline", async () => {
    await setStage(owner, await stageId(owner, "offer_draft"));
    await setStage(owner, null);
    await expect(setStage(owner, await stageId(owner, "won"))).rejects.toThrow(
      /deal_stage_invalid/,
    );
    await expect(setStage(owner, await stageId(owner, "lost"))).rejects.toThrow(
      /deal_stage_invalid/,
    );
  });

  it("may be a stage of the space a worker sees the pipeline of, never of another space", async () => {
    await setStage(viewer, await stageId(owner, "meeting"));
    await expect(setStage(doer, await stageId(owner, "meeting"))).rejects.toThrow(
      /deal_stage_invalid/,
    );
    await expect(setStage(owner, await stageId(stranger, "meeting"))).rejects.toThrow(
      /deal_stage_invalid/,
    );
  });

  it("falls back to none when the stage is removed", async () => {
    const extra = (
      await one<{ id: string }>(
        `insert into pipeline_stages (user_id, name, position) values ($1, 'Navíc', 9) returning id`,
        [owner],
      )
    ).id;
    await setStage(owner, extra);
    await db.query(`delete from pipeline_stages where id = $1`, [extra]);
    const row = await one<{ stage: string | null }>(
      `select cold_calling_deal_stage_id as stage from user_settings where user_id = $1`,
      [owner],
    );
    expect(row.stage).toBeNull();
  });
});

describe("link_deal_to_booked_meeting", () => {
  it("links the meeting the move just booked, once", async () => {
    const contact = await addContact(owner, "Pekárna Dub");
    await bookMeeting(owner, owner, contact);
    const deal = await addDeal(owner, contact);
    const event = await link(owner, deal);
    expect(event).not.toBeNull();
    const linked = await one<{ deal_id: string; kind: string }>(
      `select deal_id, kind::text from calendar_events where id = $1`,
      [event],
    );
    expect(linked).toEqual({ deal_id: deal, kind: "meeting" });
    // The meeting is the deal's now; a second deal does not take it away.
    expect(await link(owner, await addDeal(owner, contact))).toBeNull();
  });

  it("links nothing for a contact moved on since the meeting, or a deal without a contact", async () => {
    const contact = await addContact(owner, "Zámečnictví Klíč");
    await bookMeeting(owner, owner, contact);
    await as(owner, async () => {
      // Moved on (and later back) without a new meeting: the old one is not this move's.
      await db.query(`select move_contact($1, $2, '{}')`, [
        contact,
        await tableId(owner, "interested"),
      ]);
    });
    expect(await link(owner, await addDeal(owner, contact))).toBeNull();
    expect(await link(owner, await addDeal(owner, null))).toBeNull();
  });

  it("works for a worker who may make deals but not see the calendar", async () => {
    const contact = await addContact(owner, "Kavárna U Mostu");
    await bookMeeting(caller, owner, contact);
    const deal = await addDeal(owner, contact);
    expect(await link(caller, deal)).not.toBeNull();
  });

  it("is refused without the right to edit the pipeline, and outside one's space", async () => {
    const contact = await addContact(owner, "Účetní Dvořák");
    await bookMeeting(owner, owner, contact);
    const deal = await addDeal(owner, contact);
    await expect(link(viewer, deal)).rejects.toThrow(/section_access_denied/);
    await expect(link(stranger, deal)).rejects.toThrow(/deal_not_found/);
    // Nothing got linked by the refused calls.
    expect(await link(owner, deal)).not.toBeNull();
  });
});
