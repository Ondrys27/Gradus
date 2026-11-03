// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { chatRecipients } = await import("./notify");
const { chatDigestEmail } = await import("./emails");

describe("who hears about a message by e-mail", () => {
  it("is the other person of a direct conversation", () => {
    expect(chatRecipients({ kind: "direct", sender: "a", members: ["a", "b"], mentions: [] })).toEqual(["b"]);
  });

  it("is whoever a group message mentions, members only, never the sender", () => {
    expect(
      chatRecipients({ kind: "group", sender: "a", members: ["a", "b", "c"], mentions: ["a", "c", "x"] }),
    ).toEqual(["c"]);
    expect(chatRecipients({ kind: "group", sender: "a", members: ["a", "b"], mentions: [] })).toEqual([]);
  });
});

describe("the e-mail", () => {
  it("counts what waits and never carries a message's text", () => {
    const mail = chatDigestEmail(
      [
        { kind: "direct", name: "Jana", messages: 3, mentions: 0 },
        { kind: "group", name: "Obchod", mentions: 1 },
        { kind: "direct", name: null, messages: 1, mentions: 1 },
      ],
      { appUrl: "https://app.test/app/zpravy?ref=email", settingsUrl: null },
      "cs",
    );
    expect(mail.subject).toContain("Nové zprávy");
    expect(mail.text).toContain("Jana: 3 zprávy");
    expect(mail.text).toContain("Skupina Obchod: 1 zmínka o tobě");
    expect(mail.text).toContain("Někdo: 1 zpráva, z toho 1 zmínka");
    expect(mail.html).toContain("https://app.test/app/zpravy?ref=email");
    const en = chatDigestEmail([{ kind: "group", name: "<b>Sales</b>", mentions: 2 }], { appUrl: null, settingsUrl: null }, "en");
    expect(en.text).toContain("Group <b>Sales</b>: 2 mentions of you");
    expect(en.html).not.toContain("<b>Sales</b>");
  });
});
