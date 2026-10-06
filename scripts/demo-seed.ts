/**
 * Creates (or refreshes) the demo account the website's screenshots and the
 * `bun run screenshots` script are taken from: demo@gradus.local, Czech,
 * level 7, with milestones in different phases, a full pipeline, contacts
 * across several tables, a month of calendar events, half a year of
 * transactions, two workers and three weeks of recorded call time.
 *
 *   bun run demo:seed
 *
 * Idempotent: every run wipes this one account's own content (never its
 * identity, never any other account) and rebuilds it from scratch, so it is
 * safe to run again and again. Every name below is invented.
 *
 * Needs NEXT_PUBLIC_SUPABASE_URL, the publishable (anon) key and the secret
 * (service role) key in the environment; Bun reads .env and .env.local by
 * itself.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "../src/types/database";

type Db = SupabaseClient<Database>;

const DEMO_EMAIL = "demo@gradus.local";
const DEMO_PASSWORD = process.env.DEMO_SEED_PASSWORD ?? "GradusDemo#2026";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publicKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const secretKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !publicKey || !secretKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL, the publishable key or the secret key.");
  process.exit(2);
}

const noSession = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false };
const admin: Db = createClient<Database>(url, secretKey, { auth: noSession });

function must<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`Missing ${what}`);
  return value;
}
function iso(date: Date): string {
  return date.toISOString();
}
function daysAgo(n: number, hour = 10, minute = 0): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  d.setUTCHours(hour, minute, 0, 0);
  return d;
}
function onDay(offsetFromMonthStart: number, hour = 9, minute = 0): Date {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCDate(1 + offsetFromMonthStart);
  d.setUTCHours(hour, minute, 0, 0);
  return d;
}
function monthsAgo(n: number, dayOfMonth: number, hour = 12): Date {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - n, dayOfMonth);
  d.setUTCHours(hour, 0, 0, 0);
  return d;
}
function pick<T>(arr: readonly T[], i: number): T {
  return arr[i % arr.length]!;
}

// -----------------------------------------------------------------------------
// 1. The account itself
// -----------------------------------------------------------------------------

async function getOrCreateUser(email: string, metadata: Record<string, unknown> = {}) {
  // listUsers has no email filter in every client version, so page through;
  // a dev/staging project has few enough accounts for this to be cheap.
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const found = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (found) return found.id;
    if (data.users.length < 200) break;
  }
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: DEMO_PASSWORD,
    email_confirm: true,
    user_metadata: metadata,
  });
  if (error || !data.user) throw error ?? new Error("createUser returned no user");
  return data.user.id;
}

async function wipeDemoContent(userId: string) {
  // Children before parents; the account's identity (profiles, user_settings,
  // user_roles, subscriptions, pipeline_stages, contact_tables) is kept and
  // only refreshed below, so the account keeps the same URL-free structure.
  const workers = await admin.from("workers").select("id").eq("owner_id", userId);
  const workerIds = (workers.data ?? []).map((w) => w.id);
  if (workerIds.length) {
    await admin.from("worker_permissions").delete().in("worker_id", workerIds);
    await admin.from("workers").delete().in("id", workerIds);
  }
  await admin.from("jarvis_messages").delete().eq("user_id", userId);
  await admin.from("jarvis_conversations").delete().eq("user_id", userId);
  await admin.from("calendar_events").delete().eq("user_id", userId);
  await admin.from("transactions").delete().eq("user_id", userId);
  await admin.from("contact_table_moves").delete().eq("user_id", userId);
  await admin.from("contact_table_entries").delete().eq("user_id", userId);
  await admin.from("deals").delete().eq("user_id", userId);
  await admin.from("contacts").delete().eq("user_id", userId);
  await admin.from("tasks").delete().eq("user_id", userId);
  await admin.from("milestones").delete().eq("user_id", userId);
  await admin.from("prospecting_segments").delete().eq("user_id", userId);
  await admin.from("xp_events").delete().eq("user_id", userId);
  await admin.from("unlocks").delete().eq("user_id", userId);
  await admin.from("user_achievements").delete().eq("user_id", userId);
}

async function provisionAccount(userId: string) {
  const { error } = await admin.rpc("initialize_user", { _user_id: userId, _locale: "cs" });
  if (error) throw error;

  await admin
    .from("profiles")
    .update({
      mode: "game",
      display_name: "Demo účet",
      industry: "sluzby",
      onboarding_completed_at: iso(daysAgo(60)),
      tour_completed_at: iso(daysAgo(60)),
      seen_level: 7,
    })
    .eq("id", userId);

  await admin
    .from("user_settings")
    .update({
      locale: "cs",
      currency: "CZK",
      country_code: "CZ",
      timezone: "Europe/Prague",
      theme: "gradus",
      daily_call_goal: 25,
    })
    .eq("user_id", userId);
}

async function signInAsDemo(): Promise<Db> {
  const client: Db = createClient<Database>(url!, publicKey!, { auth: noSession });
  const { error } = await client.auth.signInWithPassword({ email: DEMO_EMAIL, password: DEMO_PASSWORD });
  if (error) throw error;
  return client;
}

// -----------------------------------------------------------------------------
// 2. The path: six milestones in different phases
// -----------------------------------------------------------------------------

async function seedPathAndMilestones(authClient: Db, userId: string) {
  const { data: paths, error: pathsError } = await admin
    .from("paths")
    .select("key")
    .order("position")
    .limit(1);
  if (pathsError) throw pathsError;
  const pathKey = must(paths?.[0]?.key, "a path");

  const { error: chooseError } = await authClient.rpc("choose_path", { _path_key: pathKey });
  if (chooseError) throw chooseError;

  const { data: milestones, error: milestonesError } = await admin
    .from("milestones")
    .select("id")
    .eq("user_id", userId)
    .order("position")
    .limit(6);
  if (milestonesError) throw milestonesError;
  const ids = (milestones ?? []).map((m) => m.id);
  if (ids.length < 6) return; // the path has fewer steps than expected; leave as copied

  async function tasksOf(milestoneId: string) {
    const { data, error } = await admin
      .from("tasks")
      .select("id")
      .eq("milestone_id", milestoneId)
      .order("position");
    if (error) throw error;
    return (data ?? []).map((t) => t.id);
  }

  async function markDone(taskId: string, when: Date) {
    await admin
      .from("tasks")
      .update({ status: "done", completed_by: userId, completed_at: iso(when) })
      .eq("id", taskId);
  }

  async function complete(milestoneId: string, when: Date, reward?: string) {
    await admin
      .from("milestones")
      .update({ status: "completed", completed_at: iso(when), reward: reward ?? null })
      .eq("id", milestoneId);
  }

  // 1. Done three weeks ago, with a reward.
  const tasks0 = await tasksOf(ids[0]!);
  for (const t of tasks0) await markDone(t, daysAgo(21));
  await complete(ids[0]!, daysAgo(21), "Kávovar pro kancelář");

  // 2. Done ten days ago.
  const tasks1 = await tasksOf(ids[1]!);
  for (const t of tasks1) await markDone(t, daysAgo(10));
  await complete(ids[1]!, daysAgo(10));

  // 3. In progress, about 60% of its tasks done.
  const tasks2 = await tasksOf(ids[2]!);
  for (const [i, t] of tasks2.entries()) {
    if (i < Math.ceil(tasks2.length * 0.6)) await markDone(t, daysAgo(3 - (i % 3)));
  }

  // 4. Every task done but not completed yet — the unlocked, glowing state.
  const tasks3 = await tasksOf(ids[3]!);
  for (const t of tasks3) await markDone(t, daysAgo(1));

  // 5. Just started: one task done.
  const tasks4 = await tasksOf(ids[4]!);
  if (tasks4[0]) await markDone(tasks4[0], daysAgo(2));

  // 6. Freshly added, nothing done yet — left as choose_path copied it.

  // The path's own early milestones do not carry every section's unlock key
  // (later chapters do), but the demo account needs every core section open
  // for its screenshots. Workers stays level-gated (level 10), as real play
  // would have it.
  const sectionKeys = [
    "section_contacts",
    "section_cold_calling",
    "section_pipeline",
    "section_calendar",
    "section_finance",
  ];
  const { error: unlockError } = await admin
    .from("unlocks")
    .upsert(
      sectionKeys.map((key) => ({ user_id: userId, key, unlocked_at: iso(daysAgo(21)) })),
      { onConflict: "user_id,key", ignoreDuplicates: true },
    );
  if (unlockError) throw unlockError;
}

// -----------------------------------------------------------------------------
// 3. Contacts, spread across the tables
// -----------------------------------------------------------------------------

const COMPANIES = [
  "Lipová Pekárna s.r.o.",
  "Studio Dřevo & Beton",
  "Vrabec Marketing",
  "Kavárna Na Rohu",
  "Horák Stavby",
  "Zelený Dvůr Catering",
  "Novotná Účetnictví",
  "Městská Kovárna",
  "Dílna Pro Radost",
  "Švec Fotografie",
  "Čistá Energie CZ",
  "Bistro U Lípy",
  "Keramika Malvína",
  "Truhlářství Jindra",
  "Květinářství Petrklíč",
  "Autoservis Beneš",
  "Masáže Harmonie",
  "Pivovar Na Kraji",
  "Papírnictví Sojka",
  "Zahradní Architektura Vlk",
  "Salón Elegance",
  "Fitness Studio Pevnost",
  "Stolařství Doubek",
  "Cukrárna Sladký Sen",
  "IT Servis Mráček",
  "Reklamní Agentura Komár",
  "Právní Kancelář Dvořák",
  "Realitní Kancelář Obzor",
  "Jazyková Škola Brána",
  "Veterinární Klinika Čtyřlístek",
];
const FIRST_NAMES = ["Jana", "Petr", "Lucie", "Tomáš", "Eva", "Martin", "Kateřina", "David"];
const LAST_NAMES = ["Nováková", "Svoboda", "Dvořáková", "Procházka", "Horáková", "Kučera"];
const CITIES = ["Praha", "Brno", "Ostrava", "Plzeň", "Liberec", "Olomouc", "České Budějovice"];

function demoContact(i: number) {
  return {
    company_name: pick(COMPANIES, i),
    first_name: pick(FIRST_NAMES, i),
    last_name: pick(LAST_NAMES, i + 2),
    email: `kontakt${i + 1}@example-demo.cz`,
    phone: `+4207${(20000000 + i * 137) % 10000000}`.slice(0, 13),
    city: pick(CITIES, i),
    country_code: "CZ",
    source: "manual" as const,
  };
}

async function seedContacts(authClient: Db, userId: string) {
  const rows = Array.from({ length: 30 }, (_, i) => ({ ...demoContact(i), user_id: userId }));
  const { data: contacts, error } = await admin.from("contacts").insert(rows).select("id");
  if (error) throw error;
  const ids = (contacts ?? []).map((c) => c.id);

  const { data: tables, error: tablesError } = await admin
    .from("contact_tables")
    .select("id, system_key")
    .eq("user_id", userId);
  if (tablesError) throw tablesError;
  const tableId = (key: string) => must(tables?.find((t) => t.system_key === key)?.id, `table ${key}`);

  const { data: fields, error: fieldsError } = await admin
    .from("contact_table_fields")
    .select("id, table_id, system_key")
    .eq("user_id", userId);
  if (fieldsError) throw fieldsError;
  const fieldId = (table: string, key: string) =>
    must(fields?.find((f) => f.table_id === table && f.system_key === key)?.id, `field ${key}`);

  // Leave several in "Neoslovení klienti" (the default); move the rest around.
  const noAnswer = tableId("no_answer");
  const failed = tableId("failed");
  const meeting = tableId("meeting_scheduled");
  const emailSent = tableId("email_sent");
  const followUp = tableId("follow_up");
  const reasonField = fieldId(failed, "reason");
  const sentOnField = fieldId(emailSent, "sent_on");
  const meetingAtField = fieldId(meeting, "meeting_at");
  const followUpAtField = fieldId(followUp, "follow_up_at");
  const reasons = ["not_interested", "no_budget", "has_solution", "other"];

  async function move(
    contactId: string,
    toTableId: string,
    answers: Record<string, string> = {},
  ) {
    const { error } = await authClient.rpc("move_contact", {
      _contact_id: contactId,
      _to_table_id: toTableId,
      _answers: answers as Json,
    });
    if (error) throw error;
  }

  for (let i = 0; i < ids.length; i++) {
    const contactId = ids[i]!;
    const bucket = i % 5;
    if (bucket === 0) {
      await move(contactId, noAnswer);
    } else if (bucket === 1) {
      await move(contactId, failed, { [reasonField]: pick(reasons, i) });
    } else if (bucket === 2) {
      await move(
        contactId,
        meeting,
        { [meetingAtField]: iso(onDay(16 + (i % 10), 10 + (i % 6))).slice(0, 16) },
      );
    } else if (bucket === 3) {
      await move(contactId, emailSent, { [sentOnField]: iso(daysAgo(i % 10)).slice(0, 10) });
    } else {
      await move(contactId, followUp, {
        [followUpAtField]: iso(onDay(18 + (i % 8), 9 + (i % 6))).slice(0, 16),
      });
    }
  }
  return ids;
}

// -----------------------------------------------------------------------------
// 4. Pipeline: 14 deals across every stage
// -----------------------------------------------------------------------------

const DEAL_TITLES = [
  "Nový web pro pekárnu",
  "Marketingová kampaň podzim",
  "Redesign e-shopu",
  "Měsíční správa sítí",
  "Fotografie pro katalog",
  "Firemní identita",
  "Konzultace procesů",
  "Catering na konferenci",
  "Nábytek na zakázku",
  "Servisní smlouva",
  "Vánoční kampaň",
  "Přestavba kanceláří",
  "Audit účetnictví",
  "Školení zaměstnanců",
];

async function seedPipeline(userId: string, contactIds: string[]) {
  const { data: stages, error } = await admin
    .from("pipeline_stages")
    .select("id, system_key")
    .eq("user_id", userId);
  if (error) throw error;
  const stageId = (key: string) => must(stages?.find((s) => s.system_key === key)?.id, `stage ${key}`);

  // lead ×4, meeting ×3, offer ×3, deposit_paid ×2, won ×1, lost ×1
  const plan: { stage: string; value: number; contact?: string; lost?: boolean }[] = [
    { stage: "lead", value: 18000 },
    { stage: "lead", value: 42000 },
    { stage: "lead", value: 9000 },
    { stage: "lead", value: 65000 },
    { stage: "meeting", value: 28000, contact: contactIds[2] },
    { stage: "meeting", value: 54000, contact: contactIds[5] },
    { stage: "meeting", value: 15000 },
    { stage: "offer", value: 76000, contact: contactIds[7] },
    { stage: "offer", value: 33000, contact: contactIds[9] },
    { stage: "offer", value: 21000 },
    { stage: "deposit_paid", value: 120000, contact: contactIds[11] },
    { stage: "deposit_paid", value: 48000, contact: contactIds[13] },
    { stage: "won", value: 95000, contact: contactIds[0] },
    { stage: "lost", value: 36000, contact: contactIds[4], lost: true },
  ];

  const dealIds: string[] = [];
  for (let i = 0; i < plan.length; i++) {
    const row = plan[i]!;
    const created = daysAgo(28 - i * 2);
    const { data: inserted, error: insertError } = await admin
      .from("deals")
      .insert({
        user_id: userId,
        title: DEAL_TITLES[i]!,
        value: row.value,
        currency: "CZK",
        stage_id: stageId(row.stage),
        contact_id: row.contact ?? null,
        created_by: userId,
        lost_reason: row.lost ? "Vybrali jiného dodavatele" : null,
      })
      .select("id")
      .single();
    if (insertError) throw insertError;
    dealIds.push(inserted.id);
    // The stage trigger stamps "now"; backdate it without touching stage_id
    // so the trigger does not fire again.
    await admin
      .from("deals")
      .update({ created_at: iso(created), entered_stage_at: iso(created) })
      .eq("id", inserted.id);
  }
  return dealIds;
}

// -----------------------------------------------------------------------------
// 5. Calendar: this month
// -----------------------------------------------------------------------------

async function seedCalendar(userId: string) {
  const kinds: Database["public"]["Enums"]["calendar_event_kind"][] = [
    "meeting",
    "call",
    "task",
    "reminder",
    "deadline",
  ];
  const titles = [
    "Schůzka s klientem",
    "Telefonát – nabídka",
    "Příprava smlouvy",
    "Platba faktury",
    "Konzultace projektu",
    "Focení produktů",
    "Kontrola webu",
    "Setkání s týmem",
  ];
  const rows = Array.from({ length: 10 }, (_, i) => ({
    user_id: userId,
    title: pick(titles, i),
    kind: pick(kinds, i),
    starts_at: iso(onDay(2 + i * 2, 9 + (i % 7))),
    ends_at: iso(onDay(2 + i * 2, 10 + (i % 7))),
    all_day: false,
    source: "manual",
  }));
  const { error } = await admin.from("calendar_events").insert(rows);
  if (error) throw error;
}

// -----------------------------------------------------------------------------
// 6. Finance: six months of transactions
// -----------------------------------------------------------------------------

const INCOME_DESCRIPTIONS = ["Platba za zakázku", "Záloha klienta", "Faktura uhrazena"];
const EXPENSE_CATEGORIES = ["office", "software", "marketing", "travel", "equipment"];
const EXPENSE_DESCRIPTIONS = [
  "Nájem kanceláře",
  "Předplatné nástrojů",
  "Reklama na sociálních sítích",
  "Benzín a doprava",
  "Nákup vybavení",
];

async function seedFinance(userId: string, dealIds: string[]) {
  const rows: Database["public"]["Tables"]["transactions"]["Insert"][] = [];
  for (let month = 0; month < 6; month++) {
    for (let i = 0; i < 3; i++) {
      const day = 3 + i * 9;
      rows.push({
        user_id: userId,
        type: "income",
        amount: 15000 + ((month * 3 + i) % 5) * 9000,
        currency: "CZK",
        occurred_on: iso(monthsAgo(month, day)).slice(0, 10),
        description: pick(INCOME_DESCRIPTIONS, month + i),
        deal_id: month === 0 && i === 0 ? dealIds[12] : null,
        source: "manual",
      });
    }
    for (let i = 0; i < 2; i++) {
      const day = 7 + i * 11;
      rows.push({
        user_id: userId,
        type: "expense",
        amount: 2500 + ((month + i) % 4) * 1800,
        currency: "CZK",
        occurred_on: iso(monthsAgo(month, day)).slice(0, 10),
        description: pick(EXPENSE_DESCRIPTIONS, month + i),
        category: pick(EXPENSE_CATEGORIES, month + i),
        source: "manual",
      });
    }
  }
  const { error } = await admin.from("transactions").insert(rows);
  if (error) throw error;
}

// -----------------------------------------------------------------------------
// 7. Two workers
// -----------------------------------------------------------------------------

async function seedWorkers(ownerId: string) {
  const worker1 = await getOrCreateUser("demo-pracovnik1@gradus.local", { locale: "cs" });
  const worker2 = await getOrCreateUser("demo-pracovnik2@gradus.local", { locale: "cs" });
  await admin.rpc("initialize_user", { _user_id: worker1, _locale: "cs" });
  await admin.rpc("initialize_user", { _user_id: worker2, _locale: "cs" });

  const { data: w1, error: e1 } = await admin
    .from("workers")
    .insert({
      owner_id: ownerId,
      user_id: worker1,
      name: "Barbora Malá",
      job_title: "Obchodní zástupkyně",
      status: "active",
    })
    .select("id")
    .single();
  if (e1) throw e1;
  const { data: w2, error: e2 } = await admin
    .from("workers")
    .insert({
      owner_id: ownerId,
      user_id: worker2,
      name: "Filip Kratochvíl",
      job_title: "Cold calling",
      status: "active",
    })
    .select("id")
    .single();
  if (e2) throw e2;

  const sections: Database["public"]["Enums"]["app_section"][] = [
    "milestones",
    "contacts",
    "pipeline",
    "cold_calling",
    "calendar",
  ];
  const grants = sections.flatMap((section) => [
    { owner_id: ownerId, worker_id: w1.id, section, can_view: true, can_edit: true },
    { owner_id: ownerId, worker_id: w2.id, section, can_view: section === "cold_calling", can_edit: false },
  ]);
  const { error } = await admin.from("worker_permissions").insert(grants);
  if (error) throw error;
}

// -----------------------------------------------------------------------------
// 8. Three weeks of recorded call time
// -----------------------------------------------------------------------------

async function seedProspecting(userId: string) {
  const rows: Database["public"]["Tables"]["prospecting_segments"]["Insert"][] = [];
  for (let day = 1; day <= 21; day += 2) {
    const start1 = daysAgo(day, 9, 0);
    const end1 = daysAgo(day, 9, 35);
    const start2 = daysAgo(day, 13, 15);
    const end2 = daysAgo(day, 14, 0);
    rows.push(
      { user_id: userId, started_at: iso(start1), ended_at: iso(end1), end_reason: "pause" },
      { user_id: userId, started_at: iso(start2), ended_at: iso(end2), end_reason: "pause" },
    );
  }
  const { error } = await admin.from("prospecting_segments").insert(rows);
  if (error) throw error;
}

// -----------------------------------------------------------------------------
// 9. XP history for level 7 and a streak
// -----------------------------------------------------------------------------

async function seedXp(userId: string) {
  const rows: Database["public"]["Tables"]["xp_events"]["Insert"][] = [];
  let total = 0;
  const target = 3050; // level 7 spans 2 698–3 343 total XP
  // The last ten days, one entry each, build a visible streak.
  for (let day = 0; day < 10 && total < target; day++) {
    const xp = 10;
    rows.push({
      user_id: userId,
      kind: "task_completed",
      xp,
      idempotency_key: `demo-seed-streak-${day}`,
      created_at: iso(daysAgo(day, 11)),
    });
    total += xp;
  }
  const extras: { kind: string; xp: number; day: number }[] = [
    { kind: "milestone_completed", xp: 400, day: 21 },
    { kind: "milestone_completed", xp: 300, day: 10 },
    { kind: "deal_won", xp: 245, day: 3 },
    { kind: "meeting_booked", xp: 40, day: 6 },
    { kind: "meeting_booked", xp: 40, day: 8 },
    { kind: "call_30min", xp: 30, day: 1 },
    { kind: "call_30min", xp: 30, day: 3 },
    { kind: "call_30min", xp: 30, day: 5 },
    { kind: "contact_moved", xp: 5, day: 2 },
    { kind: "contact_moved", xp: 5, day: 4 },
    { kind: "calendar_event", xp: 5, day: 7 },
    { kind: "transaction_added", xp: 5, day: 9 },
  ];
  for (let i = 0; i < extras.length && total < target; i++) {
    const e = extras[i]!;
    rows.push({
      user_id: userId,
      kind: e.kind,
      xp: e.xp,
      idempotency_key: `demo-seed-extra-${i}`,
      created_at: iso(daysAgo(e.day, 15)),
    });
    total += e.xp;
  }
  // Top up precisely to the target so the level pill sits mid-level.
  const remainder = target - total;
  if (remainder > 0) {
    rows.push({
      user_id: userId,
      kind: "task_completed",
      xp: remainder,
      idempotency_key: "demo-seed-topup",
      created_at: iso(daysAgo(0, 11)),
    });
  }
  const { error } = await admin.from("xp_events").insert(rows);
  if (error) throw error;
}

// -----------------------------------------------------------------------------
// 10. A Jarvis conversation to screenshot
// -----------------------------------------------------------------------------

async function seedJarvis(userId: string) {
  const { data: conversation, error } = await admin
    .from("jarvis_conversations")
    .insert({ user_id: userId, title: "Jak zrychlit pipeline", last_message_at: iso(daysAgo(0, 11)) })
    .select("id")
    .single();
  if (error) throw error;
  const messages: Database["public"]["Tables"]["jarvis_messages"]["Insert"][] = [
    {
      user_id: userId,
      conversation_id: conversation.id,
      role: "user",
      content: "Které obchody bych měl tento týden posunout dál?",
      created_at: iso(daysAgo(0, 11, 2)),
    },
    {
      user_id: userId,
      conversation_id: conversation.id,
      role: "assistant",
      content:
        "Nejvíc by pomohlo zavolat Horák Stavby a Zelený Dvůr Catering – oba jsou ve fázi Nabídka odeslána\n" +
        "už přes týden. Chceš, abych ti připravil krátké shrnutí nabídky pro each z nich?",
      model: "claude-sonnet",
      created_at: iso(daysAgo(0, 11, 3)),
    },
    {
      user_id: userId,
      conversation_id: conversation.id,
      role: "user",
      content: "Jo, hlavně pro Horák Stavby.",
      created_at: iso(daysAgo(0, 11, 4)),
    },
    {
      user_id: userId,
      conversation_id: conversation.id,
      role: "assistant",
      content:
        "Hotovo. V zápisu k obchodu najdeš tři body, co zmínit – rozpočet, termín a kontakt na vedoucího\n" +
        "stavby. Dobrý den na zavolání je úterý dopoledne, podle vašich předchozích hovorů.",
      model: "claude-sonnet",
      created_at: iso(daysAgo(0, 11, 5)),
    },
  ];
  const { error: messagesError } = await admin.from("jarvis_messages").insert(messages);
  if (messagesError) throw messagesError;
}

// -----------------------------------------------------------------------------

async function main() {
  console.log(`Seeding ${DEMO_EMAIL}…`);
  const userId = await getOrCreateUser(DEMO_EMAIL, { locale: "cs" });
  await admin.auth.admin.updateUserById(userId, { password: DEMO_PASSWORD, email_confirm: true });

  console.log("Wiping previous demo content…");
  await wipeDemoContent(userId);

  console.log("Setting up the account…");
  await provisionAccount(userId);
  const authClient = await signInAsDemo();

  console.log("Path and milestones…");
  await seedPathAndMilestones(authClient, userId);

  console.log("Contacts…");
  const contactIds = await seedContacts(authClient, userId);

  console.log("Pipeline…");
  const dealIds = await seedPipeline(userId, contactIds);

  console.log("Calendar…");
  await seedCalendar(userId);

  console.log("Finance…");
  await seedFinance(userId, dealIds);

  console.log("Workers…");
  await seedWorkers(userId);

  console.log("Call time…");
  await seedProspecting(userId);

  console.log("XP and streak…");
  await seedXp(userId);

  console.log("Jarvis conversation…");
  await seedJarvis(userId);

  console.log(`Done. Sign in as ${DEMO_EMAIL} / ${DEMO_PASSWORD}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
