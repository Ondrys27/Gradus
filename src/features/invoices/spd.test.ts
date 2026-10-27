import { describe, expect, it } from "vitest";
import { isValidIco } from "./ico";
import { buildSpd, variableSymbolFor } from "./spd";

const IBAN = "CZ6508000000192000145399";

describe("QR Platba (SPD 1.0)", () => {
  it("writes the fields in the ČBA order with two decimals", () => {
    expect(
      buildSpd({
        iban: IBAN,
        amount: 12100,
        currency: "CZK",
        variableSymbol: "20260001",
        message: "2026-0001",
      }),
    ).toBe(`SPD*1.0*ACC:${IBAN}*AM:12100.00*CC:CZK*X-VS:20260001*MSG:2026-0001`);
    expect(buildSpd({ iban: IBAN, amount: 450.5, currency: "CZK" })).toBe(
      `SPD*1.0*ACC:${IBAN}*AM:450.50*CC:CZK`,
    );
  });

  it("adds a valid BIC to the account and leaves out a bad variable symbol", () => {
    expect(
      buildSpd({ iban: IBAN, bic: "GIBACZPX", amount: 1, currency: "CZK", variableSymbol: "12-3" }),
    ).toBe(`SPD*1.0*ACC:${IBAN}+GIBACZPX*AM:1.00*CC:CZK`);
  });

  it("keeps the message plain: no separator, no diacritics, 60 characters", () => {
    const spd = buildSpd({
      iban: IBAN,
      amount: 1,
      currency: "CZK",
      message: `Faktura*č. ${"x".repeat(80)}`,
    })!;
    const message = spd.split("*MSG:")[1];
    expect(message.startsWith("Faktura c. ")).toBe(true);
    expect(message).not.toContain("*");
    expect(message).toHaveLength(60);
  });

  it("is only for CZK, a positive amount and an IBAN", () => {
    expect(buildSpd({ iban: IBAN, amount: 100, currency: "EUR" })).toBeNull();
    expect(buildSpd({ iban: IBAN, amount: 0, currency: "CZK" })).toBeNull();
    expect(buildSpd({ iban: IBAN, amount: 10_000_000, currency: "CZK" })).toBeNull();
    expect(buildSpd({ iban: "2000145399/0800", amount: 100, currency: "CZK" })).toBeNull();
  });

  it("takes the variable symbol from the digits of the number", () => {
    expect(variableSymbolFor("2026-0001")).toBe("20260001");
    expect(variableSymbolFor("FV2026-0042")).toBe("20260042");
    expect(variableSymbolFor("123456-2026-0001")).toBe("5620260001");
    expect(variableSymbolFor("FV")).toBeNull();
  });
});

describe("IČO", () => {
  it("checks the mod 11 digit", () => {
    expect(isValidIco("00006947")).toBe(true);
    expect(isValidIco("6947")).toBe(true);
    expect(isValidIco("25596641")).toBe(true);
    expect(isValidIco("25596642")).toBe(false);
    expect(isValidIco("1234567a")).toBe(false);
    expect(isValidIco("00000000")).toBe(false);
  });
});
