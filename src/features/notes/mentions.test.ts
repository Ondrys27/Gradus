import { describe, expect, it } from "vitest";
import en from "@/locales/en.json";
import cs from "@/locales/cs.json";
import { draftFromDoc, extractText, type DocNode } from "./document";
import {
  contactName,
  defaultMentionText,
  groupByKind,
  idsByKind,
  mentionAttrsOf,
  mentionKey,
  mentionSetKey,
  mentionsInDoc,
  MENTION_KINDS,
  staleLabels,
  type MentionAttrs,
  type MentionTarget,
} from "./mentions";

const CONTACT = "0b7c1f7e-4a53-4c4e-9f3e-2f1a9b8c7d61";
const DEAL = "1c8d2a8f-5b64-4d5f-8a4f-3a2b0c9d8e72";
const EVENT = "2d9e3b9a-6c75-4e6a-9b5a-4b3c1dae9f83";
const WORKER = "3eaf4cab-7d86-4f7b-8c6b-5c4d2ebfaa94";

function mention(type: string, id: string, label: string): DocNode {
  return { type: "mention", attrs: { type, id, label, mentionSuggestionChar: "@" } };
}

const czech = (kind: string, label: string) =>
  `[${cs.notes.mention.kind[kind as keyof typeof cs.notes.mention.kind]}: ${label}]`;

const doc: DocNode = {
  type: "doc",
  content: [
    {
      type: "heading",
      attrs: { level: 1 },
      content: [{ type: "text", text: "Schůzka s " }, mention("contact", CONTACT, "Jan Novák")],
    },
    {
      type: "paragraph",
      content: [
        { type: "text", text: "Nabídka " },
        mention("deal", DEAL, "Web pro pekárnu"),
        { type: "text", text: " na " },
        mention("event", EVENT, "Schůzka"),
      ],
    },
    {
      type: "bulletList",
      content: [
        {
          type: "listItem",
          content: [
            {
              type: "paragraph",
              content: [
                { type: "text", text: "Zavolá " },
                mention("worker", WORKER, "Petra"),
                { type: "text", text: " a " },
                mention("contact", CONTACT, "Jan Novák"),
              ],
            },
          ],
        },
      ],
    },
  ],
};

describe("mentions in the plain text", () => {
  it("writes a chip as [kind: label], so search and Jarvis read the name", () => {
    expect(extractText(doc, { mentionText: czech })).toBe(
      [
        "Schůzka s [kontakt: Jan Novák]",
        "Nabídka [obchod: Web pro pekárnu] na [událost: Schůzka]",
        "- Zavolá [pracovník: Petra] a [kontakt: Jan Novák]",
      ].join("\n"),
    );
  });

  it("falls back to the kind's code without the interface language", () => {
    expect(extractText(doc).split("\n")[0]).toBe("Schůzka s [contact: Jan Novák]");
    expect(defaultMentionText("deal", "Web")).toBe("[deal: Web]");
  });

  it("keeps a chip without a label from breaking the text", () => {
    const odd: DocNode = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Viz " },
            { type: "mention", attrs: { type: "contact", id: CONTACT, label: "  " } },
            { type: "mention", attrs: { type: "invoice", id: CONTACT, label: "X" } },
            { type: "mention", attrs: { id: CONTACT } },
          ],
        },
      ],
    };
    // An unknown or broken mention is no record link: it leaves nothing.
    expect(extractText(odd)).toBe("Viz [contact: ?]");
  });

  it("the title of a note can start with a chip", () => {
    const draft = draftFromDoc(doc, { mentionText: czech });
    expect(draft.title).toBe("Schůzka s [kontakt: Jan Novák]");
    expect(draft.content).toBe(doc);
  });

  it("every kind has a word in both languages", () => {
    for (const kind of MENTION_KINDS) {
      expect(en.notes.mention.kind[kind]).toBeTruthy();
      expect(cs.notes.mention.kind[kind]).toBeTruthy();
      expect(en.notes.mention.open[kind]).toBeTruthy();
      expect(cs.notes.mention.open[kind]).toBeTruthy();
    }
  });
});

describe("mentionsInDoc", () => {
  it("lists every mentioned record once, in reading order", () => {
    expect(mentionsInDoc(doc)).toEqual([
      { type: "contact", id: CONTACT, label: "Jan Novák" },
      { type: "deal", id: DEAL, label: "Web pro pekárnu" },
      { type: "event", id: EVENT, label: "Schůzka" },
      { type: "worker", id: WORKER, label: "Petra" },
    ]);
    expect(mentionsInDoc(null)).toEqual([]);
    expect(mentionsInDoc({ type: "doc", content: [] })).toEqual([]);
  });

  it("reads only well-formed mentions", () => {
    expect(mentionAttrsOf({ type: "mention", attrs: { type: "deal", id: DEAL } })).toEqual({
      type: "deal",
      id: DEAL,
      label: "",
    });
    expect(mentionAttrsOf({ type: "mention", attrs: { type: "task", id: DEAL } })).toBeNull();
    expect(mentionAttrsOf({ type: "mention", attrs: { type: "deal", id: "" } })).toBeNull();
    expect(mentionAttrsOf({ type: "text", attrs: { type: "deal", id: DEAL } })).toBeNull();
  });

  it("keys the set regardless of order", () => {
    const a: MentionAttrs = { type: "contact", id: CONTACT, label: "A" };
    const b: MentionAttrs = { type: "deal", id: DEAL, label: "B" };
    expect(mentionSetKey([a, b])).toBe(mentionSetKey([b, { ...a, label: "renamed" }]));
    expect(mentionSetKey([a])).not.toBe(mentionSetKey([a, b]));
  });

  it("looks up only well-formed ids, grouped by kind", () => {
    expect(
      idsByKind([
        { type: "contact", id: CONTACT, label: "" },
        { type: "contact", id: "not-an-id", label: "" },
        { type: "worker", id: WORKER, label: "" },
      ]),
    ).toEqual({ contact: [CONTACT], deal: [], event: [], worker: [WORKER] });
  });
});

describe("current names of mentioned records", () => {
  it("a contact is called by its company, else by the person", () => {
    expect(contactName({ company_name: "Pekárna s.r.o.", first_name: "Jan" })).toBe("Pekárna s.r.o.");
    expect(contactName({ company_name: " ", first_name: "Jan", last_name: "Novák" })).toBe("Jan Novák");
    expect(contactName({ first_name: null, last_name: "Novák" })).toBe("Novák");
  });

  it("renames chips whose record has a new name; gone and unknown records keep theirs", () => {
    const nodes = [
      { pos: 3, attrs: { type: "contact", id: CONTACT, label: "Jan Novák" } as MentionAttrs },
      { pos: 9, attrs: { type: "deal", id: DEAL, label: "Web" } as MentionAttrs },
      { pos: 14, attrs: { type: "event", id: EVENT, label: "Schůzka" } as MentionAttrs },
      { pos: 20, attrs: { type: "worker", id: WORKER, label: "Petra" } as MentionAttrs },
    ];
    const targets = new Map<string, MentionTarget>([
      [mentionKey("contact", CONTACT), { exists: true, label: "Jan Novák ml." }],
      [mentionKey("deal", DEAL), { exists: true, label: "Web" }],
      [mentionKey("event", EVENT), { exists: false }],
    ]);
    expect(staleLabels(nodes, targets)).toEqual([{ pos: 3, label: "Jan Novák ml." }]);
  });
});

describe("the @ menu", () => {
  it("groups choices by kind in a fixed order, a few of each", () => {
    const options = [
      { type: "deal" as const, id: "d1" },
      { type: "contact" as const, id: "c1" },
      { type: "deal" as const, id: "d2" },
      { type: "deal" as const, id: "d3" },
      { type: "worker" as const, id: "w1" },
    ];
    expect(groupByKind(options, 2)).toEqual([
      { kind: "contact", options: [{ type: "contact", id: "c1" }] },
      {
        kind: "deal",
        options: [
          { type: "deal", id: "d1" },
          { type: "deal", id: "d2" },
        ],
      },
      { kind: "worker", options: [{ type: "worker", id: "w1" }] },
    ]);
  });
});
