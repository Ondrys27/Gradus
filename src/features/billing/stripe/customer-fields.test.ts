import { describe, expect, it } from "vitest";
import { customerFields, euVatNumber } from "./customer-fields";

const profile = {
  name: "Novák s.r.o.",
  company_reg_no: "12345678",
  vat_no: "CZ12345678",
  street: "Dlouhá 1",
  city: "Praha",
  postal_code: "110 00",
  country: "CZ",
  email: "fakturace@novak.cz",
};

describe("the Stripe customer", () => {
  it("takes the billing details: name, address, e-mail, IČO on receipts, DIČ as eu_vat", () => {
    expect(customerFields({ workspace: "w1", profile, email: "owner@novak.cz", locale: "cs" })).toEqual({
      name: "Novák s.r.o.",
      email: "fakturace@novak.cz",
      address: { line1: "Dlouhá 1", city: "Praha", postal_code: "110 00", country: "CZ" },
      metadata: { workspace: "w1", company_reg_no: "12345678" },
      invoiceCustomFields: [{ name: "IČO", value: "12345678" }],
      preferredLocales: ["cs"],
      euVat: "CZ12345678",
    });
  });

  it("without details: only the account's e-mail and the workspace", () => {
    expect(customerFields({ workspace: "w1", profile: null, email: "owner@novak.cz", locale: "en" })).toEqual({
      email: "owner@novak.cz",
      metadata: { workspace: "w1", company_reg_no: "" },
      invoiceCustomFields: [],
      preferredLocales: ["en"],
      euVat: null,
    });
  });

  it("an EU VAT number only when it is one", () => {
    expect(euVatNumber("CZ 123 456 78", "CZ")).toBe("CZ12345678");
    expect(euVatNumber("12345678", "CZ")).toBe("CZ12345678");
    expect(euVatNumber("123456789", "GR")).toBe("EL123456789");
    expect(euVatNumber("12345678", "US")).toBeNull();
    expect(euVatNumber("GB123456789", "GB")).toBeNull();
    expect(euVatNumber("", "CZ")).toBeNull();
    expect(euVatNumber(null, "CZ")).toBeNull();
  });
});
