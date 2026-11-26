import { describe, expect, it, vi } from "vitest";
import { templateGrants } from "../permissions-catalog";

vi.mock("server-only", () => ({}));

describe("workerInviteEmail", () => {
  it("says in plain words what the person will have access to (30.2)", async () => {
    const { workerInviteEmail } = await import("./invite-emails");
    const mail = workerInviteEmail(
      {
        company: "Novák s.r.o.",
        owner: "Václav Novák",
        jobTitle: "Cold caller",
        url: "https://example.com/app/pozvanky",
        forAccount: true,
        grants: templateGrants("coldCaller"),
      },
      "cs",
    );
    expect(mail.text).toContain("K čemu budeš mít přístup:");
    expect(mail.text).toContain("- Cold Calling: volat a posouvat kontakty");
    expect(mail.text).toMatch(/Neuvidíš: .*Finance/);
    expect(mail.html).toContain("<li>Cold Calling: volat a posouvat kontakty</li>");
    const english = workerInviteEmail(
      { company: null, owner: "Václav", jobTitle: null, url: null, forAccount: false, grants: templateGrants("accountant") },
      "en",
    );
    expect(english.text).toContain("What you will have access to:");
    expect(english.text).toContain("Invoices: issue and send invoices");
  });

  it("leaves the summary out without the rights", async () => {
    const { workerInviteEmail } = await import("./invite-emails");
    const mail = workerInviteEmail(
      { company: "Firma", owner: null, jobTitle: null, url: null, forAccount: true },
      "cs",
    );
    expect(mail.text).not.toContain("K čemu budeš mít přístup");
  });
});
