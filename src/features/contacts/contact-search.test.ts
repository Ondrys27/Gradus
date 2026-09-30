import { describe, expect, it } from "vitest";
import {
  cleanTerm,
  duplicateEmailKey,
  duplicatePhoneKey,
  normalizePhone,
  phoneSearchDigits,
  searchFilter,
} from "./contact-search";

describe("normalizePhone", () => {
  it("keeps digits and drops the 00 prefix like the database", () => {
    expect(normalizePhone("+420 777-123 456")).toBe("420777123456");
    expect(normalizePhone("00421 905 111 222")).toBe("421905111222");
    expect(normalizePhone("(777) 123/456")).toBe("777123456");
    expect(normalizePhone("  ")).toBeNull();
    expect(normalizePhone(null)).toBeNull();
  });
});

describe("phoneSearchDigits", () => {
  it("ignores spaces, dashes and the country prefix", () => {
    expect(phoneSearchDigits("777 123")).toEqual(["777123"]);
    expect(phoneSearchDigits("777-123-456")).toEqual(["777123456"]);
    expect(phoneSearchDigits("+420 777 123 456")).toEqual(["777123456"]);
    expect(phoneSearchDigits("00420777123456")).toEqual(["777123456"]);
  });

  it("also tries a partial number without each possible prefix", () => {
    expect(phoneSearchDigits("+420 777 12")).toEqual(["42077712", "2077712", "077712", "77712"]);
    expect(phoneSearchDigits("+1 5551")).toEqual(["15551"]);
  });

  it("also tries a partial national number without its trunk zero", () => {
    expect(phoneSearchDigits("0170 123")).toEqual(["0170123", "170123"]);
    expect(phoneSearchDigits("0170")).toEqual(["0170"]);
  });

  it("is not used for names or very short numbers", () => {
    expect(phoneSearchDigits("Acme 24")).toEqual([]);
    expect(phoneSearchDigits("12")).toEqual([]);
  });
});

describe("searchFilter", () => {
  it("searches the name and e-mail, and the phone only for number-like terms", () => {
    expect(searchFilter("Novák")).toBe(`search_name.ilike."%Novák%",email.ilike."%Novák%"`);
    expect(searchFilter("777 123")).toBe(
      `search_name.ilike."%777 123%",email.ilike."%777 123%",phone_normalized.like."%777123%"`,
    );
  });

  it("strips characters that would break the filter", () => {
    expect(cleanTerm(` a,b(c)%_"x" `)).toBe("a b c x");
    expect(searchFilter("  ,() ")).toBeNull();
  });
});

describe("duplicate keys", () => {
  it("compares the whole E.164 number, as the database keeps it", () => {
    expect(duplicatePhoneKey("+420777123456")).toBe("420777123456");
    expect(duplicatePhoneKey("+421777123456")).not.toBe(duplicatePhoneKey("+420777123456"));
    expect(duplicatePhoneKey("123")).toBeNull();
  });

  it("compares e-mails case-insensitively and refuses filter characters", () => {
    expect(duplicateEmailKey(" Jan.Novak@Example.cz ")).toBe("jan.novak@example.cz");
    expect(duplicateEmailKey("a%b@x.cz")).toBeNull();
    expect(duplicateEmailKey("not an email")).toBeNull();
  });
});
