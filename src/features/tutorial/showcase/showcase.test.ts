import { describe, expect, it } from "vitest";
import { isValidCzAccount, isValidIban } from "@/features/invoices/iban";
import { showcaseRole, stagePresenter } from "./access";
import {
  aimAt,
  curveBetween,
  cursorAt,
  easeInOut,
  MOVE_MAX_MS,
  MOVE_MIN_MS,
  moveDuration,
  seededRandom,
  TYPE_MAX_MS,
  TYPE_MIN_MS,
  typingDelays,
} from "./motion";
import {
  parseShowcaseParams,
  recordingName,
  scenariosOf,
  showcaseHref,
  sizeOf,
  SHOWCASE_PATH,
} from "./params";
import { fillValues, preparedAnswer, SHOWCASE_VALUE_KEYS, STAGE_DATA, stageBookingPath } from "./stage-data";

const search = (query: string) => new URLSearchParams(query);

describe("showcase address", () => {
  it("reads scenario, language and canvas, falling back to the defaults", () => {
    expect(parseShowcaseParams(search("scenar=a&jazyk=en&velikost=1080x1920"))).toEqual({
      scenario: "a",
      locale: "en",
      size: "1080x1920",
    });
    expect(parseShowcaseParams(search("scenar=vse"))).toMatchObject({ scenario: "all" });
    expect(parseShowcaseParams(search("scenar=z&jazyk=de&velikost=800x600"))).toEqual({
      scenario: "f",
      locale: "cs",
      size: "1920x1080",
    });
  });

  it("writes it back and names the recording", () => {
    const params = { scenario: "all", locale: "en", size: "1080x1080" } as const;
    expect(showcaseHref(params)).toBe(`${SHOWCASE_PATH}?scenar=vse&jazyk=en&velikost=1080x1080`);
    expect(parseShowcaseParams(new URL(showcaseHref(params), "http://x").searchParams)).toEqual(params);
    expect(recordingName({ scenario: "f", locale: "cs", size: "1920x1080" })).toBe("f-cs-1920x1080");
    expect(sizeOf("1080x1920")).toEqual({ width: 1080, height: 1920 });
    expect(scenariosOf("all")).toEqual(["a", "b", "c", "d", "e", "f"]);
    expect(scenariosOf("c")).toEqual(["c"]);
  });
});

describe("who may play it", () => {
  const base = { email: "owner@firma.cz", appMetadata: {}, switchOn: true, production: true };

  it("the app's owner and admins with the switch on; nobody else", () => {
    expect(showcaseRole({ ...base, roles: ["owner"] })).toBe("presenter");
    expect(showcaseRole({ ...base, roles: ["admin"] })).toBe("presenter");
    expect(showcaseRole({ ...base, roles: ["user"] })).toBeNull();
    expect(showcaseRole({ ...base, roles: [] })).toBeNull();
    expect(showcaseRole({ ...base, roles: ["owner"], switchOn: false })).toBeNull();
  });

  it("the tests' own admins outside production without the switch, never in production", () => {
    const test = { ...base, email: "e2e-showcase-1a2b@gradus.local", switchOn: false };
    expect(showcaseRole({ ...test, roles: ["admin"], production: false })).toBe("presenter");
    expect(showcaseRole({ ...test, roles: ["admin"], production: true })).toBeNull();
    expect(showcaseRole({ ...test, roles: [], production: false })).toBeNull();
  });

  it("a stage only with the server's mark and a stage address", () => {
    const meta = { showcase_stage: true, showcase_by: "presenter-id" };
    const stage = { ...base, roles: [], email: "showcase-abc123@gradus.local", appMetadata: meta };
    expect(showcaseRole(stage)).toBe("stage");
    expect(showcaseRole({ ...stage, switchOn: false })).toBeNull();
    expect(showcaseRole({ ...stage, switchOn: false, production: false })).toBe("stage");
    // The mark alone (any address) or the address alone is no stage.
    expect(showcaseRole({ ...stage, email: "someone@firma.cz" })).toBeNull();
    expect(showcaseRole({ ...stage, appMetadata: {} })).toBeNull();
    expect(stagePresenter(meta)).toBe("presenter-id");
    expect(stagePresenter({})).toBeNull();
  });
});

describe("the cursor's motion", () => {
  it("is the same for the same seed and starts and ends where asked", () => {
    const from = { x: 100, y: 800 };
    const to = { x: 1400, y: 220 };
    const curve = curveBetween(from, to, 42);
    expect(curveBetween(from, to, 42)).toEqual(curve);
    expect(cursorAt(curve, 0, 900)).toEqual(from);
    expect(cursorAt(curve, 900, 900)).toEqual(to);
    expect(cursorAt(curve, 2000, 900)).toEqual(to);
    // A gentle bow: never far off the straight line.
    const middle = cursorAt(curve, 450, 900);
    expect(Math.abs(middle.x - (from.x + to.x) / 2)).toBeLessThan(300);
  });

  it("eases in and out and takes longer for a longer way, within bounds", () => {
    expect(easeInOut(0)).toBe(0);
    expect(easeInOut(1)).toBe(1);
    expect(easeInOut(0.5)).toBeCloseTo(0.5);
    expect(easeInOut(0.1)).toBeLessThan(0.1);
    const near = moveDuration({ x: 0, y: 0 }, { x: 10, y: 0 });
    const far = moveDuration({ x: 0, y: 0 }, { x: 1800, y: 900 });
    expect(near).toBe(MOVE_MIN_MS);
    expect(far).toBe(MOVE_MAX_MS);
    expect(moveDuration({ x: 0, y: 0 }, { x: 600, y: 0 })).toBeGreaterThan(near);
  });

  it("types at a human pace: deterministic, slower after a space or a comma", () => {
    const text = "Oslovit 10 kaváren, hned";
    const delays = typingDelays(text, 7);
    expect(delays).toEqual(typingDelays(text, 7));
    expect(delays).toHaveLength([...text].length);
    for (const delay of delays) {
      expect(delay).toBeGreaterThanOrEqual(TYPE_MIN_MS);
      expect(delay).toBeLessThanOrEqual(TYPE_MAX_MS);
    }
    const average = delays.reduce((sum, delay) => sum + delay, 0) / delays.length;
    expect(average).toBeGreaterThan(60);
    expect(average).toBeLessThan(120);
  });

  it("aims a little off the centre, inside the target", () => {
    const box = { left: 100, top: 50, width: 200, height: 40 };
    const point = aimAt(box, 3);
    expect(point.x).toBeGreaterThan(box.left);
    expect(point.x).toBeLessThan(box.left + box.width);
    expect(point.y).toBeGreaterThan(box.top);
    expect(point.y).toBeLessThan(box.top + box.height);
    const random = seededRandom(1);
    expect(random()).toBe(seededRandom(1)());
  });
});

describe("the stage's data", () => {
  it("has the same shape in both languages, each with its own names and money", () => {
    const cs = STAGE_DATA.cs;
    const en = STAGE_DATA.en;
    expect(cs.currency).toBe("CZK");
    expect(en.currency).toBe("GBP");
    expect(cs.contacts).toHaveLength(en.contacts.length);
    expect(cs.deals.map((deal) => deal.stage)).toEqual(en.deals.map((deal) => deal.stage));
    expect(cs.milestones.map((m) => m.tasks.length)).toEqual(en.milestones.map((m) => m.tasks.length));
    expect(cs.places).toHaveLength(en.places.length);
    for (const key of SHOWCASE_VALUE_KEYS) {
      expect(cs.values[key], key).toBeTruthy();
      expect(en.values[key], key).toBeTruthy();
    }
    expect(cs.values.milestone).not.toBe(en.values.milestone);
  });

  it("no made-up Czech phone number; English ones only from Ofcom's drama range", () => {
    const cs = STAGE_DATA.cs;
    expect(cs.contacts.every((contact) => !contact.phone)).toBe(true);
    expect(cs.places.every((place) => !place.phone)).toBe(true);
    const english = [...STAGE_DATA.en.contacts, ...STAGE_DATA.en.places].map((item) => item.phone);
    for (const phone of english) expect(phone).toMatch(/^\+447700900\d{3}$/);
  });

  it("e-mails only at example.com, where no mail can arrive", () => {
    for (const data of Object.values(STAGE_DATA)) {
      const emails = [
        ...data.contacts.map((contact) => contact.email),
        data.invoice.email,
        data.worker.email,
        data.values.guestEmail,
        data.values.workerEmail,
      ];
      for (const email of emails) expect(email).toMatch(/@example\.com$/);
    }
  });

  it("an account the QR code can carry, on a bank code no bank has", () => {
    const invoice = STAGE_DATA.cs.invoice;
    expect(isValidCzAccount(invoice.accountNumber ?? "")).toBe(true);
    expect(invoice.bankCode).toBe("0000");
    expect(isValidIban(STAGE_DATA.en.invoice.iban ?? "")).toBe(true);
  });

  it("fills the scenarios' values and gives Grady's prepared answers", () => {
    expect(fillValues("{milestone} · {unknown}", "cs")).toBe("Získat prvních 5 klientů · {unknown}");
    expect(fillValues("{milestone}", "en")).toBe("Win the first 5 clients");
    expect(preparedAnswer(STAGE_DATA.cs.values.chatPrompt, "cs")).toContain("Ideální zákazník");
    expect(preparedAnswer(STAGE_DATA.en.values.chatPrompt, "en")).toContain("Ideal customer");
    expect(preparedAnswer("cokoli jiného", "cs")).toBe(STAGE_DATA.cs.fallbackAnswer);
    expect(stageBookingPath("cs", "ABCDEF12-0000")).toBe("/s/petra-dvorakova-abcdef/konzultace");
  });
});
