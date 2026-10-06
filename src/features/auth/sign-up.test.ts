// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
const createUser = vi.fn();
const deleteUser = vi.fn();
const signInWithPassword = vi.fn();
const redirect = vi.fn((target: string) => {
  throw new Error(`redirect:${target}`);
});

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: (target: string) => redirect(target) }));
vi.mock("next/headers", () => ({ cookies: async () => ({ set: vi.fn() }) }));
vi.mock("next-intl/server", () => ({ getLocale: async () => "cs" }));
vi.mock("@/lib/site-origin", () => ({ siteOrigin: async () => "http://localhost:3000" }));
vi.mock("./worker-invite", () => ({ findOpenWorkerInvite: async () => null }));
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
  createClient: async () => ({ auth: { signInWithPassword } }),
}));

const { signUp } = await import("./actions");

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
    await expect(signUp({}, form({ ...person, inviteCode: "" }))).rejects.toThrow(
      "redirect:/app",
    );
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
