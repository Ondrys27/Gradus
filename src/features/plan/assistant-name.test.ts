import { describe, expect, it } from "vitest";
import { withAssistantName, withAssistantNames } from "./assistant-name";

describe("the assistant's name in stored catalog texts", () => {
  it("says Grady, declined in Czech", () => {
    expect(withAssistantName("Asistent Jarvis")).toBe("Asistent Grady");
    expect(withAssistantName("Soubory do Jarvise")).toBe("Soubory do Gradyho");
    expect(withAssistantName("Řekni Jarvisovi")).toBe("Řekni Gradymu");
    expect(withAssistantName("s Jarvisem")).toBe("s Gradym");
    expect(withAssistantName("Files for Jarvis")).toBe("Files for Grady");
    expect(withAssistantName("Jarvis, your assistant")).toBe("Grady, your assistant");
  });

  it("leaves other texts and numbers alone", () => {
    const catalog = { name: { cs: "Pro" }, monthly: { EUR: 9.9 }, lines: [{ cs: "Jarvis" }] };
    expect(withAssistantNames(catalog)).toEqual({
      name: { cs: "Pro" },
      monthly: { EUR: 9.9 },
      lines: [{ cs: "Grady" }],
    });
  });
});
