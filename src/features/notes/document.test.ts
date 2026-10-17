import { describe, expect, it } from "vitest";
import en from "@/locales/en.json";
import cs from "@/locales/cs.json";
import {
  appendToDoc,
  blocksFromPlainText,
  docWithTitle,
  draftFromDoc,
  extractText,
  fitsLimits,
  isBlank,
  previewFromText,
  titleFromText,
  type DocNode,
} from "./document";
import {
  INDUSTRY_TEMPLATES,
  NOTE_TEMPLATE_KEYS,
  TEMPLATE_QUESTIONS,
  isNoteTemplateKey,
  templateDoc,
  templateDraft,
  workNoteDoc,
} from "./templates";
import { INDUSTRY_KEYS } from "@/features/onboarding/industries";

const p = (text: string): DocNode => ({ type: "paragraph", content: [{ type: "text", text }] });

describe("extractText", () => {
  it("writes one line per block with list markers and leaves out empty lines", () => {
    const doc: DocNode = {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Ceník" }] },
        { type: "paragraph" },
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                p("Konzultace"),
                { type: "bulletList", content: [{ type: "listItem", content: [p("online")] }] },
              ],
            },
          ],
        },
        { type: "orderedList", attrs: { start: 3 }, content: [{ type: "listItem", content: [p("Třetí")] }] },
        {
          type: "taskList",
          content: [
            { type: "taskItem", attrs: { checked: true }, content: [p("Hotovo")] },
            { type: "taskItem", attrs: { checked: false }, content: [p("Zbývá")] },
          ],
        },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "web ", marks: [{ type: "bold" }] },
            { type: "text", text: "gradus.app", marks: [{ type: "link", attrs: { href: "https://gradus.app" } }] },
          ],
        },
      ],
    };
    expect(extractText(doc)).toBe(
      ["Ceník", "- Konzultace", "  - online", "3. Třetí", "[x] Hotovo", "[ ] Zbývá", "web gradus.app"].join(
        "\n",
      ),
    );
  });

  it("is empty for an empty or missing document", () => {
    expect(extractText({ type: "doc", content: [] })).toBe("");
    expect(extractText(null)).toBe("");
  });
});

describe("title and preview", () => {
  it("takes the first line as the title, without a list marker", () => {
    expect(titleFromText("Nápady\nDalší řádek")).toBe("Nápady");
    expect(titleFromText("- Koupit doménu\n")).toBe("Koupit doménu");
    expect(titleFromText("[ ] Zavolat účetní")).toBe("Zavolat účetní");
    expect(titleFromText("x".repeat(300))).toHaveLength(200);
  });

  it("shows the text under the title as the preview", () => {
    expect(previewFromText("Ceník\nKonzultace   1 500 Kč\nDalší")).toBe("Konzultace 1 500 Kč Další");
    expect(previewFromText("Jen nadpis")).toBe("");
  });

  it("builds the stored draft from the document", () => {
    const draft = draftFromDoc({ type: "doc", content: [p("Konkurence"), p("Kavárna U Rohu")] });
    expect(draft).toMatchObject({ title: "Konkurence", content_text: "Konkurence\nKavárna U Rohu" });
    expect(isBlank(draft)).toBe(false);
    expect(isBlank(draftFromDoc({ type: "doc", content: [{ type: "paragraph" }] }))).toBe(true);
    expect(fitsLimits(draft)).toBe(true);
    expect(fitsLimits(draftFromDoc({ type: "doc", content: [p("x".repeat(400_000))] }))).toBe(false);
  });
});

describe("templates", () => {
  const t = (key: string) => key;

  it("starts with the title and asks each question under a small heading", () => {
    const doc = templateDoc("pricing", null, t);
    expect(doc.content?.[0]).toMatchObject({ type: "heading", attrs: { level: 1 } });
    const questions = doc.content?.filter((n) => n.type === "heading" && n.attrs?.level === 3);
    expect(questions).toHaveLength(TEMPLATE_QUESTIONS.pricing.length);
    expect(templateDraft("pricing", null, t).title).toBe("pricing.title");
  });

  it("adds one question for the industry where it helps, none for other", () => {
    const count = (industry: (typeof INDUSTRY_KEYS)[number] | null) =>
      templateDraft("idealCustomer", industry, t).content_text.split("\n").length;
    expect(count("ecommerce")).toBe(count(null) + 1);
    expect(count("other")).toBe(count(null));
    expect(templateDraft("idealCustomer", "trades", t).content_text).toContain(
      "idealCustomer.industry.trades",
    );
    expect(templateDraft("offer", "trades", t).content_text).not.toContain("industry");
  });

  it("has every text in both languages", () => {
    for (const locale of [en, cs] as Record<string, unknown>[]) {
      const templates = (locale.notes as { templates: Record<string, Record<string, unknown>> })
        .templates;
      for (const key of NOTE_TEMPLATE_KEYS) {
        const tpl = templates[key] as {
          title: string;
          hint: string;
          questions: Record<string, string>;
          industry?: Record<string, string>;
        };
        expect(tpl.title, key).toBeTruthy();
        expect(tpl.hint, key).toBeTruthy();
        for (const q of TEMPLATE_QUESTIONS[key]) expect(tpl.questions[q], `${key}.${q}`).toBeTruthy();
        if (INDUSTRY_TEMPLATES.includes(key)) {
          for (const industry of INDUSTRY_KEYS.filter((i) => i !== "other")) {
            expect(tpl.industry?.[industry], `${key}.${industry}`).toBeTruthy();
          }
        }
      }
    }
  });
});

describe("notes written from a task or a milestone", () => {
  const t = (key: string) => key;

  it("names a plain note after the task and leaves a line to write on", () => {
    const draft = draftFromDoc(workNoteDoc("  Napiš skript  ", null, null, t));
    expect(draft.title).toBe("Napiš skript");
    expect(draft.content.content).toHaveLength(2);
  });

  it("gives a text step the outline of its template under the task's title", () => {
    const draft = draftFromDoc(workNoteDoc("Popiš ideálního zákazníka", "idealCustomer", "trades", t));
    expect(draft.title).toBe("Popiš ideálního zákazníka");
    expect(draft.content_text).not.toContain("idealCustomer.title");
    expect(draft.content_text).toContain("idealCustomer.hint");
    expect(draft.content_text).toContain("idealCustomer.questions.who");
    expect(draft.content_text).toContain("idealCustomer.industry.trades");
  });

  it("knows its template keys", () => {
    expect(isNoteTemplateKey("pricing")).toBe(true);
    expect(isNoteTemplateKey("poem")).toBe(false);
    expect(isNoteTemplateKey(null)).toBe(false);
  });
});

describe("Jarvis's answers in notes", () => {
  const answer = "Tvůj ceník:\n\n- Konzultace 1 500 Kč\n- Balíček 5 000 Kč\n\n1. Zavolej\n2. Pošli nabídku\nHotovo.";

  it("turns the answer's lines into paragraphs and lists", () => {
    const blocks = blocksFromPlainText(answer);
    expect(blocks.map((b) => b.type)).toEqual(["paragraph", "bulletList", "orderedList", "paragraph"]);
    expect(blocks[1].content).toHaveLength(2);
    expect(blocks[2].attrs).toEqual({ start: 1 });
    expect(extractText({ type: "doc", content: blocks })).toBe(
      "Tvůj ceník:\n- Konzultace 1 500 Kč\n- Balíček 5 000 Kč\n1. Zavolej\n2. Pošli nabídku\nHotovo.",
    );
  });

  it("starts a new note with a title line", () => {
    const draft = draftFromDoc(docWithTitle("Od Jarvise, 17. 10. 2026", blocksFromPlainText(answer)));
    expect(draft.title).toBe("Od Jarvise, 17. 10. 2026");
    expect(draft.content_text).toContain("Balíček 5 000 Kč");
  });

  it("adds to the end of a note under a small heading, keeping what was there", () => {
    const doc: DocNode = { type: "doc", content: [p("Ceník"), p("Stará cena"), { type: "paragraph" }] };
    const next = appendToDoc(doc, "Od Jarvise", blocksFromPlainText("Nová cena 2 000 Kč"));
    expect(extractText(next)).toBe("Ceník\nStará cena\nOd Jarvise\nNová cena 2 000 Kč");
    expect(next.content?.[2]).toMatchObject({ type: "heading", attrs: { level: 3 } });
    expect(doc.content).toHaveLength(3);
  });
});
