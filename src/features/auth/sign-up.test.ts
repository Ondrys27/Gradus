// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
const createUser = vi.fn();
const deleteUser = vi.fn();
const signInWithPassword = vi.fn();
const resend = vi.fn();
type Sent = { ok: true } | { ok: false; reason: "rateLimited" | "failed" };
type OpenInvite = { workerName: string; email: string | null; ownerName: string | null };
const sendConfirmation = vi.fn<(email: string, locale: string | null) => Promise<Sent>>(async () => ({ ok: true }));
const openInvite = vi.fn<(code: string) => Promise<OpenInvite | null>>(async () => null);
const confirmationRequired = vi.fn(async () => false);
const track = vi.fn(async () => {});
const codesLocked = vi.fn(async () => false);
const recordWrongCode = vi.fn(async () => {});
const requestHeaders = new Map<string, string>();
/** Every admin update: [table, values]; `failUpdate` makes the one of that table fail. */
const updates: [string, Record<string, unknown>][] = [];
let failUpdate: string | null = null;
const redirect = vi.fn((target: string) => {
  throw new Error(`redirect:${target}`);
});

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  redirect: (target: string) => redirect(target),
  RedirectType: { push: "push", replace: "replace" },
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ set: vi.fn() }),
  headers: async () => ({ get: (name: string) => requestHeaders.get(name) ?? null }),
}));
vi.mock("@/lib/analytics/track", () => ({ track }));
vi.mock("./code-attempts-server", () => ({
  codeGuard: async (email: string) => ({ keys: { ip: "ip", account: email }, exempt: false }),
  codesLocked: () => codesLocked(),
  recordWrongCode: (...args: unknown[]) => recordWrongCode(...(args as [])),
}));
vi.mock("next-intl/server", () => ({ getLocale: async () => "cs" }));
vi.mock("@/lib/site-origin", () => ({ siteOrigin: async () => "http://localhost:3000" }));
vi.mock("./worker-invite", () => ({ findOpenWorkerInvite: (code: string) => openInvite(code) }));
vi.mock("./server/confirmation", () => ({
  sendSignupConfirmation: (email: string, locale: string | null) => sendConfirmation(email, locale),
}));
vi.mock("./email-confirmation", () => ({
  isEmailConfirmationRequired: () => confirmationRequired(),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    auth: { admin: { createUser, deleteUser } },
    rpc,
    from: (table: string) => ({
      update: (values: Record<string, unknown>) => {
        updates.push([table, values]);
        return { eq: async () => ({ error: failUpdate === table ? { message: "boom" } : null }) };
      },
    }),
  }),
}));
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
  terms: "on",
};
const updateOf = (table: string, column: string) =>
  updates.find(([name, values]) => name === table && column in values)?.[1];

beforeEach(() => {
  vi.stubEnv("INVITE_CODE", "beta-2026");
  createUser.mockResolvedValue({ data: { user: { id: "new-user" } }, error: null });
  deleteUser.mockResolvedValue({ error: null });
  rpc.mockResolvedValue({ error: null });
  signInWithPassword.mockResolvedValue({ error: null });
  resend.mockResolvedValue({ error: null });
  sendConfirmation.mockResolvedValue({ ok: true });
  openInvite.mockResolvedValue(null);
  confirmationRequired.mockResolvedValue(false);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  updates.length = 0;
  failUpdate = null;
  requestHeaders.clear();
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
    expect(sendConfirmation).not.toHaveBeenCalled();
  });

  it("with confirmation on, leaves the account unconfirmed and asks to check the inbox", async () => {
    confirmationRequired.mockResolvedValue(true);
    const state = await signUp({}, form({ ...person, inviteCode: "beta-2026" }));
    expect(state).toEqual({ success: true, values: { email: "jana@example.com" } });
    expect(createUser).toHaveBeenCalledWith(expect.objectContaining({ email_confirm: false }));
    // The account is set up in full (beta), it only waits for the link.
    expect(rpc).toHaveBeenCalledWith("grant_beta_plan", { _user_id: "new-user" });
    // Gradus's own e-mail in the person's language (27.1), not Supabase's English one.
    expect(sendConfirmation).toHaveBeenCalledWith("jana@example.com", "cs");
    expect(resend).not.toHaveBeenCalled();
    expect(signInWithPassword).not.toHaveBeenCalled();
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it("a worker registering with the very e-mail of the invite needs no second confirmation", async () => {
    confirmationRequired.mockResolvedValue(true);
    openInvite.mockResolvedValue({ workerName: "Jana", email: "Jana@Example.com", ownerName: "Ondřej" });
    const code = "0123456789abcdef0123";
    await expect(signUp({}, form({ ...person, inviteCode: code }))).rejects.toThrow("redirect:/app");
    expect(createUser).toHaveBeenCalledWith(expect.objectContaining({ email_confirm: true }));
    expect(rpc).toHaveBeenCalledWith("accept_worker_invite", { _code: code, _user_id: "new-user" });
    expect(sendConfirmation).not.toHaveBeenCalled();
  });

  it("a worker invite without an e-mail still asks for the confirmation", async () => {
    confirmationRequired.mockResolvedValue(true);
    openInvite.mockResolvedValue({ workerName: "Jana", email: null, ownerName: null });
    const state = await signUp({}, form({ ...person, inviteCode: "0123456789abcdef0123" }));
    expect(state.success).toBe(true);
    expect(createUser).toHaveBeenCalledWith(expect.objectContaining({ email_confirm: false }));
    expect(sendConfirmation).toHaveBeenCalledWith("jana@example.com", "cs");
  });

  it("confirms the end-to-end tests' accounts at once outside production", async () => {
    confirmationRequired.mockResolvedValue(true);
    const e2e = { ...person, email: "e2e-register-game-ab12@gradus.local" };
    await expect(signUp({}, form({ ...e2e, inviteCode: "beta-2026" }))).rejects.toThrow(
      "redirect:/app",
    );
    expect(createUser).toHaveBeenCalledWith(expect.objectContaining({ email_confirm: true }));
    expect(sendConfirmation).not.toHaveBeenCalled();

    createUser.mockClear();
    vi.stubEnv("VERCEL_ENV", "production");
    const state = await signUp({}, form({ ...e2e, inviteCode: "beta-2026" }));
    expect(state.success).toBe(true);
    expect(createUser).toHaveBeenCalledWith(expect.objectContaining({ email_confirm: false }));
  });

  it("keeps the account when the confirmation e-mail fails; a new link can be sent", async () => {
    confirmationRequired.mockResolvedValue(true);
    sendConfirmation.mockResolvedValue({ ok: false, reason: "failed" });
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
    sendConfirmation.mockResolvedValue({ ok: true });
    const state = await resendConfirmation({}, form({ email: "nobody@example.com" }));
    expect(state.success).toBe(true);
    expect(sendConfirmation).toHaveBeenCalledWith("nobody@example.com", null);
    sendConfirmation.mockResolvedValue({ ok: false, reason: "failed" });
    expect((await resendConfirmation({}, form({ email: "nobody@example.com" }))).success).toBe(true);
  });

  it("reports a rate limit on resend", async () => {
    sendConfirmation.mockResolvedValue({ ok: false, reason: "rateLimited" });
    const state = await resendConfirmation({}, form({ email: "jana@example.com" }));
    expect(state.error).toBe("rateLimited");
  });
});

describe("consent to the terms", () => {
  beforeEach(() => vi.stubEnv("PUBLIC_SIGNUP_ENABLED", "true"));

  it("creates no account without it", async () => {
    const state = await signUp({}, form({ ...person, terms: "" }));
    expect(state.fieldErrors).toEqual({ terms: "termsRequired" });
    expect(createUser).not.toHaveBeenCalled();
  });

  it("records when, which version and the optional news consent on the server", async () => {
    await expect(signUp({}, form({ ...person, marketing: "on" }))).rejects.toThrow("redirect:/app");
    const consent = updateOf("profiles", "terms_accepted_at");
    expect(consent).toMatchObject({ terms_version: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });
    expect(consent?.terms_accepted_at).toEqual(expect.any(String));
    expect(consent?.marketing_consent_at).toBe(consent?.terms_accepted_at);

    updates.length = 0;
    await expect(signUp({}, form(person))).rejects.toThrow("redirect:/app");
    expect(updateOf("profiles", "terms_accepted_at")?.marketing_consent_at).toBeNull();
  });

  it("removes the account again when the consent can not be recorded", async () => {
    failUpdate = "profiles";
    const state = await signUp({}, form(person));
    expect(state.error).toBe("generic");
    expect(deleteUser).toHaveBeenCalledWith("new-user");
  });
});

describe("the plan picked on the website", () => {
  beforeEach(() => vi.stubEnv("PUBLIC_SIGNUP_ENABLED", "true"));

  it("stays with the trial as the selected plan and says where the sign-up came from", async () => {
    await expect(signUp({}, form({ ...person, plan: "team", billing: "yearly" }))).rejects.toThrow(
      "redirect:/app",
    );
    expect(updateOf("subscriptions", "chosen_plan_key")).toMatchObject({
      chosen_plan_key: "team",
      chosen_billing: "yearly",
    });
    expect(track).toHaveBeenCalledWith(
      "signup_completed",
      { from: "pricing", method: "trial", plan: "team", billing: "yearly", marketing_consent: false },
      expect.anything(),
    );
  });

  it("is ignored with an invitation and when it is no plan", async () => {
    await expect(
      signUp({}, form({ ...person, inviteCode: "beta-2026", plan: "pro", billing: "monthly" })),
    ).rejects.toThrow("redirect:/app");
    await expect(signUp({}, form({ ...person, plan: "beta" }))).rejects.toThrow("redirect:/app");
    expect(updateOf("subscriptions", "chosen_plan_key")).toBeUndefined();
    expect(track).toHaveBeenCalledWith(
      "signup_completed",
      expect.objectContaining({ from: "invite", method: "beta" }),
      expect.anything(),
    );
    expect(track).toHaveBeenCalledWith(
      "signup_completed",
      expect.objectContaining({ from: "web", method: "trial" }),
      expect.anything(),
    );
  });
});

describe("guessing codes", () => {
  beforeEach(() => vi.stubEnv("PUBLIC_SIGNUP_ENABLED", "true"));

  it("counts a wrong invite code", async () => {
    await signUp({}, form({ ...person, inviteCode: "wrong" }));
    expect(recordWrongCode).toHaveBeenCalledWith(expect.anything(), "invite", "submit");
  });

  it("refuses every code during a pause, a right one too, and creates nothing", async () => {
    codesLocked.mockResolvedValue(true);
    const state = await signUp({}, form({ ...person, inviteCode: "beta-2026" }));
    expect(state.error).toBe("tooManyCodeAttempts");
    expect(createUser).not.toHaveBeenCalled();
  });

  it("never holds back a registration without any code", async () => {
    codesLocked.mockResolvedValue(true);
    await expect(signUp({}, form(person))).rejects.toThrow("redirect:/app");
  });
});

describe("public sign-up in the end-to-end tests", () => {
  beforeEach(() => vi.stubEnv("PUBLIC_SIGNUP_ENABLED", "false"));
  const e2e = { ...person, email: "e2e-public-ab12@gradus.local" };

  it("opens only for the tests' own accounts with the header, outside production", async () => {
    requestHeaders.set("x-gradus-e2e-signup", "public");
    await expect(signUp({}, form(e2e))).rejects.toThrow("redirect:/app");
    expect(createUser).toHaveBeenCalledOnce();

    createUser.mockClear();
    expect((await signUp({}, form(person))).fieldErrors).toEqual({ inviteCode: "inviteRequired" });
    vi.stubEnv("VERCEL_ENV", "production");
    expect((await signUp({}, form(e2e))).fieldErrors).toEqual({ inviteCode: "inviteRequired" });
    requestHeaders.clear();
    vi.stubEnv("VERCEL_ENV", "preview");
    expect((await signUp({}, form(e2e))).fieldErrors).toEqual({ inviteCode: "inviteRequired" });
    expect(createUser).not.toHaveBeenCalled();
  });
});
