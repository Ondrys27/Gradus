import { describe, expect, it, vi } from "vitest";
import { submitSupport, type PreparedSupport } from "./support";

function deps(stored: string | null = "id-1") {
  const store = vi.fn<(request: PreparedSupport) => Promise<string | null>>(async () => stored);
  const afterStored = vi.fn();
  return { userId: null, store, afterStored };
}

describe("submitSupport", () => {
  it("stores a valid request with a cleaned e-mail", async () => {
    const d = deps();
    const result = await submitSupport(
      { kind: "bug", description: "  Nejde přihlášení  ", email: " Jan@Example.com ", locale: "cs" },
      d,
    );
    expect(result).toEqual({ status: 200, body: { ok: true } });
    expect(d.store).toHaveBeenCalledWith({
      kind: "bug",
      description: "Nejde přihlášení",
      expected: null,
      email: "jan@example.com",
      locale: "cs",
      viewport: null,
    });
    expect(d.afterStored).toHaveBeenCalledOnce();
  });

  it("refuses an empty description, a bad e-mail and unknown fields", async () => {
    for (const payload of [
      { kind: "bug", description: "   " },
      { kind: "bug", description: "x", email: "not-an-email" },
      { kind: "bug", description: "x", page: "/app" },
      { kind: "nope", description: "x" },
      null,
    ]) {
      const d = deps();
      expect((await submitSupport(payload, d)).status).toBe(400);
      expect(d.store).not.toHaveBeenCalled();
    }
  });

  it("answers a filled honeypot like a person but stores nothing", async () => {
    const d = deps();
    const result = await submitSupport({ kind: "bug", description: "spam", website: "http://x" }, d);
    expect(result.status).toBe(200);
    expect(d.store).not.toHaveBeenCalled();
  });

  it("says limited when the hourly limit is reached", async () => {
    const d = deps(null);
    expect(await submitSupport({ kind: "idea", description: "x" }, d)).toEqual({
      status: 429,
      body: { error: "limited" },
    });
    expect(d.afterStored).not.toHaveBeenCalled();
  });
});
