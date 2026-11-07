import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const sendEmail = vi.fn(async () => ({ ok: true as const, id: "re_1" }));
vi.mock("./resend", () => ({ sendEmail }));

const { deliverEmail, e2eOutboxAllowed, e2eOutboxKey, keepE2eMail, readE2eMail } = await import(
  "./e2e-outbox"
);

const MAIL = { subject: "S", text: "T", html: "<p>T</p>" };

describe("the mock Resend of the end-to-end tests", () => {
  beforeEach(() => {
    sendEmail.mockClear();
    vi.stubEnv("VERCEL_ENV", "development");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("keeps mail to a test account instead of sending it", async () => {
    const to = `e2e-outbox-${crypto.randomUUID().slice(0, 8)}@gradus.local`;
    expect(await deliverEmail({ to, ...MAIL })).toEqual({ ok: true, id: null });
    expect(sendEmail).not.toHaveBeenCalled();
    expect(readE2eMail(to.toUpperCase()).map((mail) => mail.subject)).toEqual(["S"]);
  });

  it("sends nothing to other internal addresses and real mail to everyone else", async () => {
    expect((await deliverEmail({ to: "demo@gradus.local", ...MAIL })).ok).toBe(false);
    expect(sendEmail).not.toHaveBeenCalled();
    await deliverEmail({ to: "jana@example.com", ...MAIL });
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it("is real mail in production, where no test account exists", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    const to = "e2e-prod@gradus.local";
    expect((await deliverEmail({ to, ...MAIL })).ok).toBe(false);
    expect(readE2eMail(to)).toEqual([]);
  });

  it("forgets mail after ten minutes", () => {
    const to = "e2e-old-12345678@gradus.local";
    keepE2eMail({ to, ...MAIL }, 0);
    expect(readE2eMail(to, 9 * 60_000)).toHaveLength(1);
    expect(readE2eMail(to, 11 * 60_000)).toHaveLength(0);
  });

  it("opens the outbox only outside production and with the derived key", () => {
    const key = e2eOutboxKey("secret");
    expect(key).not.toContain("secret");
    expect(e2eOutboxAllowed(key, "secret", "development")).toBe(true);
    expect(e2eOutboxAllowed(key, "secret", "production")).toBe(false);
    expect(e2eOutboxAllowed(e2eOutboxKey("other"), "secret", "development")).toBe(false);
    expect(e2eOutboxAllowed(null, "secret", "development")).toBe(false);
    expect(e2eOutboxAllowed(key, undefined, "development")).toBe(false);
  });
});
