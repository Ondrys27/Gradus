// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
const createUser = vi.fn();
const deleteUser = vi.fn();
const signInWithPassword = vi.fn();
const resend = vi.fn();
const confirmationRequired = vi.fn(async () => false);
const redirect = vi.fn((target: string) => {
  throw new Error(`redirect:${target}`);
});

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  redirect: (target: string) => redirect(target),
  RedirectType: { push: "push", replace: "replace" },
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ set: vi.fn() }) }));
vi.mock("next-intl/server", () => ({ getLocale: async () => "cs" }));
vi.mock("@/lib/site-origin", () => ({ siteOrigin: async () => "http://localhost:3000" }));
vi.mock("./worker-invite", () => ({ findOpenWorkerInvite: async () => null }));
vi.mock("./email-confirmation", () => ({
  isEmailConfirmationRequired: () => confirmationRequired(),
}));
vi.mock("@/lib/supabase/admin", () => {
  const update = () => ({ eq: async () => ({ error: null }) });
  return {
    createAdminClient: () => ({
      auth: { admin: { createUser, deleteUser } },
      rpc,
      from: () => ({ update }),
    }),
  };
});
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { signInWithPassword, resend } }),
}));

const { resendConfirmation, signIn, signUp } = await import("./actions");

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

const person = {
  displayName: "Jana",
  email: "jana@example.com",
  password: "12345678",
  timeZone: "Europe/Prague",
};

beforeEach(() => {
  vi.stubEnv("INVITE_CODE", "beta-2026");
  createUser.mockResolvedValue({ data: { user: { id: "new-user" } }, error: null });
  deleteUser.mockResolvedValue({ error: null });
  rpc.mockResolvedValue({ error: null });
  signInWithPassword.mockResolvedValue({ error: null });
  resend.mockResolvedValue({ error: null });
  confirmationRequired.mockResolvedValue(false);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("signUp with PUBLIC_SIGNUP_ENABLED=false", () => {
  beforeEach(() => vi.stubEnv("PUBLIC_SIGNUP_ENABLED", "false"));

  it("refuses an account without an invite code", async () => {
    const state = await signUp({}, form({ ...person, inviteCode: "" }));
    expect(state.fieldErrors).toEqual({ inviteCode: "inviteRequired" });
    expect(createUser).not.toHaveBeenCalled();
  });

  it("creates a beta account with the invite code", async () => {
    await expect(signUp({}, form({ ...person, inviteCode: "beta-2026" }))).rejects.toThrow(
      "redirect:/app",
    );
    expect(createUser).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith("grant_beta_plan", { _user_id: "new-user" });
  });

  it("removes the account again when beta cannot be granted", async () => {
    rpc.mockResolvedValue({ error: { message: "boom" } });
    const state = await signUp({}, form({ ...person, inviteCode: "beta-2026" }));
    expect(state.error).toBe("generic");
    expect(deleteUser).toHaveBeenCalledWith("new-user");
  });
});

describe("signUp with PUBLIC_SIGNUP_ENABLED=true", () => {
  beforeEach(() => vi.stubEnv("PUBLIC_SIGNUP_ENABLED", "true"));

  it("creates an account without a code and leaves it on the trial", async () => {
    await expect(signUp({}, form({ ...person, inviteCode: "" }))).rejects.toThrow("redirect:/app");
    expect(createUser).toHaveBeenCalledOnce();
    expect(rpc).not.toHaveBeenCalledWith("grant_beta_plan", expect.anything());
  });

  it("still gives beta to someone with the invite code", async () => {
    await expect(signUp({}, form({ ...person, inviteCode: "beta-2026" }))).rejects.toThrow(
      "redirect:/app",
    );
    expect(rpc).toHaveBeenCalledWith("grant_beta_plan", { _user_id: "new-user" });
  });

  it("refuses a wrong code instead of starting a trial", async () => {
    const state = await signUp({}, form({ ...person, inviteCode: "wrong" }));
    expect(state.fieldErrors).toEqual({ inviteCode: "invalidInvite" });
    expect(createUser).not.toHaveBeenCalled();
  });
});

describe("e-mail confirmation", () => {
  beforeEach(() => vi.stubEnv("PUBLIC_SIGNUP_ENABLED", "false"));

  it("creates a confirmed account and signs in while Supabase confirms by itself", async () => {
    await expect(signUp({}, form({ ...person, inviteCode: "beta-2026" }))).rejects.toThrow(
      "redirect:/app",
    );
    expect(createUser).toHaveBeenCalledWith(expect.objectContaining({ email_confirm: true }));
    expect(resend).not.toHaveBeenCalled();
  });

  it("with confirmation on, leaves the account unconfirmed and asks to check the inbox", async () => {
    confirmationRequired.mockResolvedValue(true);
    const state = await signUp({}, form({ ...person, inviteCode: "beta-2026" }));
    expect(state).toEqual({ success: true, values: { email: "jana@example.com" } });
    expect(createUser).toHaveBeenCalledWith(expect.objectContaining({ email_confirm: false }));
    // The account is set up in full (beta), it only waits for the link.
    expect(rpc).toHaveBeenCalledWith("grant_beta_plan", { _user_id: "new-user" });
    expect(resend).toHaveBeenCalledWith(
      expect.objectContaining({ type: "signup", email: "jana@example.com" }),
    );
    expect(signInWithPassword).not.toHaveBeenCalled();
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it("keeps the account when the confirmation e-mail fails; a new link can be sent", async () => {
    confirmationRequired.mockResolvedValue(true);
    resend.mockResolvedValue({ error: { code: "unexpected_failure", status: 500 } });
    const state = await signUp({}, form({ ...person, inviteCode: "beta-2026" }));
    expect(state.success).toBe(true);
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it("tells an unconfirmed account at sign-in", async () => {
    signInWithPassword.mockResolvedValue({
      data: { user: null },
      error: { code: "email_not_confirmed", status: 400 },
    });
    const state = await signIn({}, form({ email: "jana@example.com", password: "12345678" }));
    expect(state.error).toBe("emailNotConfirmed");
    expect(state.values).toEqual({ email: "jana@example.com" });
  });

  it("resends the link and never reveals whether the account exists", async () => {
    resend.mockResolvedValue({ error: { code: "user_not_found", status: 400 } });
    const state = await resendConfirmation({}, form({ email: "nobody@example.com" }));
    expect(state.success).toBe(true);
    expect(resend).toHaveBeenCalledWith(expect.objectContaining({ type: "signup" }));
  });

  it("reports a rate limit on resend", async () => {
    resend.mockResolvedValue({ error: { code: "over_email_send_rate_limit", status: 429 } });
    const state = await resendConfirmation({}, form({ email: "jana@example.com" }));
    expect(state.error).toBe("rateLimited");
  });
});
