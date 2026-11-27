import { describe, expect, it } from "vitest";
import { anonymousQuestion, isHowQuestion, normalizeQuestion, questionWords } from "./question";
import {
  FIRST_VISIT_IDLE_MS,
  offerAllowed,
  RETURN_WINDOW_MS,
  struggleOf,
  trimEvents,
  type StruggleEvent,
} from "./struggle";

const T0 = 1_000_000;
const ask = (events: StruggleEvent[], extra: Partial<Parameters<typeof struggleOf>[0]> = {}) =>
  struggleOf({ events, now: T0 + 60_000, firstVisit: false, enteredAt: T0, ...extra });
const openClose = (id: string, at: number): StruggleEvent[] => [
  { type: "dialogOpen", id, at },
  { type: "dialogClose", id, at: at + 1000 },
];

describe("when someone seems lost", () => {
  it("the same dialog opened and closed three times without saving", () => {
    const events = [...openClose("Nový obchod", T0), ...openClose("Nový obchod", T0 + 5000)];
    expect(ask(events)).toBeNull();
    expect(ask([...events, ...openClose("Nový obchod", T0 + 9000)])).toBe("dialog");
    // Different dialogs are not the same doubt.
    expect(ask([...events, ...openClose("Nový kontakt", T0 + 9000)])).toBeNull();
  });

  it("a save in between wipes the slate", () => {
    const events: StruggleEvent[] = [
      ...openClose("Nový obchod", T0),
      ...openClose("Nový obchod", T0 + 5000),
      { type: "saved", at: T0 + 7000 },
      ...openClose("Nový obchod", T0 + 9000),
    ];
    expect(ask(events)).toBeNull();
  });

  it("three refused fields in a row", () => {
    const invalid = (at: number): StruggleEvent => ({ type: "invalid", at });
    expect(ask([invalid(T0), invalid(T0 + 1)])).toBeNull();
    expect(ask([invalid(T0), invalid(T0 + 1), invalid(T0 + 2)])).toBe("invalid");
  });

  it("coming back to the same page again and again within a while", () => {
    const visit = (at: number, path = "/app/pipeline"): StruggleEvent => ({ type: "visit", path, at });
    expect(ask([visit(T0), visit(T0 + 10_000), visit(T0 + 20_000)])).toBe("returns");
    expect(ask([visit(T0), visit(T0 + 10_000, "/app/kontakty"), visit(T0 + 20_000)])).toBeNull();
    // Long ago does not count.
    expect(
      ask([visit(T0), visit(T0 + 1000), visit(T0 + 2000)], { now: T0 + RETURN_WINDOW_MS + 5000 }),
    ).toBeNull();
  });

  it("two minutes of nothing on the first visit only", () => {
    const now = T0 + FIRST_VISIT_IDLE_MS;
    expect(ask([], { firstVisit: true, now })).toBe("idle");
    expect(ask([], { firstVisit: true, now: now - 1 })).toBeNull();
    expect(ask([], { firstVisit: false, now })).toBeNull();
    expect(ask([{ type: "saved", at: T0 + 1000 }], { firstVisit: true, now })).toBeNull();
  });

  it("keeps only recent signs", () => {
    const old: StruggleEvent = { type: "invalid", at: T0 };
    const fresh: StruggleEvent = { type: "invalid", at: T0 + 3 * RETURN_WINDOW_MS };
    expect(trimEvents([old, fresh], T0 + 3 * RETURN_WINDOW_MS)).toEqual([fresh]);
    expect(trimEvents(Array.from({ length: 100 }, () => fresh), T0 + 3 * RETURN_WINDOW_MS)).toHaveLength(60);
  });
});

describe("whether the offer may show", () => {
  const base = {
    proactive: true,
    offersOff: false,
    lastOfferDay: null,
    today: "2026-11-27",
    hour: 11,
    quietFrom: 21,
    quietTo: 7,
    busy: false,
  };
  it("once per section and day", () => {
    expect(offerAllowed(base)).toBe(true);
    expect(offerAllowed({ ...base, lastOfferDay: "2026-11-27" })).toBe(false);
    expect(offerAllowed({ ...base, lastOfferDay: "2026-11-26" })).toBe(true);
  });
  it("never with Grady's own messages off, after don't offer again, in quiet hours or over something", () => {
    expect(offerAllowed({ ...base, proactive: false })).toBe(false);
    expect(offerAllowed({ ...base, offersOff: true })).toBe(false);
    expect(offerAllowed({ ...base, hour: 22 })).toBe(false);
    expect(offerAllowed({ ...base, hour: 6 })).toBe(false);
    expect(offerAllowed({ ...base, busy: true })).toBe(false);
    expect(offerAllowed({ ...base, quietFrom: null, quietTo: null, hour: 23 })).toBe(true);
  });
});

describe("the words of a question", () => {
  it("normalises for the cache", () => {
    expect(normalizeQuestion("  Jak PŘIDÁM úkol?! ")).toBe("jak pridam ukol");
    expect(normalizeQuestion("jak pridam ukol")).toBe(normalizeQuestion("Jak přidám úkol?"));
  });
  it("knows a how-to question in both languages", () => {
    expect(isHowQuestion("Jak dám pracovníkovi odměnu?")).toBe(true);
    expect(isHowQuestion("kde najdu faktury")).toBe(true);
    expect(isHowQuestion("How do I add a deal?")).toBe(true);
    expect(isHowQuestion("Where is the invoice?")).toBe(true);
    expect(isHowQuestion("Novák")).toBe(false);
    expect(isHowQuestion("jak")).toBe(false);
    expect(isHowQuestion("Jakub Novák")).toBe(false);
  });
  it("drops common words and stems the rest", () => {
    expect(questionWords("Jak přidám nový úkol k obchodu?")).toEqual(["prida", "novy", "ukol", "obcho"]);
    expect(questionWords("How do I add tasks?")).toEqual(["add", "task"]);
  });
  it("keeps no contact data or numbers for the administration", () => {
    expect(anonymousQuestion("Jak pošlu fakturu na jan@firma.cz za 12 500 Kč?")).toBe("Jak pošlu fakturu na … za … Kč?");
    expect(anonymousQuestion("Volal jsem +420 777 123 456, kde to vidím")).toBe("Volal jsem …, kde to vidím");
    expect(anonymousQuestion("Viz https://example.com/x prosím")).toBe("Viz … prosím");
  });
});
