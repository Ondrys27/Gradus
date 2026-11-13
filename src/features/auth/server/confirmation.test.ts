// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
const getUserById = vi.fn();
const generateLink = vi.fn();
const updateUserById = vi.fn(async () => ({ error: null }));
const deliverEmail = vi.fn(async () => ({ ok: true, id: null }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/site-origin", () => ({ siteOrigin: async () => "https://gradus.test" }));
vi.mock("@/lib/email/e2e-outbox", () => ({ deliverEmail: (message: unknown) => deliverEmail(message as never) }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc, auth: { admin: { getUserById, generateLink, updateUserById } } }),
}));

const { sendSignupConfirmation, CONFIRMATION_RESEND_MS } = await import("./confirmation");

const now = Date.parse("2026-11-13T19:15:31Z");
const user = (extra: Record<string, unknown> = {}) => ({
  data: {
    user: {
      id: "u1",
      email: "jana@seznam.cz",
      email_confirmed_at: null,
      app_metadata: { provider: "email" },
      user_metadata: { locale: "en" },
      ...extra,
    },
  },
  error: null,
});

beforeEach(() => {
  vi.clearAllMocks();
  rpc.mockResolvedValue({ data: "u1", error: null });
  getUserById.mockResolvedValue(user());
  generateLink.mockResolvedValue({ data: { properties: { hashed_token: "hash" } }, error: null });
});

describe("sendSignupConfirmation", () => {
  it("sends Gradus's e-mail in the given language with a one-time link and remembers when", async () => {
    expect(await sendSignupConfirmation("jana@seznam.cz", "cs", now)).toEqual({ ok: true });
    expect(generateLink).toHaveBeenCalledWith({ type: "magiclink", email: "jana@seznam.cz" });
    const [mail] = deliverEmail.mock.calls[0] as unknown as [{ to: string; subject: string; html: string }];
    expect(mail.to).toBe("jana@seznam.cz");
    expect(mail.html).toContain('lang="cs"');
    expect(mail.html).toContain("https://gradus.test/auth/confirm?token_hash=hash&amp;type=magiclink");
    expect(updateUserById).toHaveBeenCalledWith("u1", {
      app_metadata: { provider: "email", confirmation_mail_at: new Date(now).toISOString() },
    });
  });

  it("falls back to the account's own language", async () => {
    await sendSignupConfirmation("jana@seznam.cz", null, now);
    const [mail] = deliverEmail.mock.calls[0] as unknown as [{ html: string }];
    expect(mail.html).toContain('lang="en"');
  });

  it("sends nothing for an unknown or already confirmed address, and says nothing about it", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    expect(await sendSignupConfirmation("nobody@example.com", "cs", now)).toEqual({ ok: true });
    rpc.mockResolvedValue({ data: "u1", error: null });
    getUserById.mockResolvedValue(user({ email_confirmed_at: "2026-11-13T19:00:00Z" }));
    expect(await sendSignupConfirmation("jana@seznam.cz", "cs", now)).toEqual({ ok: true });
    expect(deliverEmail).not.toHaveBeenCalled();
  });

  it("pauses a minute between links", async () => {
    getUserById.mockResolvedValue(
      user({ app_metadata: { confirmation_mail_at: new Date(now - CONFIRMATION_RESEND_MS + 1000).toISOString() } }),
    );
    expect(await sendSignupConfirmation("jana@seznam.cz", "cs", now)).toEqual({ ok: false, reason: "rateLimited" });
    expect(deliverEmail).not.toHaveBeenCalled();
  });

  it("reports a failed link or e-mail", async () => {
    generateLink.mockResolvedValue({ data: { properties: null }, error: { code: "boom" } });
    expect(await sendSignupConfirmation("jana@seznam.cz", "cs", now)).toEqual({ ok: false, reason: "failed" });
    generateLink.mockResolvedValue({ data: { properties: { hashed_token: "hash" } }, error: null });
    deliverEmail.mockResolvedValueOnce({ ok: false, error: "down" } as never);
    expect(await sendSignupConfirmation("jana@seznam.cz", "cs", now)).toEqual({ ok: false, reason: "failed" });
  });
});
