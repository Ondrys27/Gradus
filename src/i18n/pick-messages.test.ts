import { describe, expect, it } from "vitest";
import { pickMessages } from "./pick-messages";

describe("pickMessages", () => {
  const messages = {
    marketing: { nav: { features: "Features" } },
    topBar: { account: { language: "Language" }, search: "Search" },
    app: { title: "App" },
  };

  it("keeps whole namespaces and nested paths, nothing else", () => {
    expect(pickMessages(messages, ["marketing", "topBar.account"])).toEqual({
      marketing: { nav: { features: "Features" } },
      topBar: { account: { language: "Language" } },
    });
  });

  it("skips paths that do not exist", () => {
    expect(pickMessages(messages, ["missing.part", "app"])).toEqual({ app: { title: "App" } });
  });
});
