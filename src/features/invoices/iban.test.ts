import { describe, expect, it } from "vitest";
import {
  czAccountToIban,
  formatIban,
  isValidCzAccount,
  isValidIban,
  paymentIban,
} from "./iban";

describe("Czech account to IBAN", () => {
  it("matches the published examples", () => {
    // ČNB's and the IBAN registry's examples of Czech IBANs.
    expect(czAccountToIban("19-2000145399", "0800")).toBe("CZ6508000000192000145399");
    expect(czAccountToIban("178124-4159", "0710")).toBe("CZ6907101781240000004159");
    expect(czAccountToIban("1234567899", "0800")).toBe("CZ5508000000001234567899");
  });

  it("pads the prefix and the number and ignores spaces", () => {
    expect(czAccountToIban(" 2501277007 ", "2010")).toBe("CZ5420100000002501277007");
    expect(czAccountToIban("2000 145 399", "0800")).toBe("CZ7908000000002000145399");
  });

  it("gives an IBAN that passes the mod 97 check for any valid account", () => {
    for (const [account, bank] of [
      ["2000145399", "0100"],
      ["19-2000145399", "0300"],
      ["2501277007", "2010"],
      ["1234567899", "6210"],
      ["178124-4159", "5500"],
    ]) {
      const iban = czAccountToIban(account, bank);
      expect(iban).toHaveLength(24);
      expect(isValidIban(iban!)).toBe(true);
    }
  });

  it("refuses accounts that fail the mod 11 check or a bad bank code", () => {
    expect(isValidCzAccount("2400000002")).toBe(false);
    expect(isValidCzAccount("19-2000145399")).toBe(true);
    expect(isValidCzAccount("18-2000145399")).toBe(false);
    expect(isValidCzAccount("0000000000")).toBe(false);
    expect(czAccountToIban("2400000002", "2010")).toBeNull();
    expect(czAccountToIban("2000145399", "80")).toBeNull();
    expect(czAccountToIban("abc", "0800")).toBeNull();
  });
});

describe("IBAN", () => {
  it("checks foreign IBANs and formats them in fours", () => {
    expect(isValidIban("DE89 3704 0044 0532 0130 00")).toBe(true);
    expect(isValidIban("SK31 1200 0000 1987 4263 7541")).toBe(true);
    expect(isValidIban("DE89370400440532013001")).toBe(false);
    expect(isValidIban("CZ650800000019200014539")).toBe(false);
    expect(formatIban("cz6508000000192000145399")).toBe("CZ65 0800 0000 1920 0014 5399");
  });

  it("pays to the Czech account first, else to the IBAN given", () => {
    expect(paymentIban({ account_number: "19-2000145399", bank_code: "0800" })).toBe(
      "CZ6508000000192000145399",
    );
    expect(paymentIban({ iban: "de89 3704 0044 0532 0130 00" })).toBe("DE89370400440532013000");
    expect(paymentIban({ account_number: "2400000002", bank_code: "2010" })).toBeNull();
  });
});
