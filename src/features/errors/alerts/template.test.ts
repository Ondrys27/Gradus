// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { digestAlertEmail, errorAlertEmail, overflowAlertEmail, testAlertEmail } =
  await import("./template");

const EVENT = {
  code: "GR-7K3M9Q",
  source: "boundary",
  page: "/app/kontakty/:id",
  action: null,
  message: "TypeError: x is <undefined>",
  stack: "at render (app.js:1:2)\nat commit (app.js:3:4)",
  browser: "chrome",
  device: "desktop",
  viewport: "1440x900",
  appVersion: "abc1234",
  createdAt: "2026-10-27T13:03:05.000Z",
};
const USER = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Jana Testová",
  email: "jana@firma.cz",
  plan: "pro",
  planStatus: "trialing",
  internal: false,
};
const URL = "https://gradus.app/admin/zpetna-vazba?code=GR-7K3M9Q";

describe("errorAlertEmail", () => {
  it("has the subject the owner asked for", () => {
    const email = errorAlertEmail(
      { event: EVENT, user: USER, dayCount: 1, sinceLast: 0, adminUrl: URL },
      "cs",
    );
    expect(email.subject).toBe("[Gradus] Chyba GR-7K3M9Q · /app/kontakty/:id");
  });

  it("says everything about the error, both times, the user and the counts", () => {
    const { text } = errorAlertEmail(
      { event: EVENT, user: USER, dayCount: 4, sinceLast: 2, adminUrl: URL },
      "cs",
    );
    for (const part of [
      "Kód: GR-7K3M9Q",
      "27. 10. 2026 14:03:05 Europe/Prague · 27. 10. 2026 13:03:05 UTC",
      "Stránka: /app/kontakty/:id",
      "obrazovka chyby v prohlížeči",
      "Zpráva: TypeError: x is <undefined>",
      "at render (app.js:1:2)\nat commit (app.js:3:4)",
      "Jana Testová · jana@firma.cz · 00000000-0000-4000-8000-000000000001 · tarif pro (trialing) · interní: ne",
      "Chrome · Počítač · 1440x900",
      "Verze nasazení: abc1234",
      "4× za posledních 24 h, z toho 2× od posledního e-mailu",
      URL,
    ]) {
      expect(text, part).toContain(part);
    }
  });

  it("names nobody when nobody was signed in, and speaks English for an English owner", () => {
    const cs = errorAlertEmail(
      { event: EVENT, user: null, dayCount: 1, sinceLast: 0, adminUrl: null },
      "cs",
    );
    expect(cs.text).toContain("Uživatel: nepřihlášený");
    expect(cs.text).toContain("1× za posledních 24 h");
    expect(cs.text).not.toContain("V administraci");
    const en = errorAlertEmail(
      {
        event: { ...EVENT, source: "cron", action: "error_alerts" },
        user: null,
        dayCount: 1,
        sinceLast: 0,
        adminUrl: null,
      },
      "en",
    );
    expect(en.subject).toBe("[Gradus] Error GR-7K3M9Q · /app/kontakty/:id");
    expect(en.text).toContain("User: not signed in");
    expect(en.text).toContain("scheduled job · error_alerts");
  });

  it("escapes every value in the HTML part", () => {
    const { html } = errorAlertEmail(
      {
        event: EVENT,
        user: { ...USER, name: "<b>Jana</b>" },
        dayCount: 1,
        sinceLast: 0,
        adminUrl: URL,
      },
      "cs",
    );
    expect(html).not.toContain("<undefined>");
    expect(html).not.toContain("<b>Jana</b>");
    expect(html).toContain("&#60;undefined&#62;");
    expect(html).toContain(`<a href="${URL}">`);
  });
});

describe("the other e-mails", () => {
  it("tells the owner to look in the administration when there are too many", () => {
    const email = overflowAlertEmail({ adminUrl: "https://gradus.app/admin/zpetna-vazba" }, "cs");
    expect(email.subject).toBe("[Gradus] Chyb je víc, podívej se do administrace");
    expect(email.text).toContain("30 e-mailů");
  });

  it("lists each error of a summary once with its count", () => {
    const email = digestAlertEmail(
      {
        total: 5,
        adminUrl: null,
        groups: [
          {
            code: "GR-AAAAA2",
            page: "/app",
            source: "render",
            action: "/app",
            message: "Error: a",
            n: 4,
            users: 2,
            last_at: "2026-10-27T05:00:00Z",
          },
          {
            code: "GR-BBBBB3",
            page: "/app/finance",
            source: "boundary",
            action: null,
            message: "Error: b",
            n: 1,
            users: 1,
            last_at: "2026-10-27T06:00:00Z",
          },
        ],
      },
      "cs",
    );
    expect(email.subject).toBe("[Gradus] Souhrn chyb: 5");
    expect(email.text).toContain("Od posledního souhrnu se stalo 5 chyb, různých 2.");
    expect(email.text).toContain(
      "4×: GR-AAAAA2 · /app · vykreslení stránky na serveru /app · Error: a",
    );
    expect(email.text).toContain("1×: GR-BBBBB3 · /app/finance");
  });

  it("names the addresses in the test e-mail", () => {
    const email = testAlertEmail({ emails: ["a@b.cz", "c@d.cz"], adminUrl: null }, "en");
    expect(email.subject).toBe("[Gradus] Test e-mail: error alerts");
    expect(email.text).toContain("Addresses: a@b.cz, c@d.cz");
  });
});
