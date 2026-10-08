import { describe, expect, it } from "vitest";
import { z } from "zod";
import { EVENTS, parseEvent, SCRUBBED_TEXT_EVENTS, type EventName } from "./events";
import { field, isSafeField, isScrubbedTextField } from "./fields";
import { scrubMessage } from "./scrub";

const names = Object.keys(EVENTS) as EventName[];

describe("the catalog", () => {
  it("builds every property from the safe fields only", () => {
    for (const name of names) {
      for (const [prop, schema] of Object.entries(EVENTS[name].props)) {
        expect(isSafeField(schema), `${name}.${prop}`).toBe(true);
      }
    }
  });

  it("allows the scrubbed error text only where it is listed", () => {
    for (const name of names) {
      for (const [prop, schema] of Object.entries(EVENTS[name].props)) {
        if (isScrubbedTextField(schema as z.ZodType)) {
          expect(SCRUBBED_TEXT_EVENTS, `${name}.${prop}`).toContain(name);
        }
      }
    }
  });

  it("names events in snake case, as the database requires", () => {
    for (const name of names) expect(name).toMatch(/^[a-z][a-z0-9_]{1,63}$/);
  });

  it("refuses to wrap a schema that is not a catalog field", () => {
    expect(() => field.optional(z.string())).toThrow();
    expect(isSafeField(z.string())).toBe(false);
  });
});

describe("parseEvent", () => {
  it("accepts a valid event", () => {
    expect(parseEvent("task_created", { depth: 1, is_subtask: true }, "client")).toEqual({
      ok: true,
      event: "task_created",
      props: { depth: 1, is_subtask: true },
    });
  });

  it("refuses an unknown property, such as a title or a user id", () => {
    expect(
      parseEvent("task_created", { depth: 0, is_subtask: false, title: "Call Novák" }, "client"),
    ).toEqual({ ok: false, reason: "invalidProps" });
    expect(
      parseEvent(
        "task_created",
        { depth: 0, is_subtask: false, user_id: crypto.randomUUID() },
        "client",
      ),
    ).toEqual({ ok: false, reason: "invalidProps" });
  });

  it("refuses free text in an identifier or an enum", () => {
    // A sentence where a code belongs.
    expect(
      parseEvent("achievement_earned", { achievement: "Jan Novák won a deal" }, "client").ok,
    ).toBe(false);
    // An e-mail, a phone number.
    expect(parseEvent("achievement_earned", { achievement: "jan@example.com" }, "client").ok).toBe(
      false,
    );
    expect(parseEvent("achievement_earned", { achievement: "777123456" }, "client").ok).toBe(false);
    // A value outside the enum.
    expect(
      parseEvent("calendar_event_created", { kind: "lunch with Eva", has_contact: false }, "client")
        .ok,
    ).toBe(false);
    // A currency that is not a code.
    expect(parseEvent("deal_created", { currency: "Kč", has_contact: true }, "client").ok).toBe(
      false,
    );
    // A string where a number belongs.
    expect(
      parseEvent(
        "search_performed",
        { query_length: "kadeřnictví", results: 3, filtered: false },
        "client",
      ).ok,
    ).toBe(false);
  });

  it("refuses an error message that was not scrubbed", () => {
    const base = { route: "/app", source: "onerror" } as const;
    expect(
      parseEvent("client_error", { ...base, message: "failed for jan@example.com" }, "client").ok,
    ).toBe(false);
    expect(
      parseEvent("client_error", { ...base, message: "id 1234567 missing" }, "client").ok,
    ).toBe(false);
    expect(parseEvent("client_error", { ...base, message: "x".repeat(201) }, "client").ok).toBe(
      false,
    );
    expect(
      parseEvent(
        "client_error",
        { ...base, message: scrubMessage("failed for jan@example.com, id 1234567") },
        "client",
      ).ok,
    ).toBe(true);
  });

  it("refuses unknown events and server events from the browser", () => {
    expect(parseEvent("contact_name_typed", {}, "client")).toEqual({
      ok: false,
      reason: "unknownEvent",
    });
    expect(parseEvent("account_registered", { method: "beta" }, "client")).toEqual({
      ok: false,
      reason: "notAllowedHere",
    });
    expect(parseEvent("account_registered", { method: "beta" }, "server").ok).toBe(true);
  });
});
