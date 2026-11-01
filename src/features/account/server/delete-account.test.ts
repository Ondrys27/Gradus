// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { deleteAccount } = await import("./delete-account");

const USER = { id: "11111111-1111-1111-1111-111111111111", email: "Jana@Example.com" };

function fakeAdmin(
  overrides: {
    blockers?: { data: string[] | null; error: unknown };
    objects?: { data: { bucket_id: string; name: string }[] | null; error: unknown };
    prepare?: { error: unknown };
    remove?: { error: unknown };
    deleteUser?: { error: unknown };
  } = {},
) {
  const rpc = vi.fn(async (name: string) => {
    if (name === "account_deletion_blockers")
      return overrides.blockers ?? { data: [], error: null };
    if (name === "account_storage_objects") return overrides.objects ?? { data: [], error: null };
    if (name === "account_prepare_deletion") return overrides.prepare ?? { error: null };
    throw new Error(`unexpected rpc ${name}`);
  });
  const remove = vi.fn(async () => overrides.remove ?? { error: null });
  const from = vi.fn(() => ({ remove }));
  const deleteUser = vi.fn(async () => overrides.deleteUser ?? { error: null });
  const admin = { rpc, storage: { from }, auth: { admin: { deleteUser } } };
  return { admin: admin as never, rpc, from, remove, deleteUser };
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("deleteAccount", () => {
  it("refuses an e-mail other than the account's and touches nothing", async () => {
    const fake = fakeAdmin();
    const result = await deleteAccount({ admin: fake.admin, user: USER, typedEmail: "jan@x.cz" });
    expect(result).toEqual({ ok: false, error: "emailMismatch" });
    expect(fake.rpc).not.toHaveBeenCalled();
    expect(fake.deleteUser).not.toHaveBeenCalled();
  });

  it("stops an owner with active workers before anything is removed", async () => {
    const fake = fakeAdmin({ blockers: { data: ["active_workers"], error: null } });
    const result = await deleteAccount({
      admin: fake.admin,
      user: USER,
      typedEmail: " jana@example.COM ",
    });
    expect(result).toEqual({ ok: false, error: "active_workers" });
    expect(fake.remove).not.toHaveBeenCalled();
    expect(fake.deleteUser).not.toHaveBeenCalled();
  });

  it("removes the files by bucket in batches, prepares, then deletes the user", async () => {
    const attachments = Array.from({ length: 150 }, (_, i) => ({
      bucket_id: "attachments",
      name: `${USER.id}/jarvis/${i}`,
    }));
    const fake = fakeAdmin({
      objects: {
        data: [
          { bucket_id: "avatars", name: `${USER.id}/avatar.webp` },
          ...attachments,
          // Never someone else's file, whatever the database returned.
          { bucket_id: "avatars", name: "22222222-2222-2222-2222-222222222222/avatar.webp" },
        ],
        error: null,
      },
    });
    const result = await deleteAccount({ admin: fake.admin, user: USER, typedEmail: USER.email });
    expect(result).toEqual({ ok: true, files: 151 });
    expect(fake.rpc).toHaveBeenCalledWith("account_deletion_blockers", { _user: USER.id });
    expect(fake.rpc).toHaveBeenCalledWith("account_prepare_deletion", { _user: USER.id });
    expect(fake.from).toHaveBeenCalledWith("avatars");
    expect(fake.remove).toHaveBeenCalledTimes(3);
    expect(fake.remove).toHaveBeenCalledWith([`${USER.id}/avatar.webp`]);
    const removed = fake.remove.mock.calls.flatMap((call) => (call as unknown[][])[0]);
    expect(removed.every((name) => String(name).startsWith(`${USER.id}/`))).toBe(true);
    expect(fake.deleteUser).toHaveBeenCalledWith(USER.id);
    // Prepared only after the files are gone, deleted last.
    const prepareOrder = fake.rpc.mock.invocationCallOrder[2];
    expect(fake.remove.mock.invocationCallOrder.every((n) => n < prepareOrder)).toBe(true);
    expect(fake.deleteUser.mock.invocationCallOrder[0]).toBeGreaterThan(prepareOrder);
  });

  it("keeps the account when the files cannot be removed", async () => {
    const fake = fakeAdmin({
      objects: { data: [{ bucket_id: "avatars", name: `${USER.id}/a.webp` }], error: null },
      remove: { error: { message: "storage down" } },
    });
    const result = await deleteAccount({ admin: fake.admin, user: USER, typedEmail: USER.email });
    expect(result).toEqual({ ok: false, error: "generic" });
    expect(fake.rpc).not.toHaveBeenCalledWith("account_prepare_deletion", expect.anything());
    expect(fake.deleteUser).not.toHaveBeenCalled();
  });

  it("passes on a blocker the database found at the last moment", async () => {
    const fake = fakeAdmin({ prepare: { error: { message: "active_workers" } } });
    const result = await deleteAccount({ admin: fake.admin, user: USER, typedEmail: USER.email });
    expect(result).toEqual({ ok: false, error: "active_workers" });
    expect(fake.deleteUser).not.toHaveBeenCalled();
  });

  it("reports a failed deletion in Auth", async () => {
    const fake = fakeAdmin({ deleteUser: { error: { message: "auth down" } } });
    const result = await deleteAccount({ admin: fake.admin, user: USER, typedEmail: USER.email });
    expect(result).toEqual({ ok: false, error: "generic" });
  });
});
