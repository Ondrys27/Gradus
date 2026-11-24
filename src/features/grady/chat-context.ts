/**
 * The chat's context cut to what a message is about (step 28.9). Pure and
 * deterministic: words of the message (and the two user messages before it,
 * so "and the cheaper one?" after a question about plans still counts) pick
 * the topics; the situation then lists the always-needed lines (today, the
 * time window) and the parts of those topics, and the plan catalog goes in
 * only when the talk is about plans. A message that is about the day, a plan
 * or nothing in particular gets everything, exactly as before 28.9.
 *
 * Grady can always look up the rest with his tools; the shortened situation
 * says what it left out, so he never reads a missing line as "nothing".
 */

export const CHAT_TOPICS = [
  "milestones",
  "tasks",
  "pipeline",
  "contacts",
  "calendar",
  "calling",
  "finance",
  "invoices",
  "scheduler",
  "rewards",
  "plans",
] as const;
export type ChatTopic = (typeof CHAT_TOPICS)[number];

/** The parts of describeSituation() beyond the always-listed today and time window. */
export const SITUATION_SECTIONS = [
  "milestones",
  "tasks",
  "pipeline",
  "followUps",
  "calendar",
  "calling",
  "invoices",
  "crmTasks",
  "finance",
  "scheduler",
  "rewards",
] as const;
export type SituationSection = (typeof SITUATION_SECTIONS)[number];

/** Everything: the situation as it was before 28.9. */
export const ALL_TOPICS = "all" as const;
export type ChatTopics = ReadonlySet<ChatTopic> | typeof ALL_TOPICS;

/** Lower case without diacritics, so "Fakturu" and "faktura" match the same stem. */
function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

/**
 * Word stems of each topic in Czech and English, matched at the start of a
 * word. Short and on purpose broad: a word too many costs a few hundred
 * tokens, a word too few only means Grady looks the thing up with a tool.
 */
const TOPIC_WORDS: Record<ChatTopic, readonly string[]> = {
  milestones: ["milnik", "milestone", "cest", "path", "cil", "goal"],
  tasks: ["ukol", "podukol", "task", "todo", "termin", "deadline", "po terminu", "overdue"],
  pipeline: [
    "obchod",
    "deal",
    "pipeline",
    "faze",
    "stage",
    "nabid",
    "offer",
    "close date",
    "vyhr",
    "prohr",
    "won",
    "lost",
    "lead",
    "hori",
  ],
  contacts: ["kontakt", "contact", "klient", "client", "zakazn", "customer", "firm", "company"],
  calendar: ["kalendar", "calendar", "udalost", "event", "schuzk", "meeting", "zitra", "tomorrow"],
  calling: ["volat", "volan", "zavolat", "zavolej", "call", "telefon", "phone", "cold", "ozvat"],
  finance: [
    "financ",
    "penez",
    "penize",
    "money",
    "prijm",
    "income",
    "vydaj",
    "expense",
    "kapital",
    "capital",
    "rezerv",
    "cash",
    "rozpocet",
    "budget",
    "transakc",
    "transaction",
    "platb",
    "payment",
  ],
  invoices: ["faktur", "invoice", "splatnost", "dobropis", "zaplat", "paid", "unpaid"],
  scheduler: ["rezervac", "booking", "planovac", "scheduler", "odkaz na schuzk", "booking link"],
  rewards: ["odmen", "reward", "provize", "commission", "vyplat", "payout", "pracovnik", "worker"],
  plans: [
    "tarif",
    "plan solo",
    "plan pro",
    "plan team",
    "predplat",
    "subscription",
    "cenik",
    "pricing",
    "kolik stoji",
    "how much",
    "price",
    "cena",
    "zkusebn",
    "trial",
    "limit",
    "upgrade",
    "downgrade",
    "zrusit predplatne",
    "cancel",
  ],
};

/**
 * Asking about the day, a plan or advice in general wants the whole picture:
 * these words keep everything in the context.
 */
const WHOLE_PICTURE = [
  "dnes",
  "dneska",
  "today",
  "naplan",
  "plan dne",
  "plan na",
  "co mam",
  "co bych",
  "co delat",
  "what should",
  "what to do",
  "priorit",
  "prehled",
  "overview",
  "shrn",
  "summar",
  "situac",
  "jak jsem na tom",
  "how am i",
  "how are things",
  "tyden",
  "week",
  "mesic",
  "month",
  "poradit",
  "poraď",
  "rad",
  "advice",
  "strategi",
  "dalsi krok",
  "next step",
];

function hasWord(text: string, stem: string): boolean {
  let from = 0;
  for (;;) {
    const at = text.indexOf(stem, from);
    if (at < 0) return false;
    const before = at === 0 ? " " : text[at - 1];
    if (!/[\p{L}\p{N}]/u.test(before)) return true;
    from = at + 1;
  }
}

/** The topics of the latest message (with the two user messages before it), or everything. */
export function chatTopics(messages: readonly string[]): ChatTopics {
  const texts = messages.map(normalize).filter((text) => text.trim());
  if (!texts.length) return ALL_TOPICS;
  const latest = texts[0];
  if (WHOLE_PICTURE.some((stem) => hasWord(latest, normalize(stem)))) return ALL_TOPICS;
  const topics = new Set<ChatTopic>();
  for (const text of texts) {
    for (const topic of CHAT_TOPICS) {
      if (TOPIC_WORDS[topic].some((stem) => hasWord(text, stem))) topics.add(topic);
    }
  }
  // Nothing recognised (a greeting, a question about the app, small talk): everything, as before.
  return topics.size ? topics : ALL_TOPICS;
}

const SECTIONS_OF: Record<ChatTopic, readonly SituationSection[]> = {
  milestones: ["milestones", "tasks"],
  tasks: ["tasks", "crmTasks", "milestones"],
  pipeline: ["pipeline", "crmTasks", "followUps"],
  contacts: ["followUps", "pipeline", "crmTasks"],
  calendar: ["calendar", "crmTasks", "scheduler"],
  calling: ["followUps", "calling", "calendar"],
  finance: ["finance", "invoices"],
  invoices: ["invoices", "finance"],
  scheduler: ["scheduler", "calendar"],
  rewards: ["rewards"],
  plans: [],
};

/** The parts of the situation a message needs; null = all of them. */
export function situationSections(topics: ChatTopics): ReadonlySet<SituationSection> | null {
  if (topics === ALL_TOPICS) return null;
  const sections = new Set<SituationSection>();
  for (const topic of topics) for (const section of SECTIONS_OF[topic]) sections.add(section);
  return sections;
}

/** The parts left out, for the line that tells Grady what he does not see. */
export function leftOutSections(sections: ReadonlySet<SituationSection> | null): SituationSection[] {
  if (!sections) return [];
  return SITUATION_SECTIONS.filter((section) => !sections.has(section));
}

/**
 * Whether the plan catalog goes into <plans>: the talk is about plans, or
 * a failed payment that Grady should mention once is in the user's line.
 */
export function plansCatalogNeeded(topics: ChatTopics, ownPlanLine: string | null): boolean {
  if (topics === ALL_TOPICS || topics.has("plans")) return true;
  return !!ownPlanLine && /past.due|failed payment/i.test(ownPlanLine);
}
