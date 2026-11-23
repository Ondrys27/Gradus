import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/types/database";
import type { Locale } from "@/i18n/locales";
import { draftFromDoc, type DocNode } from "@/features/notes/document";
import { levelForXp, xpForLevel } from "@/features/game/rules";
import { monthKey, weekCount } from "@/features/finance/plan/weeks";
import { zonedWallClockToInstant } from "@/lib/format";
import { DEFAULT_QUESTIONS } from "@/features/scheduler/types";
import { grantRows, templateGrants } from "@/features/workers/permissions-catalog";
import { startState } from "../../engine";
import { stageData, stageHandle, type StageData } from "../stage-data";

type Db = SupabaseClient<Database>;

/**
 * Fills a fresh stage account with the showcase's data (step 27.4): every
 * row a sample (`is_demo` where the table has it), in the scenario's
 * language, currency and time zone. Runs on the server right after the
 * stage was made: the secret-key client writes the rows of this one account
 * (`userId` is the stage the server itself created, never anybody else),
 * the stage's own client moves contacts between tables (move_contact checks
 * the answers as in the app).
 */

const SECTION_UNLOCKS = [
  "section_contacts",
  "section_cold_calling",
  "section_pipeline",
  "section_calendar",
  "section_finance",
  "section_workers",
];

/** Level 5 well under way: a won deal later in the showcase may lift it to 6. */
const SEED_LEVEL = 5;

/** XP a little over half way through SEED_LEVEL (xpForLevel is the total a level starts at). */
export function seedXp(): number {
  const from = xpForLevel(SEED_LEVEL);
  return Math.round(from + (xpForLevel(SEED_LEVEL + 1) - from) * 0.55);
}

function must<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`showcase seed: missing ${what}`);
  return value;
}

function check(error: { message: string } | null, what: string) {
  if (error) throw new Error(`showcase seed: ${what}: ${error.message}`);
}

/** Today's date in a zone, and a day `offset` from it. */
function dayIn(timeZone: string, offset = 0, now = new Date()): string {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const [y, m, d] = today.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + offset)).toISOString().slice(0, 10);
}

/** Monday to Friday: a sample meeting never lands on a weekend. */
function workday(day: string): string {
  const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
  const shift = weekday === 6 ? 2 : weekday === 0 ? 1 : 0;
  if (!shift) return day;
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + shift);
  return date.toISOString().slice(0, 10);
}

function at(data: StageData, dayOffset: number, time: string): string {
  const day = dayOffset === 0 ? dayIn(data.timeZone) : workday(dayIn(data.timeZone, dayOffset));
  return zonedWallClockToInstant(day, time, data.timeZone).toISOString();
}

function textDoc(title: string, blocks: StageData["notes"][number]["blocks"]): DocNode {
  return {
    type: "doc",
    content: [
      { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: title }] },
      ...blocks.flatMap<DocNode>((block) => [
        ...(block.heading
          ? [{ type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: block.heading }] }]
          : []),
        { type: "paragraph", content: [{ type: "text", text: block.text }] },
      ]),
    ],
  };
}

export async function seedStage(input: {
  admin: Db;
  /** The stage's own client (signed in as it). */
  client: Db;
  userId: string;
  /** The colleague's account (the company scenario), or null. */
  workerUserId: string | null;
  locale: Locale;
}) {
  const { admin, client, userId, locale } = input;
  const data = stageData(locale);
  const now = new Date();
  const iso = (offsetDays: number) => new Date(now.getTime() + offsetDays * 86_400_000).toISOString();

  // The account: who it pretends to be, its language, money and clock.
  const profile = await admin
    .from("profiles")
    .update({
      display_name: `${data.owner.first} ${data.owner.last}`,
      company_name: data.owner.company,
      industry: "other",
      mode: "game",
      onboarding_completed_at: iso(-60),
      tour_completed_at: iso(-60),
      notes_intro_seen_at: iso(-60),
      seen_level: levelForXp(seedXp()),
      tutorial: startState("none", new Date(now.getTime() - 60 * 86_400_000)) as unknown as Json,
      last_daily_brief_on: dayIn(data.timeZone),
    })
    .eq("id", userId);
  check(profile.error, "profile");

  const { data: stages, error: stagesError } = await admin
    .from("pipeline_stages")
    .select("id, system_key, is_won, is_lost")
    .eq("user_id", userId);
  check(stagesError, "stages");
  const stageId = (key: StageData["deals"][number]["stage"]) => {
    const find = (systemKey: string) => stages?.find((stage) => stage.system_key === systemKey)?.id;
    if (key === "won") return must(stages?.find((stage) => stage.is_won)?.id, "won stage");
    if (key === "lost") return must(stages?.find((stage) => stage.is_lost)?.id, "lost stage");
    if (key === "offer_draft") return must(find("offer_draft") ?? find("deposit_paid"), "offer_draft");
    return must(find(key), `stage ${key}`);
  };

  const settings = await admin
    .from("user_settings")
    .update({
      locale,
      currency: data.currency,
      country_code: data.country,
      timezone: data.timeZone,
      number_format: data.formats.number,
      date_format: data.formats.date,
      time_format: "HH:mm",
      first_day_of_week: 1,
      // Grady does not fly in on his own during a showcase; the scenarios bring him.
      jarvis_proactive: false,
      chat_email_notifications: false,
      // A deal made from a call lands where the win is one step away.
      cold_calling_deal_stage_id: stageId("offer"),
    })
    .eq("user_id", userId);
  check(settings.error, "settings");

  const unlocks = await admin.from("unlocks").upsert(
    SECTION_UNLOCKS.map((key) => ({ user_id: userId, key, unlocked_at: iso(-30), seen_at: iso(-30) })),
    { onConflict: "user_id,key" },
  );
  check(unlocks.error, "unlocks");

  // A level half way, earned over the past weeks.
  const total = seedXp();
  const xpRows = Array.from({ length: 12 }, (_, index) => ({
    user_id: userId,
    kind: "task_completed",
    xp: index === 11 ? total - Math.floor(total / 12) * 11 : Math.floor(total / 12),
    idempotency_key: `showcase:${userId}:${index}`,
    created_at: iso(-(index * 2 + 1)),
  }));
  const xp = await admin.from("xp_events").insert(xpRows);
  check(xp.error, "xp");

  // Milestones with their tasks (and subtasks) for the map.
  for (const [position, milestone] of data.milestones.entries()) {
    const { data: row, error } = await admin
      .from("milestones")
      .insert({
        user_id: userId,
        title: milestone.title,
        description: milestone.description,
        position,
        is_demo: true,
      })
      .select("id")
      .single();
    check(error, "milestone");
    const milestoneId = must(row?.id, "milestone id");
    for (const [taskPosition, task] of milestone.tasks.entries()) {
      const parent = await admin
        .from("tasks")
        .insert({
          user_id: userId,
          milestone_id: milestoneId,
          title: task.title,
          position: taskPosition,
          status: task.done ? "done" : "todo",
          completed_at: task.done ? iso(-5) : null,
          completed_by: task.done ? userId : null,
          is_demo: true,
        })
        .select("id")
        .single();
      check(parent.error, "task");
      for (const [childPosition, child] of (task.children ?? []).entries()) {
        const sub = await admin.from("tasks").insert({
          user_id: userId,
          milestone_id: milestoneId,
          parent_task_id: must(parent.data?.id, "task id"),
          title: child.title,
          position: childPosition,
          status: child.done ? "done" : "todo",
          completed_at: child.done ? iso(-6) : null,
          completed_by: child.done ? userId : null,
          is_demo: true,
        });
        check(sub.error, "subtask");
      }
    }
    if (milestone.done) {
      const done = await admin
        .from("milestones")
        .update({ status: "completed", completed_at: iso(-20) })
        .eq("id", milestoneId);
      check(done.error, "milestone done");
    }
  }

  // Contacts, then into their tables the way the app moves them.
  const { data: contactRows, error: contactsError } = await admin
    .from("contacts")
    .insert(
      data.contacts.map((contact) => ({
        user_id: userId,
        company_name: contact.company,
        first_name: contact.first,
        last_name: contact.last,
        email: contact.email,
        phone: contact.phone ?? null,
        city: contact.city,
        country_code: data.country,
        source: "manual" as const,
        is_demo: true,
      })),
    )
    .select("id, company_name");
  check(contactsError, "contacts");
  const contactIds = data.contacts.map((contact) =>
    must(contactRows?.find((row) => row.company_name === contact.company)?.id, contact.company),
  );

  const { data: tables, error: tablesError } = await admin
    .from("contact_tables")
    .select("id, system_key")
    .eq("user_id", userId);
  check(tablesError, "contact tables");
  const { data: fields, error: fieldsError } = await admin
    .from("contact_table_fields")
    .select("id, table_id, system_key")
    .eq("user_id", userId);
  check(fieldsError, "contact fields");
  const tableId = (key: string) => must(tables?.find((table) => table.system_key === key)?.id, key);
  const fieldId = (table: string, key: string) =>
    fields?.find((field) => field.table_id === table && field.system_key === key)?.id;
  for (const [index, contact] of data.contacts.entries()) {
    if (!contact.table) continue;
    const target = tableId(contact.table);
    const answers: Record<string, string> = {};
    const meetingAt = fieldId(target, "meeting_at");
    const followUpAt = fieldId(target, "follow_up_at");
    const sentOn = fieldId(target, "sent_on");
    if (meetingAt) answers[meetingAt] = at(data, 1, "10:00");
    if (followUpAt) answers[followUpAt] = at(data, 2, "09:00");
    if (sentOn) answers[sentOn] = dayIn(data.timeZone, -2);
    const moved = await client.rpc("move_contact", {
      _contact_id: contactIds[index]!,
      _to_table_id: target,
      _answers: answers as Json,
    });
    check(moved.error, `move ${contact.company}`);
  }

  // Deals across the stages.
  const dealIds: string[] = [];
  for (const [position, deal] of data.deals.entries()) {
    const won = deal.stage === "won";
    const lost = deal.stage === "lost";
    const { data: row, error } = await admin
      .from("deals")
      .insert({
        user_id: userId,
        stage_id: stageId(deal.stage),
        title: deal.title,
        value: deal.value,
        currency: data.currency,
        contact_id: contactIds[deal.contact] ?? null,
        created_by: userId,
        position,
        expected_close_date: deal.closeIn !== undefined ? dayIn(data.timeZone, deal.closeIn) : null,
        won_at: won ? iso(-3) : null,
        lost_at: lost ? iso(-12) : null,
        entered_stage_at: iso(won ? -3 : -4),
        is_demo: true,
      })
      .select("id")
      .single();
    check(error, `deal ${deal.title}`);
    dealIds.push(must(row?.id, "deal id"));
  }

  const meetings = await admin.from("calendar_events").insert(
    data.meetings.map((meeting) => {
      const starts = at(data, meeting.dayOffset, meeting.time);
      return {
        user_id: userId,
        actor_id: userId,
        title: meeting.title,
        kind: "meeting" as const,
        starts_at: starts,
        ends_at: new Date(Date.parse(starts) + 60 * 60_000).toISOString(),
        all_day: false,
        contact_id: contactIds[meeting.contact] ?? null,
        is_demo: true,
      };
    }),
  );
  check(meetings.error, "meetings");

  const tasks = await admin.from("crm_tasks").insert(
    data.crmTasks.map((task) => ({
      user_id: userId,
      title: task.title,
      due_at: at(data, task.dayOffset, task.time),
      duration_minutes: 30,
      assignee_id: userId,
      created_by: userId,
      deal_id: task.deal !== undefined ? dealIds[task.deal] : null,
      contact_id: task.contact !== undefined ? contactIds[task.contact] : null,
      is_demo: true,
    })),
  );
  check(tasks.error, "crm tasks");

  for (const note of data.notes) {
    const draft = draftFromDoc(textDoc(note.title, note.blocks));
    const inserted = await admin.from("notes").insert({
      user_id: userId,
      space_id: userId,
      title: draft.title,
      content: draft.content as unknown as Json,
      content_text: draft.content_text,
      kind: "text",
      pinned: note.pinned ?? false,
      is_demo: true,
    });
    check(inserted.error, "note");
  }

  const transactions = await admin.from("transactions").insert(
    data.transactions.map((row) => ({
      user_id: userId,
      type: row.kind,
      amount: row.amount,
      currency: data.currency,
      description: row.label,
      occurred_on: dayIn(data.timeZone, row.dayOffset),
    })),
  );
  check(transactions.error, "transactions");

  // The plan of this month, week by week.
  const today = dayIn(data.timeZone);
  const month = monthKey(Number(today.slice(0, 4)), Number(today.slice(5, 7)));
  const planMonth = await admin.from("finance_plan_months").insert({
    user_id: userId,
    month,
    opening_capital: data.plan.opening,
    reserve: data.plan.reserve,
    currency: data.currency,
    created_by: userId,
  });
  check(planMonth.error, "plan month");
  const weeks = weekCount(month);
  const planRows = [
    ...data.plan.income.map((row) => ({ ...row, kind: "income" as const })),
    ...data.plan.expense.map((row) => ({ ...row, kind: "expense" as const })),
  ];
  for (const [position, row] of planRows.entries()) {
    const { data: inserted, error } = await admin
      .from("finance_plan_rows")
      .insert({ user_id: userId, month, kind: row.kind, label: row.label, position })
      .select("id")
      .single();
    check(error, "plan row");
    const cells = Array.from({ length: weeks }, (_, index) => ({
      user_id: userId,
      row_id: must(inserted?.id, "plan row id"),
      week: index + 1,
      planned: row.weeks[index] ?? 0,
    })).filter((cell) => cell.planned > 0);
    if (cells.length) {
      const cellInsert = await admin.from("finance_plan_cells").insert(cells);
      check(cellInsert.error, "plan cells");
    }
  }

  const invoice = data.invoice;
  const profileRow = await admin.from("invoice_profiles").insert({
    user_id: userId,
    name: invoice.name,
    company_reg_no: invoice.regNo,
    vat_no: invoice.vatNo,
    vat_payer: false,
    street: invoice.street,
    city: invoice.city,
    postal_code: invoice.postalCode,
    country: data.country,
    email: invoice.email,
    account_number: invoice.accountNumber,
    bank_code: invoice.bankCode,
    iban: invoice.iban,
    bic: invoice.bic,
    currency: data.currency,
    due_days: 14,
    number_prefix: invoice.prefix,
    qr_enabled: true,
    style: "line",
  });
  check(profileRow.error, "invoice profile");

  // The booking page: a profile, its working hours and one meeting type.
  const scheduler = data.scheduler;
  const { data: schedulerProfile, error: schedulerError } = await admin
    .from("scheduler_profiles")
    .insert({
      user_id: userId,
      space_id: userId,
      handle: stageHandle(locale, userId),
      display_name: `${data.owner.first} ${data.owner.last}`,
      headline: scheduler.headline,
      time_zone: data.timeZone,
      video_link: "https://meet.example.com/showcase",
      setup_done_at: iso(-10),
    })
    .select("id")
    .single();
  check(schedulerError, "scheduler profile");
  const profileId = must(schedulerProfile?.id, "scheduler profile id");
  const rules = await admin.from("availability_rules").insert(
    [1, 2, 3, 4, 5].map((weekday) => ({
      user_id: userId,
      space_id: userId,
      profile_id: profileId,
      weekday,
      start_time: "09:00",
      end_time: "17:00",
    })),
  );
  check(rules.error, "availability");
  const type = await admin.from("event_types").insert({
    user_id: userId,
    space_id: userId,
    profile_id: profileId,
    name: scheduler.typeTitle,
    slug: scheduler.typeSlug,
    duration_min: scheduler.minutes,
    location_kind: "video",
    active: true,
    // Name and e-mail only: a made-up guest has no phone to give.
    questions: DEFAULT_QUESTIONS.filter((question) => question.key !== "phone") as unknown as Json,
  });
  check(type.error, "event type");

  // The colleague: an active worker with the assistant's rights (the scenario makes them sales).
  if (input.workerUserId) {
    const person = data.worker;
    const { data: worker, error: workerError } = await admin
      .from("workers")
      .insert({
        owner_id: userId,
        user_id: input.workerUserId,
        name: `${person.first} ${person.last}`,
        first_name: person.first,
        last_name: person.last,
        email: person.email,
        job_title: person.jobTitle,
        status: "active",
      })
      .select("id")
      .single();
    check(workerError, "worker");
    const workerId = must(worker?.id, "worker id");
    const grants = await admin.from("worker_permission_grants").upsert(
      grantRows(templateGrants("assistant")).map((row) => ({
        ...row,
        owner_id: userId,
        worker_id: workerId,
      })),
      { onConflict: "worker_id,section,action" },
    );
    check(grants.error, "worker rights");
    const colleagueProfile = await admin
      .from("profiles")
      .update({
        display_name: `${person.first} ${person.last}`,
        onboarding_completed_at: iso(-30),
        tour_completed_at: iso(-30),
      })
      .eq("id", input.workerUserId);
    check(colleagueProfile.error, "colleague profile");
  }

  return { contactIds, dealIds };
}
