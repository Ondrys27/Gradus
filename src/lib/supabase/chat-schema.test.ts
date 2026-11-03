// @vitest-environment node
//
// Messages (19.4) on the real migrations (PGlite): group conversations follow
// the groups, a direct one is made once per pair, only members read and
// write, the sender and times come from the database, own messages change
// for 15 minutes, a deleted message keeps nothing, and unread counts and
// files follow the same rules.

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
let accountB: string;
let accountC: string;
let accountGone: string;
const w: Record<string, string> = {};

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
async function addWorker(ownerId: string, name: string, account: string | null, status?: string) {
  const [row] = await rows<{ id: string }>(
    `insert into workers (owner_id, user_id, name, status) values ($1, $2, $3, $4) returning id`,
    [ownerId, account, name, status ?? (account ? "active" : "invited")],
  );
  return row!.id;
}
async function addGroup(name: string) {
  return as(owner, async () => {
    const [row] = await rows<{ id: string }>(
      `insert into worker_groups (name) values ($1) returning id`,
      [name],
    );
    return row!.id;
  });
}
async function channelOfGroup(group: string) {
  const [row] = await rows<{ id: string }>(`select id from chat_channels where group_id = $1`, [
    group,
  ]);
  return row?.id ?? null;
}
async function members(channel: string) {
  const list = await rows<{ member: string }>(
    `select member from chat_members where channel_id = $1 order by member`,
    [channel],
  );
  return list.map((row) => row.member).sort();
}
function send(uid: string, channel: string, body: string, extra: Row = {}) {
  return as(uid, async () => {
    const id = (extra.id as string | undefined) ?? crypto.randomUUID();
    const [row] = await rows<Row>(
      `insert into chat_messages (id, channel_id, body, attachments, reply_to_id, sender_is_owner, sender_worker_id)
       values ($1, $2, $3, $4, $5, $6, $7)
       returning id, owner_id, sender, sender_is_owner, sender_worker_id, sender_user_id, created_at`,
      [
        id,
        channel,
        body,
        JSON.stringify(extra.attachments ?? []),
        extra.reply_to_id ?? null,
        extra.sender_is_owner ?? false,
        extra.sender_worker_id ?? null,
      ],
    );
    return row!;
  });
}
function overview(uid: string) {
  return as(uid, () =>
    rows<{ id: string; kind: string; unread: number; mentioned: boolean; peer: string | null }>(
      `select id, kind, unread, mentioned, peer from chat_overview()`,
    ),
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
  owner = await createAuthUser();
  stranger = await createAuthUser();
  accountB = await createAuthUser();
  accountC = await createAuthUser();
  accountGone = await createAuthUser();
  w.B = await addWorker(owner, "Bára", accountB);
  w.C = await addWorker(owner, "Cyril", accountC);
  w.I = await addWorker(owner, "Ivan", null);
  w.G = await addWorker(owner, "Gustav", accountGone);
  w.X = await addWorker(stranger, "Xaver", null);
});

afterAll(async () => {
  await db?.close();
});

describe("group conversations follow the groups", () => {
  let group: string;
  let channel: string;

  it("comes with the group, the owner in it, named and coloured like it", async () => {
    group = await addGroup("Obchod");
    channel = (await channelOfGroup(group))!;
    expect(channel).toBeTruthy();
    expect(await members(channel)).toEqual([owner]);
    const [row] = await rows<{ name: string; color: string; kind: string }>(
      `select name, color, kind from chat_channels where id = $1`,
      [channel],
    );
    expect(row).toEqual({ name: "Obchod", color: "violet", kind: "group" });
  });

  it("takes in and lets go of the group's members, and follows a rename", async () => {
    await as(owner, () =>
      db.query(`insert into worker_group_members (group_id, worker_id) values ($1, $2), ($1, $3)`, [
        group,
        w.B,
        w.I,
      ]),
    );
    expect(await members(channel)).toEqual([owner, w.B, w.I].sort());
    await as(owner, () =>
      db.query(`delete from worker_group_members where group_id = $1 and worker_id = $2`, [
        group,
        w.I,
      ]),
    );
    expect(await members(channel)).toEqual([owner, w.B].sort());
    await as(owner, () =>
      db.query(`update worker_groups set name = 'Prodej', color = 'teal' where id = $1`, [group]),
    );
    const [row] = await rows<{ name: string; color: string }>(
      `select name, color from chat_channels where id = $1`,
      [channel],
    );
    expect(row).toEqual({ name: "Prodej", color: "teal" });
  });

  it("lets nobody write the conversations or memberships directly", async () => {
    await expect(
      as(owner, () =>
        db.query(`insert into chat_channels (owner_id, kind, name) values ($1, 'group', 'X')`, [
          owner,
        ]),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      as(owner, () =>
        db.query(`insert into chat_members (channel_id, owner_id, worker_id) values ($1, $2, $3)`, [
          channel,
          owner,
          w.C,
        ]),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      as(accountB, () =>
        db.query(`update chat_members set last_read_at = now() where channel_id = $1`, [channel]),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it("keeps the history of a deleted group, read only, with its people", async () => {
    const other = await addGroup("Dočasná");
    const otherChannel = (await channelOfGroup(other))!;
    await as(owner, () =>
      db.query(`insert into worker_group_members (group_id, worker_id) values ($1, $2)`, [
        other,
        w.B,
      ]),
    );
    await send(owner, otherChannel, "Ahoj");
    await as(owner, () => db.query(`delete from worker_groups where id = $1`, [other]));
    const [row] = await rows<{ archived_at: string | null; group_id: string | null }>(
      `select archived_at, group_id from chat_channels where id = $1`,
      [otherChannel],
    );
    expect(row!.archived_at).not.toBeNull();
    expect(row!.group_id).toBeNull();
    expect(await members(otherChannel)).toEqual([owner, w.B].sort());
    const read = await as(accountB, () =>
      rows(`select body from chat_messages where channel_id = $1`, [otherChannel]),
    );
    expect(read).toHaveLength(1);
    await expect(send(accountB, otherChannel, "Ještě tu?")).rejects.toThrow(
      /chat_channel_archived/,
    );
  });
});

describe("messages", () => {
  let group: string;
  let channel: string;

  beforeAll(async () => {
    group = await addGroup("Tým");
    channel = (await channelOfGroup(group))!;
    await as(owner, () =>
      db.query(`insert into worker_group_members (group_id, worker_id) values ($1, $2), ($1, $3)`, [
        group,
        w.B,
        w.G,
      ]),
    );
  });

  it("stamps the sender and the time, whatever the client says", async () => {
    const row = await send(accountB, channel, "Ahoj všem", {
      sender_is_owner: true,
      sender_worker_id: w.C,
    });
    expect(row.owner_id).toBe(owner);
    expect(row.sender_is_owner).toBe(false);
    expect(row.sender_worker_id).toBe(w.B);
    expect(row.sender).toBe(w.B);
    expect(row.sender_user_id).toBe(accountB);
    const mine = await send(owner, channel, "Ahoj");
    expect(mine.sender).toBe(owner);
    expect(mine.sender_is_owner).toBe(true);
  });

  it("is read and written by members only", async () => {
    await expect(send(accountC, channel, "Můžu?")).rejects.toThrow(/row-level security|chat_/);
    await expect(send(stranger, channel, "Můžu?")).rejects.toThrow(/row-level security|chat_/);
    for (const uid of [accountC, stranger]) {
      expect(
        await as(uid, () => rows(`select id from chat_messages where channel_id = $1`, [channel])),
      ).toHaveLength(0);
      expect(
        await as(uid, () => rows(`select id from chat_channels where id = $1`, [channel])),
      ).toHaveLength(0);
    }
    expect(
      await as(accountB, () => rows(`select id from chat_messages where channel_id = $1`, [channel])),
    ).not.toHaveLength(0);
  });

  it("refuses empty messages, bad files and replies from elsewhere", async () => {
    await expect(send(accountB, channel, "   ")).rejects.toThrow(/chat_message_empty/);
    const id = crypto.randomUUID();
    await expect(
      send(accountB, channel, "Soubor", {
        id,
        attachments: [{ path: `${stranger}/${id}/${crypto.randomUUID()}`, name: "a.pdf", size: 10, mime: "application/pdf" }],
      }),
    ).rejects.toThrow(/chat_attachments_invalid/);
    await expect(
      send(accountB, channel, "Velký", {
        id,
        attachments: [{ path: `${owner}/${id}/${crypto.randomUUID()}`, name: "a.pdf", size: 20_000_000, mime: "application/pdf" }],
      }),
    ).rejects.toThrow(/chat_attachments_invalid/);
    await expect(
      send(accountB, channel, "Spustitelný", {
        id,
        attachments: [{ path: `${owner}/${id}/${crypto.randomUUID()}`, name: "a.exe", size: 10, mime: "application/x-msdownload" }],
      }),
    ).rejects.toThrow(/chat_attachments_invalid/);
    const elsewhere = await as(owner, async () => {
      const [row] = await rows<{ id: string }>(`select chat_open_direct($1) as id`, [w.C]);
      return row!.id;
    });
    const foreign = await send(owner, elsewhere, "Jinde");
    await expect(
      send(accountB, channel, "Odpověď", { reply_to_id: foreign.id }),
    ).rejects.toThrow(/chat_reply_outside/);
  });

  it("lets the sender edit and delete for 15 minutes, the owner delete anything", async () => {
    const own = await send(accountB, channel, "Překlep");
    await as(accountB, () =>
      db.query(`update chat_messages set body = 'Oprava' where id = $1`, [own.id]),
    );
    const [edited] = await rows<{ body: string; edited_at: string | null }>(
      `select body, edited_at from chat_messages where id = $1`,
      [own.id],
    );
    expect(edited).toMatchObject({ body: "Oprava" });
    expect(edited!.edited_at).not.toBeNull();

    // Somebody else's message: no.
    await expect(
      as(accountGone, () =>
        db.query(`update chat_messages set body = 'Cizí' where id = $1`, [own.id]),
      ),
    ).rejects.toThrow(/chat_message_locked/);
    await expect(
      as(accountGone, () =>
        db.query(`update chat_messages set deleted_at = now() where id = $1`, [own.id]),
      ),
    ).rejects.toThrow(/chat_message_locked/);

    // Older than 15 minutes: the sender no more, the owner still.
    await db.query(`update chat_messages set created_at = now() - interval '16 minutes' where id = $1`, [
      own.id,
    ]);
    await expect(
      as(accountB, () =>
        db.query(`update chat_messages set body = 'Pozdě' where id = $1`, [own.id]),
      ),
    ).rejects.toThrow(/chat_message_locked/);
    await as(owner, () =>
      db.query(`update chat_messages set deleted_at = now() where id = $1`, [own.id]),
    );
    const [gone] = await as(accountB, () =>
      rows<{ body: string; attachments: unknown[]; deleted_at: string | null }>(
        `select body, attachments, deleted_at from chat_messages where id = $1`,
        [own.id],
      ),
    );
    expect(gone).toMatchObject({ body: "", attachments: [] });
    expect(gone!.deleted_at).not.toBeNull();
    await expect(
      as(owner, () => db.query(`update chat_messages set body = 'Zpět' where id = $1`, [own.id])),
    ).rejects.toThrow(/chat_message_deleted/);
  });

  it("deletes own fresh messages and never removes rows", async () => {
    const own = await send(accountB, channel, "Omyl");
    await as(accountB, () =>
      db.query(`update chat_messages set deleted_at = now() where id = $1`, [own.id]),
    );
    const [row] = await rows<{ body: string }>(`select body from chat_messages where id = $1`, [
      own.id,
    ]);
    expect(row!.body).toBe("");
    await expect(
      as(owner, () => db.query(`delete from chat_messages where id = $1`, [own.id])),
    ).rejects.toThrow(/permission denied/);
    await expect(
      as(accountB, () =>
        db.query(`update chat_messages set sender_is_owner = true where channel_id = $1 and deleted_at is null`, [
          channel,
        ]),
      ),
    ).rejects.toThrow(/chat_message_fixed/);
  });

  it("closes everything to a removed worker at once, keeping their messages", async () => {
    const theirs = await send(accountGone, channel, "Loučím se");
    await db.query(`update workers set status = 'inactive' where id = $1`, [w.G]);
    expect(
      await as(accountGone, () =>
        rows(`select id from chat_messages where channel_id = $1`, [channel]),
      ),
    ).toHaveLength(0);
    await expect(send(accountGone, channel, "Ještě jedna")).rejects.toThrow(
      /row-level security|chat_/,
    );
    const [kept] = await as(owner, () =>
      rows<{ sender: string; body: string }>(`select sender, body from chat_messages where id = $1`, [
        theirs.id,
      ]),
    );
    expect(kept).toEqual({ sender: w.G, body: "Loučím se" });
    const people = await as(owner, () =>
      rows<{ member: string; name: string; status: string }>(
        `select member, name, status from chat_people() where member = $1`,
        [w.G],
      ),
    );
    expect(people).toEqual([{ member: w.G, name: "Gustav", status: "inactive" }]);
  });
});

describe("direct conversations", () => {
  it("are made once per pair, from either side", async () => {
    const first = await as(owner, async () => {
      const [row] = await rows<{ id: string }>(`select chat_open_direct($1) as id`, [w.B]);
      return row!.id;
    });
    const again = await as(accountB, async () => {
      const [row] = await rows<{ id: string }>(`select chat_open_direct($1) as id`, [owner]);
      return row!.id;
    });
    expect(again).toBe(first);
    expect(await members(first)).toEqual([owner, w.B].sort());
  });

  it("are private to the two, even to the owner", async () => {
    const between = await as(accountB, async () => {
      const [row] = await rows<{ id: string }>(`select chat_open_direct($1) as id`, [w.C]);
      return row!.id;
    });
    await send(accountB, between, "Jen mezi námi");
    expect(
      await as(owner, () => rows(`select id from chat_messages where channel_id = $1`, [between])),
    ).toHaveLength(0);
    expect(
      await as(accountC, () => rows(`select id from chat_messages where channel_id = $1`, [between])),
    ).toHaveLength(1);
    await expect(
      as(owner, () => db.query(`update chat_messages set deleted_at = now() where channel_id = $1`, [between])),
    ).resolves.toMatchObject({ affectedRows: 0 });
  });

  it("let the owner write to someone who has not joined yet, nobody else", async () => {
    const waiting = await as(owner, async () => {
      const [row] = await rows<{ id: string }>(`select chat_open_direct($1) as id`, [w.I]);
      return row!.id;
    });
    await send(owner, waiting, "Vítej, až dorazíš");
    await expect(
      as(accountB, () => db.query(`select chat_open_direct($1)`, [w.I])),
    ).rejects.toThrow(/chat_member_invalid/);
    await expect(as(accountB, () => db.query(`select chat_open_direct($1)`, [w.X]))).rejects.toThrow(
      /chat_member_invalid/,
    );
    await expect(as(stranger, () => db.query(`select chat_open_direct($1)`, [w.B]))).rejects.toThrow(
      /chat_member_invalid|chat_not_member/,
    );
    // The invitation accepted: the message is there.
    const joined = await createAuthUser();
    await db.query(`update workers set user_id = $2, status = 'active' where id = $1`, [w.I, joined]);
    const list = await overview(joined);
    expect(list.find((row) => row.id === waiting)).toMatchObject({ unread: 1, peer: owner });
  });

  it("refuse a removed worker", async () => {
    await expect(as(owner, () => db.query(`select chat_open_direct($1)`, [w.G]))).rejects.toThrow(
      /chat_member_invalid/,
    );
  });
});

describe("unread and read", () => {
  it("counts what others wrote since the last read, mentions apart", async () => {
    const group = await addGroup("Novinky");
    const channel = (await channelOfGroup(group))!;
    await as(owner, () =>
      db.query(`insert into worker_group_members (group_id, worker_id) values ($1, $2)`, [
        group,
        w.C,
      ]),
    );
    // Joined a moment before anything was written.
    await db.query(
      `update chat_members set last_read_at = now() - interval '1 second' where channel_id = $1`,
      [channel],
    );
    await send(owner, channel, "Jedna");
    await send(owner, channel, `Druhá pro <@${w.C}>`);
    await send(accountC, channel, "Moje");
    let mine = (await overview(accountC)).find((row) => row.id === channel)!;
    expect(mine).toMatchObject({ unread: 2, mentioned: true });
    expect((await overview(owner)).find((row) => row.id === channel)).toMatchObject({
      unread: 1,
      mentioned: false,
    });

    await as(accountC, () => db.query(`select chat_mark_read($1)`, [channel]));
    mine = (await overview(accountC)).find((row) => row.id === channel)!;
    expect(mine).toMatchObject({ unread: 0, mentioned: false });

    // Never back, and only one's own row.
    await as(accountC, () =>
      db.query(`select chat_mark_read($1, now() - interval '1 day')`, [channel]),
    );
    expect((await overview(accountC)).find((row) => row.id === channel)!.unread).toBe(0);
    await expect(
      as(stranger, () => db.query(`select chat_mark_read($1)`, [channel])),
    ).rejects.toThrow(/chat_not_member/);
  });

  it("keeps pins and mutes per member; only the owner silences a group for all", async () => {
    const [{ id: channel }] = await rows<{ id: string }>(
      `select id from chat_channels where kind = 'group' and archived_at is null limit 1`,
    );
    await as(owner, () => db.query(`select chat_set_member_flags($1, true, true)`, [channel]));
    const [flags] = await rows<{ pinned_at: string | null; muted: boolean }>(
      `select pinned_at, muted from chat_members where channel_id = $1 and member = $2`,
      [channel, owner],
    );
    expect(flags!.pinned_at).not.toBeNull();
    expect(flags!.muted).toBe(true);
    await as(owner, () => db.query(`select chat_set_muted_all($1, true)`, [channel]));
    await expect(
      as(accountB, () => db.query(`select chat_set_muted_all($1, false)`, [channel])),
    ).rejects.toThrow(/chat_owner_only/);
  });
});

describe("files", () => {
  it("are uploaded by a member of the space for a message not sent yet", async () => {
    const message = crypto.randomUUID();
    const file = crypto.randomUUID();
    const name = `${owner}/${message}/${file}`;
    const check = (uid: string, sql: string, value: string) =>
      as(uid, async () => (await rows<{ ok: boolean }>(sql, [value]))[0]!.ok);
    expect(await check(accountB, `select chat_attachment_uploadable($1) as ok`, name)).toBe(true);
    expect(await check(stranger, `select chat_attachment_uploadable($1) as ok`, name)).toBe(false);
    expect(
      await check(accountB, `select chat_attachment_uploadable($1) as ok`, `${owner}/${message}`),
    ).toBe(false);

    const group = await addGroup("Soubory");
    const channel = (await channelOfGroup(group))!;
    await as(owner, () =>
      db.query(`insert into worker_group_members (group_id, worker_id) values ($1, $2)`, [
        group,
        w.B,
      ]),
    );
    await send(accountB, channel, "", {
      id: message,
      attachments: [{ path: name, name: "smlouva.pdf", size: 1200, mime: "application/pdf" }],
    });
    expect(await check(accountB, `select chat_attachment_uploadable($1) as ok`, name)).toBe(false);
    expect(await check(owner, `select chat_attachment_readable($1) as ok`, name)).toBe(true);
    expect(await check(accountB, `select chat_attachment_readable($1) as ok`, name)).toBe(true);
    expect(await check(accountC, `select chat_attachment_readable($1) as ok`, name)).toBe(false);
    const [tracked] = await rows<{ size: number }>(
      `select size from chat_attachment_files where path = $1`,
      [name],
    );
    expect(Number(tracked!.size)).toBe(1200);

    // Deleted: unreadable, and the cron removes it.
    await as(accountB, () =>
      db.query(`update chat_messages set deleted_at = now() where id = $1`, [message]),
    );
    expect(await check(owner, `select chat_attachment_readable($1) as ok`, name)).toBe(false);
    const due = await rows<{ path: string; action: string }>(`select * from chat_attachments_due()`);
    expect(due).toContainEqual({ path: name, action: "remove" });
  });

  it("go to the trash after a year without opening", async () => {
    const message = crypto.randomUUID();
    const name = `${owner}/${message}/${crypto.randomUUID()}`;
    const [{ id: channel }] = await rows<{ id: string }>(
      `select c.id from chat_channels c join chat_members m on m.channel_id = c.id
       where c.kind = 'group' and c.archived_at is null and m.member = $1 limit 1`,
      [w.B],
    );
    await send(accountB, channel, "Starý soubor", {
      id: message,
      attachments: [{ path: name, name: "a.png", size: 10, mime: "image/png", width: 10, height: 10 }],
    });
    await db.query(
      `update chat_attachment_files set created_at = now() - interval '13 months' where path = $1`,
      [name],
    );
    expect(await rows(`select * from chat_attachments_due()`)).toContainEqual({
      path: name,
      action: "trash",
    });
    await db.query(`select chat_attachment_opened($1)`, [name]);
    expect(await rows(`select * from chat_attachments_due()`)).not.toContainEqual({
      path: name,
      action: "trash",
    });
    await expect(
      as(owner, () => db.query(`select chat_attachment_opened($1)`, [name])),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("e-mail", () => {
  it("goes out at most once an hour, never while the person is around", async () => {
    const claim = async (user: string) =>
      (await rows<{ ok: boolean }>(`select chat_email_claim($1) as ok`, [user]))[0]!.ok;
    expect(await claim(accountC)).toBe(true);
    expect(await claim(accountC)).toBe(false);
    await db.query(`insert into app_sessions (user_id) values ($1)`, [accountB]);
    expect(await claim(accountB)).toBe(false);
    await expect(as(accountB, () => db.query(`select chat_email_claim($1)`, [accountB]))).rejects.toThrow(
      /permission denied/,
    );
  });

  it("sums up unread direct messages and mentions", async () => {
    const digest = await rows<{ kind: string; messages: number; mentions: number }>(
      `select kind, messages, mentions from chat_email_digest($1)`,
      [accountC],
    );
    expect(digest.length).toBeGreaterThan(0);
    expect(digest.some((row) => row.kind === "direct" && row.messages > 0)).toBe(true);
  });
});

describe("read-only space", () => {
  it("keeps the chat readable and refuses new messages, reading still counts", async () => {
    // Not the first account of the database, so it has a trial to run out.
    const space = await createAuthUser();
    const account = await createAuthUser();
    const worker = await addWorker(space, "Petra", account);
    const group = await as(space, async () => {
      const [row] = await rows<{ id: string }>(
        `insert into worker_groups (name) values ('Sklad') returning id`,
      );
      await db.query(`insert into worker_group_members (group_id, worker_id) values ($1, $2)`, [
        row!.id,
        worker,
      ]);
      return row!.id;
    });
    const channel = (await channelOfGroup(group))!;
    await send(space, channel, "Před koncem");
    await db.query(
      `update subscriptions set trial_ends_at = now() - interval '1 minute' where user_id = $1`,
      [space],
    );
    const [{ ro }] = await rows<{ ro: boolean }>(`select workspace_read_only($1) as ro`, [space]);
    expect(ro).toBe(true);
    await expect(send(account, channel, "Po zkušebce")).rejects.toThrow(/read_only/);
    await as(account, () => db.query(`select chat_mark_read($1)`, [channel]));
    expect(
      await as(account, () => rows(`select id from chat_messages where channel_id = $1`, [channel])),
    ).toHaveLength(1);
  });
});
