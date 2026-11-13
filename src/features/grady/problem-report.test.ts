import { describe, expect, it } from "vitest";
import { mightBeProblemReport } from "./problem-report";

describe("mightBeProblemReport", () => {
  it.each([
    "chci nahlásit chybu",
    "Chtěl bych nahlásit problém s kalendářem",
    "nefunguje mi ukládání faktury",
    "Kalendář se nenačítá",
    "aplikace spadla, když jsem klikl na Uložit",
    "je tam chyba v aplikaci u kontaktů",
    "vyskočila chybová hláška",
    "I want to report a bug",
    "the pipeline doesn't load",
    "it's broken again",
    "Sign in doesn't work",
  ])("offers the report form for %s", (message) => {
    expect(mightBeProblemReport(message)).toBe(true);
  });

  it.each([
    "Napiš mi e-mail zákazníkovi",
    "Udělal jsem chybu v ceně nabídky, jak to klientovi vysvětlit?",
    "Jaký je můj nejlepší obchod?",
    "Help me plan next week",
    "",
    null,
  ])("stays out of ordinary talk: %s", (message) => {
    expect(mightBeProblemReport(message)).toBe(false);
  });
});
