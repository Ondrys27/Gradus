import { describe, expect, it } from "vitest";
import {
  callingCodePrefix,
  caretAfterSignificant,
  cleanPhoneInput,
  formatAsYouType,
  formatPhone,
  formatPhoneForInput,
  isValidPhone,
  phoneCountry,
  significantBefore,
  telHref,
  toE164,
} from "./phone";

describe("toE164", () => {
  it("saves any readable form as E.164", () => {
    expect(toE164("777 123 456", "CZ")).toBe("+420777123456");
    expect(toE164("+420 777-123 456", "CZ")).toBe("+420777123456");
    expect(toE164("00420 777 123 456", "SK")).toBe("+420777123456");
    expect(toE164("(+420) 777.123.456", "US")).toBe("+420777123456");
    expect(toE164("0905 111 222", "SK")).toBe("+421905111222");
    expect(toE164("(213) 373-4253", "US")).toBe("+12133734253");
  });

  it("keeps text it cannot read, so saving is never blocked", () => {
    expect(toE164("0905 111 222", "CZ")).toBe("0905 111 222");
    expect(toE164("ask 777 123 456", "CZ")).toBe("ask 777 123 456");
    expect(toE164("+999 1234 5678", "CZ")).toBe("+999 1234 5678");
  });

  it("treats nothing or a prefix alone as empty", () => {
    expect(toE164("", "CZ")).toBeNull();
    expect(toE164("  ", "CZ")).toBeNull();
    expect(toE164("+420 ", "CZ")).toBeNull();
    expect(toE164(null, "CZ")).toBeNull();
  });
});

describe("formatPhone", () => {
  it("shows a number from the user's country nationally", () => {
    expect(formatPhone("+420777123456", "CZ")).toBe("777 123 456");
    expect(formatPhone("+12133734253", "US")).toBe("(213) 373-4253");
  });

  it("shows a foreign number internationally", () => {
    expect(formatPhone("+421905111222", "CZ")).toBe("+421 905 111 222");
    expect(formatPhone("+420777123456", "SK")).toBe("+420 777 123 456");
  });

  it("returns text that is not a number as it was", () => {
    expect(formatPhone("ask reception", "CZ")).toBe("ask reception");
    expect(formatPhone("0905 111 222", "CZ")).toBe("0905 111 222");
    expect(formatPhone("", "CZ")).toBe("");
    expect(formatPhone(null, "CZ")).toBe("");
  });

  it("falls back to the default country for an unknown one", () => {
    expect(phoneCountry("xx")).toBe("CZ");
    expect(formatPhone("+420777123456", null)).toBe("777 123 456");
  });
});

describe("the input", () => {
  it("always shows the prefix, grouped", () => {
    expect(formatPhoneForInput("+420777123456", "CZ")).toBe("+420 777 123 456");
    expect(formatPhoneForInput("legacy text", "CZ")).toBe("legacy text");
    expect(callingCodePrefix("CZ")).toBe("+420");
    expect(callingCodePrefix("sk")).toBe("+421");
  });

  it("groups while typing and re-reads pasted numbers", () => {
    expect(formatAsYouType("+42077712", "CZ")).toBe("+420 777 12");
    expect(formatAsYouType("777123456", "CZ")).toBe("777 123 456");
    expect(formatAsYouType("00421-905-111-222", "CZ")).toBe("+421 905 111 222");
    expect(cleanPhoneInput(" +420 (777) 12a3 ")).toBe("+42077712" + "3");
  });

  it("keeps the caret after the same digit when spaces move", () => {
    // Typing "3" after "+420 777 12" with the caret at the end.
    const typed = "+420 777 123";
    const formatted = formatAsYouType(typed, "CZ");
    expect(caretAfterSignificant(formatted, significantBefore(typed, typed.length))).toBe(
      formatted.length,
    );
    // A digit inserted in the middle: the caret stays right after it.
    const middle = "+420 7787 123 456";
    const after = formatAsYouType(middle, "CZ");
    const caret = caretAfterSignificant(after, significantBefore(middle, 9));
    expect(after.slice(0, caret).replace(/\D/g, "")).toBe("4207787");
    expect(caretAfterSignificant("+420 777", 0)).toBe(0);
    expect(caretAfterSignificant("+420 777", 99)).toBe(8);
  });

  it("warns about invalid numbers without blocking", () => {
    expect(isValidPhone("+420777123456", "CZ")).toBe(true);
    expect(isValidPhone("777 123 456", "CZ")).toBe(true);
    expect(isValidPhone("123 45", "CZ")).toBe(false);
    expect(isValidPhone("call me 777123456", "CZ")).toBe(false);
    expect(isValidPhone("", "CZ")).toBe(true);
  });
});

describe("telHref", () => {
  it("dials E.164", () => {
    expect(telHref("+420777123456", "CZ")).toBe("tel:+420777123456");
    expect(telHref("777 123 456", "CZ")).toBe("tel:+420777123456");
    expect(telHref("0905 111 222", "CZ")).toBe("tel:0905111222");
  });
});
