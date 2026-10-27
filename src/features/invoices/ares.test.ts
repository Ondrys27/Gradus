import { describe, expect, it } from "vitest";
import { parseAresSubject } from "./ares";

describe("ARES answer", () => {
  it("reads the name, VAT number and the address", () => {
    expect(
      parseAresSubject({
        ico: "00006947",
        obchodniJmeno: "Ministerstvo financí",
        dic: "CZ00006947",
        sidlo: {
          kodStatu: "CZ",
          nazevObce: "Praha",
          nazevMestskeCastiObvodu: "Praha 1",
          nazevUlice: "Letenská",
          cisloDomovni: 525,
          cisloOrientacni: 15,
          psc: 11800,
        },
      }),
    ).toEqual({
      name: "Ministerstvo financí",
      companyRegNo: "00006947",
      vatNo: "CZ00006947",
      street: "Letenská 525/15",
      city: "Praha 1",
      postalCode: "118 00",
      country: "CZ",
    });
  });

  it("uses the part of the town for a village without streets", () => {
    expect(
      parseAresSubject({
        ico: "12345678",
        obchodniJmeno: "Jan Novák ",
        sidlo: { nazevObce: "Lhota", nazevCastiObce: "Lhota", cisloDomovni: 7, psc: 39301 },
      }),
    ).toMatchObject({ name: "Jan Novák", vatNo: null, street: "Lhota 7", city: "Lhota", postalCode: "393 01" });
  });

  it("refuses anything that is not a company record", () => {
    expect(parseAresSubject({ kod: "NENALEZENO" })).toBeNull();
    expect(parseAresSubject(null)).toBeNull();
  });
});
