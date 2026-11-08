import { describe, expect, it } from "vitest";
import {
  ACTIVE_SPACE_COOKIE,
  isSpaceId,
  pathAfterSwitch,
  readSpaceCookie,
  spaceHeaders,
  spaceLinkPath,
  spaceName,
  toSpaces,
} from "./spaces";

const SPACE = "7c0b8f0e-5a4b-4c1d-9e2f-0a1b2c3d4e5f";

describe("the active space cookie", () => {
  it("reads only a space id", () => {
    expect(readSpaceCookie(`a=1; ${ACTIVE_SPACE_COOKIE}=${SPACE}; b=2`)).toBe(SPACE);
    expect(readSpaceCookie(`${ACTIVE_SPACE_COOKIE}=${encodeURIComponent(SPACE)}`)).toBe(SPACE);
    expect(readSpaceCookie(`${ACTIVE_SPACE_COOKIE}=not-a-space`)).toBeNull();
    expect(readSpaceCookie(`x${ACTIVE_SPACE_COOKIE}=${SPACE}`)).toBeNull();
    expect(readSpaceCookie("")).toBeNull();
    expect(readSpaceCookie(null)).toBeNull();
  });

  it("names the space to the database only when it is one", () => {
    expect(spaceHeaders(SPACE)).toEqual({ "x-gradus-space": SPACE });
    expect(spaceHeaders("'; drop table x; --")).toEqual({});
    expect(spaceHeaders(null)).toEqual({});
    expect(isSpaceId(SPACE.toUpperCase())).toBe(true);
    expect(isSpaceId(42)).toBe(false);
  });
});

describe("where a switch lands", () => {
  it("keeps the section, without the ids and filters of the other company", () => {
    expect(pathAfterSwitch("/app/pipeline")).toBe("/app/pipeline");
    expect(pathAfterSwitch("/app/finance/faktury/2f1d")).toBe("/app/finance");
    expect(pathAfterSwitch("/app/kontakty/")).toBe("/app/kontakty");
    expect(pathAfterSwitch("/app/ukoly-crm")).toBe("/app/ukoly-crm");
    expect(pathAfterSwitch("/app/firma")).toBe("/app/firma");
    expect(pathAfterSwitch("/app/odmeny")).toBe("/app/odmeny");
    expect(pathAfterSwitch("/app/nastaveni/predplatne")).toBe("/app/nastaveni");
  });

  it("goes to the dashboard from anywhere else", () => {
    expect(pathAfterSwitch("/app")).toBe("/app");
    expect(pathAfterSwitch("/app/test-chyby")).toBe("/app");
    expect(pathAfterSwitch("/")).toBe("/app");
  });

  it("links into a company by its id", () => {
    expect(spaceLinkPath(SPACE)).toBe(`/app/prostor/${SPACE}`);
  });
});

describe("the switcher's list", () => {
  it("keeps the rows it understands and trims the names", () => {
    const spaces = toSpaces([
      { space_id: SPACE, role: "owner", worker_id: null, company_name: " ", logo_url: "", owner_name: "Ondřej" },
      {
        space_id: "1c0b8f0e-5a4b-4c1d-9e2f-0a1b2c3d4e5f",
        role: "worker",
        worker_id: "w1",
        company_name: " Novák s.r.o. ",
        logo_url: "https://example.com/logo",
        owner_name: "Václav Novák",
      },
      { space_id: "nope", role: "worker", worker_id: null, company_name: null, logo_url: null, owner_name: null },
      { space_id: SPACE, role: "admin", worker_id: null, company_name: null, logo_url: null, owner_name: null },
    ]);
    expect(spaces).toHaveLength(2);
    expect(spaces[0]).toMatchObject({ role: "owner", companyName: null, logoUrl: null });
    expect(spaces[1]).toMatchObject({ companyName: "Novák s.r.o.", ownerName: "Václav Novák" });
    expect(spaceName(spaces[1])).toBe("Novák s.r.o.");
    expect(spaceName({ ...spaces[1], companyName: null })).toBe("Václav Novák");
    expect(toSpaces(null)).toEqual([]);
  });
});
