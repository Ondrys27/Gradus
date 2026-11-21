import type { Locale } from "@/i18n/locales";

/**
 * What the showcase's stage holds (step 27.4), in the scenario's language:
 * a Czech interior design studio in Brno with Czech clients and crowns, or
 * a British one in Manchester with British clients and pounds. Every name is
 * invented. Phone numbers only where a range is kept for fiction (Ofcom's
 * drama numbers in the UK); the Czech plan has none, so Czech contacts have
 * no phone (as the tutorial's sample data).
 *
 * The same values are what the scenarios type and look for (`{key}` in
 * demo-scripts.ts), and the prepared answers Grady gives instead of a model.
 */

export type StageContact = {
  company: string;
  first: string;
  last: string;
  city: string;
  email: string;
  phone?: string;
  /** The contact table it sits in (system key); unreached when missing. */
  table?: "follow_up" | "meeting_scheduled" | "email_sent";
};

export type StageDeal = {
  title: string;
  /** Index into `contacts`. */
  contact: number;
  stage: "lead" | "meeting" | "offer_draft" | "offer" | "won" | "lost";
  value: number;
  /** Days from today; negative = past. */
  closeIn?: number;
};

export type StagePlace = { name: string; address: string; phone?: string; website?: string };

export type StageData = {
  currency: string;
  country: string;
  timeZone: string;
  /** How numbers and dates read there (user_settings, independent of the language). */
  formats: { number: "cs" | "en"; date: "d. M. yyyy" | "dd/MM/yyyy" };
  owner: { first: string; last: string; company: string; city: string };
  milestones: {
    title: string;
    description: string;
    done?: boolean;
    tasks: { title: string; done?: boolean; children?: { title: string; done?: boolean }[] }[];
  }[];
  contacts: StageContact[];
  deals: StageDeal[];
  notes: { title: string; blocks: { heading?: string; text: string }[]; pinned?: boolean }[];
  meetings: { title: string; contact: number; dayOffset: number; time: string }[];
  crmTasks: { title: string; contact?: number; deal?: number; dayOffset: number; time: string }[];
  transactions: { label: string; kind: "income" | "expense"; amount: number; dayOffset: number }[];
  /** The plan of the current month, per week (finance plan). */
  plan: {
    opening: number;
    reserve: number;
    income: { label: string; weeks: number[] }[];
    expense: { label: string; weeks: number[] }[];
  };
  invoice: {
    name: string;
    regNo: string | null;
    vatNo: string | null;
    street: string;
    city: string;
    postalCode: string;
    email: string;
    accountNumber: string | null;
    bankCode: string | null;
    iban: string | null;
    bic: string | null;
    prefix: string;
  };
  scheduler: { handle: string; headline: string; typeTitle: string; typeSlug: string; minutes: number };
  worker: { first: string; last: string; jobTitle: string; email: string };
  /** What Generate contacts "finds" (instead of Google). */
  places: StagePlace[];
  /** The values the scenarios type and look for. */
  values: Record<ShowcaseValueKey, string>;
  /** Grady's prepared answers: the first whose `match` is in the message wins, else `fallback`. */
  answers: { match: string; text: string }[];
  fallbackAnswer: string;
  /** The morning summary of scenario b. */
  summary: string;
};

export const SHOWCASE_VALUE_KEYS = [
  "milestone",
  "newTask",
  "industry",
  "location",
  "callContact",
  "dealTitle",
  "winDeal",
  "chatPrompt",
  "note",
  "eventType",
  "guestName",
  "guestEmail",
  "newWorker",
  "workerEmail",
  "worker",
  "taskTarget",
  "workerTask",
  "chatMessage",
  "invoiceDeal",
  "planRow",
  "planWeek",
  "planCell",
] as const;
export type ShowcaseValueKey = (typeof SHOWCASE_VALUE_KEYS)[number];

const CS: StageData = {
  currency: "CZK",
  country: "CZ",
  timeZone: "Europe/Prague",
  formats: { number: "cs", date: "d. M. yyyy" },
  owner: { first: "Petra", last: "Dvořáková", company: "Dvořák Interiéry", city: "Brno" },
  milestones: [
    {
      title: "Založit firmu",
      description: "Živnost, účet a první vizitky.",
      done: true,
      tasks: [
        { title: "Ohlásit živnost", done: true },
        { title: "Založit firemní účet", done: true },
        { title: "Nechat vytisknout vizitky", done: true },
      ],
    },
    {
      title: "Získat prvních 5 klientů",
      description: "Od seznamu firem k podepsaným zakázkám.",
      tasks: [
        {
          title: "Připravit nabídku",
          done: true,
          children: [
            { title: "Ceník služeb", done: true },
            { title: "Tři reference s fotkami", done: true },
          ],
        },
        { title: "Sestavit seznam firem v Brně", done: true },
        {
          title: "Zavolat 20 firmám",
          children: [{ title: "Kavárny a bistra" }, { title: "Hotely a penziony" }],
        },
        { title: "Domluvit 3 schůzky" },
        { title: "Poslat nabídky do 48 hodin" },
      ],
    },
    {
      title: "Spustit web s portfoliem",
      description: "Galerie hotových interiérů a formulář poptávky.",
      tasks: [
        { title: "Nafotit hotové zakázky", done: true },
        { title: "Napsat texty o službách" },
        { title: "Spustit poptávkový formulář" },
      ],
    },
  ],
  contacts: [
    { company: "Hotel Slunce", first: "Martin", last: "Kovář", city: "Brno", email: "martin.kovar@example.com", table: "meeting_scheduled" },
    { company: "Bistro Na Nábřeží", first: "Lucie", last: "Horáková", city: "Brno", email: "lucie@example.com", table: "follow_up" },
    { company: "Advokátní kancelář Beneš", first: "Tomáš", last: "Beneš", city: "Brno", email: "benes@example.com", table: "email_sent" },
    { company: "Pekárna U Mlýna", first: "Jana", last: "Malá", city: "Brno", email: "jana.mala@example.com" },
    { company: "Fitness Pevnost", first: "David", last: "Novák", city: "Brno", email: "david@example.com" },
    { company: "Zubní klinika Úsměv", first: "Eva", last: "Svobodová", city: "Brno", email: "eva@example.com", table: "follow_up" },
    { company: "Kavárna Modrý kocour", first: "Kateřina", last: "Veselá", city: "Brno", email: "katerina@example.com" },
  ],
  deals: [
    { title: "Rekonstrukce recepce", contact: 0, stage: "offer", value: 185_000, closeIn: 6 },
    { title: "Nový interiér bistra", contact: 1, stage: "meeting", value: 96_000, closeIn: 14 },
    { title: "Zasedací místnost", contact: 2, stage: "offer_draft", value: 64_000, closeIn: 21 },
    { title: "Prodejna s výlohou", contact: 3, stage: "lead", value: 48_000 },
    { title: "Čekárna kliniky", contact: 5, stage: "won", value: 72_000 },
    { title: "Šatny a recepce", contact: 4, stage: "lost", value: 55_000 },
  ],
  notes: [
    {
      title: "Ideální zákazník",
      pinned: true,
      blocks: [
        { heading: "Kdo to je", text: "Majitel kavárny, bistra nebo malého hotelu v Brně, 5–30 zaměstnanců." },
        { heading: "Co ho trápí", text: "Prostor vypadá unaveně, hosté nechodí znovu a na velkou rekonstrukci nemá čas." },
        { heading: "Kde ho najdu", text: "Místní podnikatelské snídaně, Instagram, doporučení od dodavatelů nábytku." },
        { heading: "Námitky", text: "„Je to drahé.“ Odpověď: rekonstrukce po etapách, první návrh do týdne." },
      ],
    },
    {
      title: "Prodejní skript",
      blocks: [
        { text: "Dobrý den, tady Petra Dvořáková z Dvořák Interiéry." },
        { text: "Pomáhám kavárnám a hotelům v Brně, aby se k nim hosté vraceli." },
        { text: "Můžu vám ukázat tři proměny z poslední doby?" },
      ],
    },
  ],
  meetings: [
    { title: "Schůzka – Hotel Slunce", contact: 0, dayOffset: 1, time: "10:00" },
    { title: "Prohlídka bistra", contact: 1, dayOffset: 2, time: "14:00" },
    { title: "Výběr materiálů s klinikou", contact: 5, dayOffset: 3, time: "09:30" },
  ],
  crmTasks: [
    { title: "Poslat návrh recepce", deal: 0, dayOffset: 0, time: "15:00" },
    { title: "Zavolat Lucii kvůli termínu", contact: 1, dayOffset: 1, time: "09:00" },
  ],
  transactions: [
    { label: "Záloha – čekárna kliniky", kind: "income", amount: 36_000, dayOffset: -6 },
    { label: "Vzorky látek", kind: "expense", amount: 4_200, dayOffset: -4 },
    { label: "Pronájem ateliéru", kind: "expense", amount: 12_000, dayOffset: -2 },
  ],
  plan: {
    opening: 140_000,
    reserve: 50_000,
    income: [
      { label: "Čekárna kliniky", weeks: [36_000, 0, 36_000, 0] },
      { label: "Rekonstrukce recepce", weeks: [0, 0, 0, 92_000] },
    ],
    expense: [
      { label: "Pronájem ateliéru", weeks: [12_000, 0, 0, 0] },
      { label: "Materiál", weeks: [8_000, 15_000, 6_000, 4_000] },
      { label: "Marketing", weeks: [3_000, 3_000, 3_000, 3_000] },
    ],
  },
  invoice: {
    name: "Petra Dvořáková – Dvořák Interiéry",
    regNo: null,
    vatNo: null,
    street: "Veveří 102",
    city: "Brno",
    postalCode: "602 00",
    email: "petra@example.com",
    accountNumber: "2601234565",
    bankCode: "0000",
    iban: null,
    bic: null,
    prefix: "",
  },
  scheduler: {
    handle: "petra-dvorakova",
    headline: "Interiéry pro kavárny a hotely",
    typeTitle: "Úvodní konzultace",
    typeSlug: "konzultace",
    minutes: 30,
  },
  worker: { first: "Tomáš", last: "Král", jobTitle: "Obchodník", email: "tomas.kral@example.com" },
  places: [
    { name: "Kavárna Pod Lípou", address: "Kounicova 12, 602 00 Brno" },
    { name: "Café Bloom", address: "Jakubské nám. 4, 602 00 Brno" },
    { name: "Kafe Ořech", address: "Údolní 33, 602 00 Brno" },
    { name: "Kavárna Zrnko", address: "Pekařská 18, 602 00 Brno" },
    { name: "Café Kampus", address: "Kotlářská 9, 611 37 Brno" },
    { name: "Kavárna Vltava", address: "Masarykova 21, 602 00 Brno" },
    { name: "Espresso Bar Malinovák", address: "Malinovského nám. 2, 602 00 Brno" },
    { name: "Kavárna U Tří lvů", address: "Zelný trh 7, 602 00 Brno" },
    { name: "Café Lužánky", address: "Lidická 50, 602 00 Brno" },
    { name: "Kavárna Moravka", address: "Křenová 58, 602 00 Brno" },
    { name: "Coffee Point Brno", address: "Cejl 14, 602 00 Brno" },
    { name: "Kavárna Na Kopečku", address: "Žabovřeská 3, 616 00 Brno" },
  ],
  values: {
    milestone: "Získat prvních 5 klientů",
    newTask: "Oslovit 10 kaváren v centru",
    industry: "kavárny",
    location: "Brno",
    callContact: "Kavárna Pod Lípou",
    dealTitle: "Kavárna Pod Lípou",
    winDeal: "Rekonstrukce recepce",
    chatPrompt: "Jak mám oslovit ideálního zákazníka?",
    note: "Ideální zákazník",
    eventType: "Úvodní konzultace",
    guestName: "Jana Nováková",
    guestEmail: "jana.novakova@example.com",
    newWorker: "Ondřej Sýkora",
    workerEmail: "ondrej.sykora@example.com",
    worker: "Tomáš Král",
    taskTarget: "Pekárna U Mlýna",
    workerTask: "Zavolat 10 kavárnám z nového seznamu",
    chatMessage: "Tomáši, máš nový seznam kaváren, dej jim zítra zavolat.",
    invoiceDeal: "Čekárna kliniky",
    planRow: "Marketing",
    planWeek: "Týden 4",
    planCell: "8000",
  },
  answers: [
    {
      match: "zákazník",
      text: "Podle tvé poznámky „Ideální zákazník“ cílíš na majitele kaváren a malých hotelů v Brně, kterým prostor vypadá unaveně.\n\n1. Začni Instagramem: pošli jim fotku proměny podobného podniku.\n2. Zavolej do dvou dnů a nabídni prohlídku zdarma.\n3. Na námitku „je to drahé“ odpověz etapami a prvním návrhem do týdne.\n\nChceš, abych ti z toho připravil úkoly?",
    },
  ],
  fallbackAnswer:
    "Dnes bych začal kavárnou Pod Lípou: máš ji v Domluvené schůzce a nabídka pro Hotel Slunce čeká na odeslání.",
  summary:
    "Dobré ráno, Petro! Dnes tě čeká schůzka s Hotelem Slunce v 10:00 a návrh recepce máš poslat do 15:00. Včera jsi domluvila 2 schůzky a vyhrála zakázku za 72 000 Kč. Pipeline je zdravá: nic nehoří.",
};

const EN: StageData = {
  currency: "GBP",
  country: "GB",
  timeZone: "Europe/London",
  formats: { number: "en", date: "dd/MM/yyyy" },
  owner: { first: "Emma", last: "Walsh", company: "Walsh Interiors", city: "Manchester" },
  milestones: [
    {
      title: "Set up the business",
      description: "Registration, bank account and the first business cards.",
      done: true,
      tasks: [
        { title: "Register as self-employed", done: true },
        { title: "Open a business account", done: true },
        { title: "Print business cards", done: true },
      ],
    },
    {
      title: "Win the first 5 clients",
      description: "From a list of businesses to signed projects.",
      tasks: [
        {
          title: "Prepare the offer",
          done: true,
          children: [
            { title: "Price list", done: true },
            { title: "Three case studies with photos", done: true },
          ],
        },
        { title: "Build a list of local businesses", done: true },
        {
          title: "Call 20 businesses",
          children: [{ title: "Cafés and bistros" }, { title: "Hotels and B&Bs" }],
        },
        { title: "Book 3 meetings" },
        { title: "Send offers within 48 hours" },
      ],
    },
    {
      title: "Launch the portfolio website",
      description: "A gallery of finished interiors and an enquiry form.",
      tasks: [
        { title: "Photograph finished projects", done: true },
        { title: "Write the service pages" },
        { title: "Launch the enquiry form" },
      ],
    },
  ],
  contacts: [
    { company: "The Sunrise Hotel", first: "James", last: "Carter", city: "Manchester", email: "james.carter@example.com", phone: "+447700900101", table: "meeting_scheduled" },
    { company: "Riverside Bistro", first: "Sophie", last: "Hughes", city: "Manchester", email: "sophie@example.com", phone: "+447700900102", table: "follow_up" },
    { company: "Bennett & Co Solicitors", first: "Oliver", last: "Bennett", city: "Manchester", email: "oliver@example.com", phone: "+447700900103", table: "email_sent" },
    { company: "Mill Lane Bakery", first: "Grace", last: "Turner", city: "Manchester", email: "grace@example.com", phone: "+447700900104" },
    { company: "Fortress Fitness", first: "Daniel", last: "Price", city: "Manchester", email: "daniel@example.com", phone: "+447700900105" },
    { company: "Smile Dental Clinic", first: "Amelia", last: "Ward", city: "Manchester", email: "amelia@example.com", phone: "+447700900106", table: "follow_up" },
    { company: "Blue Cat Coffee", first: "Chloe", last: "Morgan", city: "Manchester", email: "chloe@example.com", phone: "+447700900107" },
  ],
  deals: [
    { title: "Reception makeover", contact: 0, stage: "offer", value: 7_400, closeIn: 6 },
    { title: "New bistro interior", contact: 1, stage: "meeting", value: 3_900, closeIn: 14 },
    { title: "Meeting room", contact: 2, stage: "offer_draft", value: 2_600, closeIn: 21 },
    { title: "Shop front and counter", contact: 3, stage: "lead", value: 1_900 },
    { title: "Clinic waiting room", contact: 5, stage: "won", value: 2_900 },
    { title: "Changing rooms", contact: 4, stage: "lost", value: 2_200 },
  ],
  notes: [
    {
      title: "Ideal customer",
      pinned: true,
      blocks: [
        { heading: "Who they are", text: "Owners of cafés, bistros and small hotels in Manchester, 5–30 staff." },
        { heading: "What bothers them", text: "The place looks tired, guests don't come back, and there's no time for a big refit." },
        { heading: "Where I find them", text: "Local business breakfasts, Instagram, referrals from furniture suppliers." },
        { heading: "Objections", text: "“It's expensive.” Answer: a refit in stages, the first design within a week." },
      ],
    },
    {
      title: "Sales script",
      blocks: [
        { text: "Hi, this is Emma Walsh from Walsh Interiors." },
        { text: "I help cafés and hotels in Manchester make guests want to come back." },
        { text: "Could I show you three recent makeovers?" },
      ],
    },
  ],
  meetings: [
    { title: "Meeting – The Sunrise Hotel", contact: 0, dayOffset: 1, time: "10:00" },
    { title: "Bistro walk-through", contact: 1, dayOffset: 2, time: "14:00" },
    { title: "Materials with the clinic", contact: 5, dayOffset: 3, time: "09:30" },
  ],
  crmTasks: [
    { title: "Send the reception design", deal: 0, dayOffset: 0, time: "15:00" },
    { title: "Call Sophie about the date", contact: 1, dayOffset: 1, time: "09:00" },
  ],
  transactions: [
    { label: "Deposit – clinic waiting room", kind: "income", amount: 1_450, dayOffset: -6 },
    { label: "Fabric samples", kind: "expense", amount: 170, dayOffset: -4 },
    { label: "Studio rent", kind: "expense", amount: 480, dayOffset: -2 },
  ],
  plan: {
    opening: 5_600,
    reserve: 2_000,
    income: [
      { label: "Clinic waiting room", weeks: [1_450, 0, 1_450, 0] },
      { label: "Reception makeover", weeks: [0, 0, 0, 3_700] },
    ],
    expense: [
      { label: "Studio rent", weeks: [480, 0, 0, 0] },
      { label: "Materials", weeks: [320, 600, 240, 160] },
      { label: "Marketing", weeks: [120, 120, 120, 120] },
    ],
  },
  invoice: {
    name: "Emma Walsh – Walsh Interiors",
    regNo: null,
    vatNo: null,
    street: "12 King Street",
    city: "Manchester",
    postalCode: "M2 4LQ",
    email: "emma@example.com",
    accountNumber: null,
    bankCode: null,
    iban: "GB33BUKB20201555555555",
    bic: "BUKBGB22",
    prefix: "",
  },
  scheduler: {
    handle: "emma-walsh",
    headline: "Interiors for cafés and hotels",
    typeTitle: "Intro consultation",
    typeSlug: "consultation",
    minutes: 30,
  },
  worker: { first: "Tom", last: "King", jobTitle: "Sales", email: "tom.king@example.com" },
  places: [
    { name: "Linden Tree Café", address: "12 Oldham St, Manchester M1 1JN", phone: "+447700900201" },
    { name: "Café Bloom", address: "4 Stevenson Sq, Manchester M1 1DN", phone: "+447700900202" },
    { name: "The Walnut Coffee House", address: "33 Tib St, Manchester M4 1LX", phone: "+447700900203" },
    { name: "Little Bean", address: "18 Dale St, Manchester M1 1JW", phone: "+447700900204" },
    { name: "Campus Coffee", address: "9 Oxford Rd, Manchester M1 7ED", phone: "+447700900205" },
    { name: "Northern Brew", address: "21 Thomas St, Manchester M4 1NA", phone: "+447700900206" },
    { name: "Espresso Corner", address: "2 Piccadilly, Manchester M1 3BN", phone: "+447700900207" },
    { name: "Three Lions Café", address: "7 Deansgate, Manchester M3 2BW", phone: "+447700900208" },
    { name: "Park View Coffee", address: "50 Wilmslow Rd, Manchester M14 5TQ", phone: "+447700900209" },
    { name: "Canal Side Café", address: "58 Canal St, Manchester M1 3WD", phone: "+447700900210" },
    { name: "Coffee Point", address: "14 Church St, Manchester M4 1PN", phone: "+447700900211" },
    { name: "Hilltop Café", address: "3 Chorlton Rd, Manchester M16 7BP", phone: "+447700900212" },
  ],
  values: {
    milestone: "Win the first 5 clients",
    newTask: "Contact 10 cafés in the centre",
    industry: "cafés",
    location: "Manchester",
    callContact: "Linden Tree Café",
    dealTitle: "Linden Tree Café",
    winDeal: "Reception makeover",
    chatPrompt: "How should I approach my ideal customer?",
    note: "Ideal customer",
    eventType: "Intro consultation",
    guestName: "Lucy Adams",
    guestEmail: "lucy.adams@example.com",
    newWorker: "Ben Foster",
    workerEmail: "ben.foster@example.com",
    worker: "Tom King",
    taskTarget: "Mill Lane Bakery",
    workerTask: "Call 10 cafés from the new list",
    chatMessage: "Tom, there's a new list of cafés, please call them tomorrow.",
    invoiceDeal: "Clinic waiting room",
    planRow: "Marketing",
    planWeek: "Week 4",
    planCell: "300",
  },
  answers: [
    {
      match: "customer",
      text: "Going by your note “Ideal customer”, you're after owners of cafés and small hotels in Manchester whose place looks tired.\n\n1. Start on Instagram: send them a before-and-after of a similar place.\n2. Call within two days and offer a free walk-through.\n3. When they say “it's expensive”, offer stages and a first design within a week.\n\nShall I turn this into tasks for you?",
    },
  ],
  fallbackAnswer:
    "I'd start with Linden Tree Café today: it's in Meeting booked, and the offer for The Sunrise Hotel is waiting to be sent.",
  summary:
    "Good morning, Emma! Today you meet The Sunrise Hotel at 10:00 and the reception design is due by 15:00. Yesterday you booked 2 meetings and won a £2,900 project. The pipeline is healthy: nothing is on fire.",
};

export const STAGE_DATA: Record<Locale, StageData> = { cs: CS, en: EN };

export function stageData(locale: Locale): StageData {
  return STAGE_DATA[locale];
}

/** A scenario's `{key}` placeholders filled with the stage's values in its language. */
export function fillValues(text: string, locale: Locale): string {
  const values = STAGE_DATA[locale].values;
  return text.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? values[key as ShowcaseValueKey] : match,
  );
}

/** Grady's prepared answer to a message (no model in the showcase). */
export function preparedAnswer(message: string, locale: Locale): string {
  const data = STAGE_DATA[locale];
  const lower = message.toLowerCase();
  return data.answers.find((answer) => lower.includes(answer.match))?.text ?? data.fallbackAnswer;
}

/** The stage's scheduler handle: the name and a piece of the account id (handles are unique everywhere). */
export function stageHandle(locale: Locale, userId: string): string {
  return `${STAGE_DATA[locale].scheduler.handle}-${userId.slice(0, 6).toLowerCase()}`;
}

/** The public page of the stage's meeting type, which the guest's window shows (scenario c). */
export function stageBookingPath(locale: Locale, userId: string): string {
  return `/s/${stageHandle(locale, userId)}/${STAGE_DATA[locale].scheduler.typeSlug}`;
}
