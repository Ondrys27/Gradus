import { describe, expect, it } from "vitest";
import {
  applyCalls,
  changeCount,
  chunkTranscript,
  isNewContact,
  matchPerson,
  matchStage,
  meetingAnswerSchema,
  resolveRefs,
  type MeetingApply,
} from "./logic";

const DEAL = "11111111-1111-4111-8111-111111111111";
const CONTACT = "22222222-2222-4222-8222-222222222222";
const STAGE = "33333333-3333-4333-8333-333333333333";

function apply(overrides: Partial<MeetingApply> = {}): MeetingApply {
  return {
    target: { kind: "deal", id: DEAL },
    dealId: DEAL,
    contactId: CONTACT,
    summary: null,
    tasks: [],
    stageId: null,
    closeDate: null,
    amount: null,
    contacts: [],
    note: null,
    transcript: null,
    ...overrides,
  };
}

describe("a long transcript in parts", () => {
  it("keeps a short text whole and drops an empty one", () => {
    expect(chunkTranscript("Jana: Ahoj")).toEqual(["Jana: Ahoj"]);
    expect(chunkTranscript("   ")).toEqual([]);
  });

  it("cuts at a speaker's turn, never inside a line, and loses nothing", () => {
    const turns = Array.from(
      { length: 300 },
      (_, i) => `Mluvčí ${i % 2 ? "A" : "B"}: věta číslo ${i} ${"x".repeat(80)}`,
    );
    const text = turns.join("\n");
    const parts = chunkTranscript(text, 5000);
    expect(parts.length).toBeGreaterThan(5);
    for (const part of parts) {
      expect(part.length).toBeLessThanOrEqual(5000);
      expect(part.startsWith("Mluvčí")).toBe(true);
    }
    expect(parts.join("\n")).toBe(text);
  });
});

describe("names the model wrote", () => {
  const people = [
    { id: "p1", name: "Jana Nováková" },
    { id: "p2", name: "Petr Svoboda" },
    { id: "p3", name: "Petr Dvořák" },
  ];

  it("finds a person by the full name or a unique part, without diacritics", () => {
    expect(matchPerson("jana novakova", people)).toBe("p1");
    expect(matchPerson("Jana", people)).toBe("p1");
    expect(matchPerson("Dvořák", people)).toBe("p3");
    // Two Petrs: nobody in particular.
    expect(matchPerson("Petr", people)).toBeNull();
    expect(matchPerson(null, people)).toBeNull();
  });

  it("finds a stage by its name", () => {
    const stages = [
      { id: "s1", name: "Nový lead", isWon: false, isLost: false },
      { id: "s2", name: "Nabídka odeslána", isWon: false, isLost: false },
      { id: "s3", name: "Vyhráno", isWon: true, isLost: false },
    ];
    expect(matchStage("nabidka odeslana", stages)).toBe("s2");
    expect(matchStage("Vyhráno", stages)).toBe("s3");
    expect(matchStage("Neexistuje", stages)).toBeNull();
  });

  it("does not propose a contact that is already known", () => {
    const known = [{ name: "Jan Novák", email: "jan@firma.cz" }];
    const base = { firstName: "", lastName: "", companyName: "", email: "" };
    expect(isNewContact({ ...base, firstName: "Jan", lastName: "Novák" }, known)).toBe(false);
    expect(isNewContact({ ...base, firstName: "J.", email: "JAN@firma.cz" }, known)).toBe(false);
    expect(isNewContact({ ...base, firstName: "Eva", lastName: "Malá" }, known)).toBe(true);
  });

  it("reads the model's JSON and refuses a broken shape", () => {
    expect(
      meetingAnswerSchema.safeParse({
        summary: "Ok",
        tasks: [{ title: "Poslat nabídku", due: "2026-12-01" }],
      }).success,
    ).toBe(true);
    expect(meetingAnswerSchema.safeParse({ tasks: [{ title: "", due: "zítra" }] }).success).toBe(
      false,
    );
  });
});

describe("the confirmed changes as tool calls", () => {
  it("nothing ticked = nothing to do", () => {
    expect(applyCalls(apply(), { linkNote: true })).toEqual([]);
    expect(changeCount(apply())).toBe(0);
  });

  it("orders history, deal fields, stage, contacts onto the deal, tasks, note, transcript", () => {
    const calls = applyCalls(
      apply({
        summary: "Dohodli jsme se.",
        closeDate: "2026-12-15",
        amount: { value: 25000, currency: "CZK" },
        stageId: STAGE,
        contacts: [
          {
            firstName: "Eva",
            lastName: "Malá",
            companyName: "",
            email: "eva@x.cz",
            phone: "",
            role: "nákupčí",
          },
          { firstName: "", lastName: "", companyName: "", email: "", phone: "", role: "" },
        ],
        tasks: [{ title: "Poslat nabídku", dueAt: null, assigneeId: null, durationMinutes: 30 }],
        note: { title: "Schůzka", text: "Text" },
        transcript: { name: "Přepis.txt", text: "Jana: Ahoj" },
      }),
      { linkNote: true },
    );
    expect(calls.map((call) => call.name)).toEqual([
      "add_deal_history_entry",
      "update_deal",
      "move_deal_stage",
      "create_contact",
      "add_deal_contact",
      "create_crm_task",
      "create_note",
      "save_deal_attachment",
    ]);
    // The new contact goes onto the deal by the id its creation returns.
    expect(calls[4].input.contactId).toBe("$3.contactId");
    expect(calls[5].input).toMatchObject({ dealId: DEAL, contactId: CONTACT, durationMinutes: 30 });
    expect(calls[6].input.linkTo).toEqual({ kind: "deal", id: DEAL });
  });

  it("a contact's meeting goes into the contact's history; a worker's note is not tied to the deal", () => {
    const contactOnly = applyCalls(
      apply({
        target: { kind: "contact", id: CONTACT },
        dealId: null,
        summary: "S",
        note: { title: "N", text: "" },
      }),
      { linkNote: false },
    );
    expect(contactOnly[0]).toEqual({
      name: "add_contact_activity",
      input: { contactId: CONTACT, type: "meeting", content: "S" },
    });
    expect(contactOnly[1].input.linkTo).toBeUndefined();
  });

  it("fills an id made by an earlier step, nothing else", () => {
    const outputs = [{ entryId: "e" }, { contactId: "new-contact" }];
    expect(resolveRefs({ dealId: DEAL, contactId: "$1.contactId", note: "$x" }, outputs)).toEqual({
      dealId: DEAL,
      contactId: "new-contact",
      note: "$x",
    });
    expect(resolveRefs({ contactId: "$5.contactId" }, outputs)).toEqual({ contactId: null });
  });
});
