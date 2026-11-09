import { describe, expect, it } from "vitest";
import {
  accountAllowedInMode,
  isSyntheticE2eEvent,
  modeAllowedInEnv,
  resolveStripeSetup,
  setupProblemMessage,
  stripeModeOfKey,
  vatModeOf,
} from "./modes";

describe("Stripe modes", () => {
  it("reads the mode from the key", () => {
    expect(stripeModeOfKey("sk_test_51Abc")).toBe("test");
    expect(stripeModeOfKey("rk_test_51Abc")).toBe("test");
    expect(stripeModeOfKey("sk_live_51Abc")).toBe("live");
    expect(stripeModeOfKey(" sk_live_51Abc ")).toBe("live");
    expect(stripeModeOfKey("pk_live_51Abc")).toBeNull();
    expect(stripeModeOfKey("")).toBeNull();
    expect(stripeModeOfKey(undefined)).toBeNull();
  });

  it("production takes only a live key, every other deployment only a test key", () => {
    expect(resolveStripeSetup({ STRIPE_SECRET_KEY: "sk_live_1", VERCEL_ENV: "production" })).toEqual({
      ok: true,
      mode: "live",
      secretKey: "sk_live_1",
    });
    expect(resolveStripeSetup({ STRIPE_SECRET_KEY: "sk_test_1", VERCEL_ENV: "production" })).toEqual({
      ok: false,
      problem: "wrong_env_key",
      mode: "test",
    });
    for (const env of ["preview", "development", undefined]) {
      expect(resolveStripeSetup({ STRIPE_SECRET_KEY: "sk_test_1", VERCEL_ENV: env })).toMatchObject({ ok: true, mode: "test" });
      expect(resolveStripeSetup({ STRIPE_SECRET_KEY: "sk_live_1", VERCEL_ENV: env })).toMatchObject({
        ok: false,
        problem: "wrong_env_key",
      });
    }
    expect(resolveStripeSetup({})).toEqual({ ok: false, problem: "missing_key", mode: null });
    expect(resolveStripeSetup({ STRIPE_SECRET_KEY: "whatever" })).toMatchObject({ ok: false, problem: "unknown_key" });
    expect(modeAllowedInEnv("live", "production")).toBe(true);
    expect(modeAllowedInEnv("test", "production")).toBe(false);
    expect(modeAllowedInEnv("test", "preview")).toBe(true);
  });

  it("says in the log what is wrong, never the key", () => {
    const message = setupProblemMessage("wrong_env_key", "production");
    expect(message).toMatch(/only a live key/);
    expect(message).not.toMatch(/sk_test_[A-Za-z0-9]{3}/);
  });

  it("test mode for internal and @gradus.local accounts, live for the others, never @gradus.local", () => {
    const local = { email: "e2e-a@gradus.local", internal: true };
    const localNotMarked = { email: "Someone@Gradus.Local", internal: false };
    const internal = { email: "ondrej@example.com", internal: true };
    const customer = { email: "jana@example.com", internal: false };
    expect(accountAllowedInMode("test", local)).toBe(true);
    expect(accountAllowedInMode("test", localNotMarked)).toBe(true);
    expect(accountAllowedInMode("test", internal)).toBe(true);
    expect(accountAllowedInMode("test", customer)).toBe(false);
    expect(accountAllowedInMode("live", customer)).toBe(true);
    expect(accountAllowedInMode("live", local)).toBe(false);
    expect(accountAllowedInMode("live", localNotMarked)).toBe(false);
    expect(accountAllowedInMode("live", internal)).toBe(false);
  });

  it("knows a synthetic end-to-end event: test mode, outside production, by its id", () => {
    expect(isSyntheticE2eEvent({ id: "evt_e2e_1", livemode: false }, "preview")).toBe(true);
    expect(isSyntheticE2eEvent({ id: "evt_e2e_1", livemode: false }, "production")).toBe(false);
    expect(isSyntheticE2eEvent({ id: "evt_e2e_1", livemode: true }, "preview")).toBe(false);
    expect(isSyntheticE2eEvent({ id: "evt_1Real", livemode: false }, "preview")).toBe(false);
  });

  it("keeps catalog prices final until Stripe Tax is switched on", () => {
    expect(vatModeOf(undefined)).toBe("none");
    expect(vatModeOf("none")).toBe("none");
    expect(vatModeOf("stripe_tax")).toBe("stripe_tax");
    expect(vatModeOf("other")).toBe("none");
  });
});
