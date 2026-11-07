import { describe, expect, it } from "vitest";
import { USERS_EXPORT_HEADER, usersCsv } from "./users-export";

describe("usersCsv", () => {
  it("has the id, the name and the e-mail of every account", () => {
    const csv = usersCsv(
      [
        {
          userId: "u-1",
          plan: "beta",
          status: "active",
          role: "owner",
          isInternal: false,
          signedUpAt: "2026-10-01T08:00:00Z",
          lastActiveAt: null,
          aiCostUsd: 1.2,
        },
      ],
      () => "Jana Nováková",
      (id) => (id === "u-1" ? "=jana@example.com" : null),
    );
    const [header, row] = csv.trim().split("\r\n");
    expect(header).toBe(USERS_EXPORT_HEADER.join(","));
    expect(header).toContain("email");
    // A cell a spreadsheet would read as a formula is defused.
    expect(row).toBe("u-1,Jana Nováková,'=jana@example.com,beta,active,owner,false,2026-10-01T08:00:00Z,,1.20");
  });
});
