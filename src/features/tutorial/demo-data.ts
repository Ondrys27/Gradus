import { freshRate, type RateTable } from "@/lib/exchange-rates";
import { psychologicalPrice } from "@/lib/psychological-price";
import type { IndustryKey } from "@/features/onboarding/industries";
import { draftFromDoc, type DocNode } from "@/features/notes/document";
import {
  TEMPLATE_QUESTIONS,
  hasIndustryQuestion,
  type TemplateTranslator,
} from "@/features/notes/templates";
import { todayIsoDate, zonedWallClockToInstant, type FormatSettings, type IsoDate } from "@/lib/format";

/**
 * The sample data of the full tutorial, worded in the user's language and
 * for the branch picked in onboarding: three contacts, a deal with the first
 * of them (its Close Date already past, so a pipeline tile lights up), a
 * milestone with tasks, two sales tasks, a meeting and an "Ideal customer"
 * note with answers. The database (tutorial_seed_demo) marks every row, links
 * them and puts them into the user's own space; this only says what they say
 * and when. No phone numbers: a made-up one could be somebody's.
 */

export const DEMO_CONTACT_KEYS = ["first", "second", "third"] as const;

/** A sample deal is worth about this much in EUR (25 000 Kč in Czech crowns, as the guide shows it). */
const DEAL_VALUE_EUR = 1_000;
const DEAL_VALUE: Record<string, number> = { CZK: 25_000, EUR: DEAL_VALUE_EUR };

/**
 * The sample deal's value in the display currency: a round figure where the
 * guide has one, else the EUR value at the day's rate as a selling price
 * (JPY 159 000), and 1 000 of the currency without a rate.
 */
export function demoDealValue(currency: string, rates: RateTable = {}, now: Date = new Date()): number {
  if (DEAL_VALUE[currency] !== undefined) return DEAL_VALUE[currency];
  const rate = freshRate(rates, currency, now);
  return rate === null ? DEAL_VALUE_EUR : psychologicalPrice(DEAL_VALUE_EUR * rate, currency);
}

export type DemoPayload = {
  contacts: { first_name: string; last_name: string; company_name: string; email: string; city: string }[];
  deal: { title: string; value: number; expected_close_date: IsoDate };
  milestone: { title: string; description: string; tasks: { title: string; children: string[] }[] };
  crm_tasks: { title: string; due_at: string; duration_minutes: number }[];
  meeting: { title: string; starts_at: string };
  note: { title: string; content: DocNode; content_text: string };
};

/** Translates a key under `tutorial.demo`, with values for the placeholders. */
export type DemoTranslator = (key: string, values?: Record<string, string>) => string;

function shift(day: IsoDate, days: number): IsoDate {
  const [year, month, date] = day.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, date + days)).toISOString().slice(0, 10) as IsoDate;
}

/** Monday to Friday: a sample meeting or call never lands on a weekend. */
function workday(day: IsoDate): IsoDate {
  const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
  if (weekday === 6) return shift(day, 2);
  if (weekday === 0) return shift(day, 1);
  return day;
}

function text(value: string): DocNode[] {
  return value ? [{ type: "text", text: value }] : [];
}

/** The "Ideal customer" template (notes) with sample answers under each question. */
export function demoNote(
  industry: IndustryKey,
  t: DemoTranslator,
  template: TemplateTranslator,
): DemoPayload["note"] {
  const questions: { question: string; answer: string }[] = TEMPLATE_QUESTIONS.idealCustomer.map(
    (key) => ({
      question: template(`idealCustomer.questions.${key}`),
      answer: t(`note.answers.${key}`, { branch: t(`branch.${industry}`) }),
    }),
  );
  if (hasIndustryQuestion("idealCustomer", industry)) {
    questions.splice(1, 0, {
      question: template(`idealCustomer.industry.${industry}`),
      answer: t("note.answers.industry"),
    });
  }
  const doc: DocNode = {
    type: "doc",
    content: [
      { type: "heading", attrs: { level: 1 }, content: text(template("idealCustomer.title")) },
      { type: "paragraph", content: text(t("note.intro")) },
      ...questions.flatMap<DocNode>(({ question, answer }) => [
        { type: "heading", attrs: { level: 3 }, content: text(question) },
        { type: "paragraph", content: text(answer) },
      ]),
    ],
  };
  const draft = draftFromDoc(doc);
  return { title: draft.title, content: doc, content_text: draft.content_text };
}

export function buildDemoPayload(input: {
  industry: IndustryKey;
  settings: FormatSettings;
  now: Date;
  t: DemoTranslator;
  template: TemplateTranslator;
  /** The day's exchange rates for the sample deal's value. */
  rates?: RateTable;
}): DemoPayload {
  const { industry, settings, now, t } = input;
  const zone = settings.timeZone;
  const today = todayIsoDate(settings, now);
  const at = (day: IsoDate, time: string) => zonedWallClockToInstant(day, time, zone).toISOString();

  const contacts = DEMO_CONTACT_KEYS.map((key) => {
    const first = t(`contacts.${key}.firstName`);
    return {
      first_name: first,
      last_name: t(`contacts.${key}.lastName`),
      company_name: t(`contacts.${key}.company.${industry}`),
      email: t(`contacts.${key}.email`),
      city: t(`contacts.${key}.city`),
    };
  });
  const [lead, second] = contacts as [DemoPayload["contacts"][number], DemoPayload["contacts"][number]];

  return {
    contacts,
    deal: {
      title: t(`deal.${industry}`, { company: lead.company_name }),
      value: demoDealValue(settings.currency, input.rates, now),
      expected_close_date: shift(today, -3),
    },
    milestone: {
      title: t("milestone.title"),
      description: t("milestone.description"),
      tasks: [
        { title: t("milestone.tasks.offer"), children: [t("milestone.tasks.prices"), t("milestone.tasks.references")] },
        { title: t("milestone.tasks.call"), children: [] },
        { title: t("milestone.tasks.follow"), children: [] },
      ],
    },
    crm_tasks: [
      { title: t("crmTasks.sendOffer"), due_at: at(workday(shift(today, 1)), "09:00"), duration_minutes: 30 },
      {
        title: t("crmTasks.call", { name: second.first_name }),
        due_at: at(workday(shift(today, 2)), "10:00"),
        duration_minutes: 15,
      },
    ],
    meeting: {
      title: t("meeting", { name: lead.first_name }),
      starts_at: at(workday(shift(today, 3)), "14:00"),
    },
    note: demoNote(industry, t, input.template),
  };
}
