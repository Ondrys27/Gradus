import { describe, expect, it } from "vitest";
import { peerChangePath, peerRecipients, type PeerCandidate } from "./peer-notices";

const person = (over: Partial<PeerCandidate>): PeerCandidate => ({
  userId: "u",
  role: "admin",
  level: "full",
  email: "u@gradus.cz",
  wantsMail: true,
  ...over,
});

describe("peerRecipients", () => {
  const owner = person({ userId: "owner", role: "owner", email: "ondrej@gradus.cz" });
  const vasa = person({ userId: "vasa", email: "vasa@gradus.cz" });
  const limited = person({ userId: "lim", level: "limited", email: "lim@gradus.cz" });

  it("tells the other of the pair, never the one who acted", () => {
    expect(peerRecipients({ userId: "vasa", email: "vasa@gradus.cz" }, [owner, vasa, limited]).map((p) => p.userId)).toEqual([
      "owner",
    ]);
    expect(peerRecipients({ userId: "owner", email: "ondrej@gradus.cz" }, [owner, vasa, limited]).map((p) => p.userId)).toEqual([
      "vasa",
    ]);
  });

  it("leaves out limited admins, people without an address and those who switched it off", () => {
    const off = person({ userId: "off", wantsMail: false });
    const noMail = person({ userId: "nomail", email: null });
    expect(peerRecipients({ userId: "x", email: "x@gradus.cz" }, [limited, off, noMail])).toEqual([]);
  });

  it("lets a test account reach only test accounts", () => {
    const e2e = person({ userId: "e2e", email: "e2e-peer@gradus.local" });
    expect(
      peerRecipients({ userId: "actor", email: "e2e-actor@gradus.local" }, [owner, e2e]).map((p) => p.userId),
    ).toEqual(["e2e"]);
  });

  it("names each person once", () => {
    expect(peerRecipients({ userId: "x", email: null }, [owner, owner])).toHaveLength(1);
  });
});

describe("peerChangePath", () => {
  it("points to the page of the change", () => {
    expect(peerChangePath("plansPublished")).toBe("/admin/tarify");
    expect(peerChangePath("aiUserCap")).toBe("/admin/ai");
  });
});
