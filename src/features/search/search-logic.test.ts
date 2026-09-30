import { describe, expect, it } from "vitest";
import {
  contactDraftFromText,
  highlight,
  isSafeHref,
  jumpGroup,
  localScore,
  moveSelection,
  normalizeText,
  orderGroups,
  parseAmount,
  pushRecentItem,
  pushRecentSearch,
  readRecentItems,
  searchParams,
  shouldQueryDatabase,
  type RecentItem,
} from "./search-logic";

describe("normalizeText", () => {
  it("drops diacritics and case like search_norm() in the database", () => {
    expect(normalizeText("Novák")).toBe("novak");
    expect(normalizeText("ŽLUŤOUČKÝ KŮŇ")).toBe("zlutoucky kun");
    expect(normalizeText("Šťastná kavárna")).toBe("stastna kavarna");
  });
});

describe("searchParams", () => {
  it("sends a part of a phone number as digits, whatever the spacing", () => {
    expect(searchParams("777 123")._phone_patterns).toEqual(["777123"]);
    expect(searchParams("777-123-456")._phone_patterns).toEqual(["777123456"]);
    expect(searchParams("+420 777 123 456")._phone_patterns).toEqual(["777123456"]);
    expect(searchParams("+420 777 12")._phone_patterns).toContain("77712");
  });

  it("does not treat names or too few digits as a phone", () => {
    expect(searchParams("novak")._phone_patterns).toEqual([]);
    expect(searchParams("12")._phone_patterns).toEqual([]);
  });

  it("keeps the text as typed for the accent-free match in the database", () => {
    expect(searchParams("  Jan   Novák ")._query).toBe("Jan Novák");
  });

  it("asks for one more row per group, or fifty after Show all", () => {
    expect(searchParams("novak")).toMatchObject({ _kinds: null, _limit: 6 });
    expect(searchParams("novak", ["contact"])).toMatchObject({ _kinds: ["contact"], _limit: 50 });
    expect(searchParams("novak", ["nonsense"])._kinds).toBeNull();
  });

  it("reads a number as a deal amount", () => {
    expect(searchParams("150 000")._amount).toBe(150000);
    expect(searchParams("novak")._amount).toBeNull();
  });

  it("asks the database from two characters on", () => {
    expect(shouldQueryDatabase("n")).toBe(false);
    expect(shouldQueryDatabase(" no ")).toBe(true);
  });
});

describe("parseAmount", () => {
  it("understands grouped and decimal numbers", () => {
    expect(parseAmount("150000")).toBe(150000);
    expect(parseAmount("30.000")).toBe(30000);
    expect(parseAmount("1 200,50")).toBe(1200.5);
    expect(parseAmount("1,200.50")).toBe(1200.5);
    expect(parseAmount("12,5")).toBe(12.5);
    expect(parseAmount("abc")).toBeNull();
    expect(parseAmount("+420 777")).toBeNull();
  });
});

describe("localScore", () => {
  it("finds a setting without diacritics and with a different word ending", () => {
    expect(localScore("nastaveni meny", "Měna", "Nastavení peníze koruny")).toBeGreaterThan(0);
    expect(localScore("currency", "Currency", "Settings money")).toBe(3);
  });

  it("needs every typed word to fit and ranks the label above keywords", () => {
    expect(localScore("mena kalendar", "Měna", "Nastavení")).toBe(0);
    expect(localScore("kont", "Kontakty", "")).toBeGreaterThan(
      localScore("kont", "Profil", "kontakt"),
    );
  });
});

describe("highlight", () => {
  it("marks the matched part of the original text, ignoring diacritics", () => {
    expect(highlight("Jan Novák", "novak")).toEqual([
      { text: "Jan ", match: false },
      { text: "Novák", match: true },
    ]);
    expect(highlight("Kavárna Šťastná", "stast")).toEqual([
      { text: "Kavárna ", match: false },
      { text: "Šťast", match: true },
      { text: "ná", match: false },
    ]);
  });

  it("marks each typed word and leaves text without a match plain", () => {
    const marked = highlight("Nový web pro Nováka", "novy web")
      .filter((s) => s.match)
      .map((s) => s.text);
    expect(marked).toEqual(["Nový", "web"]);
    expect(highlight("Faktura", "xyz")).toEqual([{ text: "Faktura", match: false }]);
  });
});

describe("keyboard movement", () => {
  it("moves across groups and wraps around", () => {
    expect(moveSelection(0, 5, 1)).toBe(1);
    expect(moveSelection(4, 5, 1)).toBe(0);
    expect(moveSelection(0, 5, -1)).toBe(4);
    expect(moveSelection(0, 0, 1)).toBe(0);
  });

  it("jumps to the first row of the next or previous group with Tab", () => {
    const sizes = [3, 2, 4];
    expect(jumpGroup(0, sizes, 1)).toBe(3);
    expect(jumpGroup(4, sizes, 1)).toBe(5);
    expect(jumpGroup(6, sizes, 1)).toBe(0);
    expect(jumpGroup(1, sizes, -1)).toBe(5);
  });
});

describe("orderGroups", () => {
  it("puts the group with the best match first and drops empty ones", () => {
    const groups = orderGroups([
      { key: "a", items: [{ rank: 1 }] },
      { key: "b", items: [] },
      { key: "c", items: [{ rank: 3 }, { rank: 0.5 }] },
      { key: "d", items: [{ rank: 1 }] },
    ]);
    expect(groups.map((g) => g.key)).toEqual(["c", "a", "d"]);
  });
});

describe("recent lists", () => {
  const item = (id: string): RecentItem => ({
    kind: "contact",
    id,
    title: `Contact ${id}`,
    href: `/contacts/${id}`,
  });

  it("keeps the newest eight opened results without duplicates", () => {
    let list: RecentItem[] = [];
    for (let i = 0; i < 10; i++) list = pushRecentItem(list, item(String(i)));
    list = pushRecentItem(list, item("5"));
    expect(list).toHaveLength(8);
    expect(list[0].id).toBe("5");
    expect(list.filter((i) => i.id === "5")).toHaveLength(1);
  });

  it("keeps the newest eight searches, one per accent-free spelling", () => {
    let list: string[] = [];
    for (let i = 0; i < 10; i++) list = pushRecentSearch(list, `query ${i}`);
    list = pushRecentSearch(list, "Novák");
    list = pushRecentSearch(list, "novak");
    expect(list).toHaveLength(8);
    expect(list[0]).toBe("novak");
    expect(list).not.toContain("Novák");
    expect(pushRecentSearch(list, "   ")).toEqual(list);
  });

  it("drops stored items that are malformed or lead outside the app", () => {
    expect(
      readRecentItems([
        item("1"),
        { kind: "contact", id: "2", title: "Evil", href: "javascript:alert(1)" },
        { kind: "contact", id: "3", title: "Away", href: "//evil.example" },
        { kind: "spaceship", id: "4", title: "?", href: "/x" },
        "junk",
      ]),
    ).toEqual([item("1")]);
    expect(readRecentItems(null)).toEqual([]);
    expect(isSafeHref("/settings?focus=settings-currency")).toBe(true);
    expect(isSafeHref("https://evil.example")).toBe(false);
  });
});

describe("contactDraftFromText", () => {
  it("guesses what the typed text is", () => {
    expect(contactDraftFromText("jan@example.com")).toEqual({ email: "jan@example.com" });
    expect(contactDraftFromText("+420 777 123 456")).toEqual({ phone: "+420 777 123 456" });
    expect(contactDraftFromText("Jan Novák")).toEqual({ first_name: "Jan", last_name: "Novák" });
    expect(contactDraftFromText("Kavárna Šťastná s.r.o.")).toEqual({
      company_name: "Kavárna Šťastná s.r.o.",
    });
    expect(contactDraftFromText("pekárna")).toEqual({ company_name: "pekárna" });
  });
});
