import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { ENV_CHECKS, envHealth } from "./env-health";

const row = (rows: ReturnType<typeof envHealth>, name: string) => rows.find((r) => r.name === name)!;

describe("envHealth", () => {
  it("marks present, missing and blank variables", () => {
    const rows = envHealth({ CRON_SECRET: "x", RESEND_API_KEY: "  " }, () => "ok");
    expect(row(rows, "CRON_SECRET").state).toBe("ok");
    expect(row(rows, "RESEND_API_KEY").state).toBe("missing");
    expect(row(rows, "ANTHROPIC_API_KEY").state).toBe("missing");
  });

  it("accepts the older name of a key", () => {
    const rows = envHealth({ SUPABASE_SERVICE_ROLE_KEY: "x" }, () => "ok");
    expect(row(rows, "SUPABASE_SECRET_KEY").state).toBe("ok");
  });

  it("takes the encryption key's state from its own check", () => {
    for (const state of ["ok", "missing", "invalid"] as const) {
      expect(row(envHealth({}, () => state), "INTEGRATIONS_ENCRYPTION_KEY").state).toBe(state);
    }
  });

  it("lists every variable once and never carries a value", () => {
    const names = ENV_CHECKS.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
    const rows = envHealth({ CRON_SECRET: "secret-value" }, () => "ok");
    expect(JSON.stringify(rows)).not.toContain("secret-value");
  });
});
