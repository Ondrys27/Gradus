import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionContext } from "./queries";
import type { WorkerAccount } from "./types";
import { useCan, useWorkspace, workspaceKeys } from "./workspace-queries";

const OWNER = "00000000-0000-4000-8000-000000000001";
const WORKER = "00000000-0000-4000-8000-000000000002";

/** What the database returns for the worker's own record and rights. */
let remote: {
  status: string;
  permissions: { section: string; can_view: boolean; can_edit: boolean }[];
};

vi.mock("@/lib/supabase/client", () => {
  const query = (table: string) => {
    const builder = {
      select: () => builder,
      eq: () => builder,
      limit: () =>
        Promise.resolve(
          table === "worker_permissions"
            ? { data: remote.permissions, error: null }
            : { data: null, error: null },
        ),
      maybeSingle: () => Promise.resolve({ data: { status: remote.status }, error: null }),
    };
    return builder;
  };
  return { createClient: () => ({ from: query }) };
});

function wrapper(worker: WorkerAccount | null, client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <SessionContext.Provider
          value={{
            user: { id: worker ? WORKER : OWNER, email: "x@example.com" },
            roles: [],
            worker,
          }}
        >
          {children}
        </SessionContext.Provider>
      </QueryClientProvider>
    );
  };
}

const caller: WorkerAccount = {
  id: "worker-1",
  ownerId: OWNER,
  name: "Pepa",
  jobTitle: null,
  permissions: {
    contacts: { view: true, edit: true },
    cold_calling: { view: true, edit: true },
  },
};

let client: QueryClient;

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  remote = {
    status: "active",
    permissions: [
      { section: "contacts", can_view: true, can_edit: true },
      { section: "cold_calling", can_view: true, can_edit: true },
    ],
  };
});

afterEach(() => {
  client.clear();
});

describe("useWorkspace", () => {
  it("is the owner's own space, with every right, for an owner", () => {
    const { result } = renderHook(
      () => ({ workspace: useWorkspace(), finance: useCan("finance", "edit") }),
      { wrapper: wrapper(null, client) },
    );
    expect(result.current.workspace).toMatchObject({ id: OWNER, role: "owner", workerId: null });
    expect(result.current.finance).toBe(true);
  });

  it("is the owner's space for a worker, with the rights loaded at start", () => {
    const { result } = renderHook(
      () => ({
        workspace: useWorkspace(),
        contacts: useCan("contacts", "edit"),
        finance: useCan("finance", "view"),
      }),
      { wrapper: wrapper(caller, client) },
    );
    expect(result.current.workspace).toMatchObject({
      id: OWNER,
      role: "worker",
      userId: WORKER,
      workerId: "worker-1",
    });
    expect(result.current.contacts).toBe(true);
    expect(result.current.finance).toBe(false);
  });

  it("follows a change of rights without signing out", async () => {
    const { result } = renderHook(() => useCan("contacts", "view"), {
      wrapper: wrapper(caller, client),
    });
    expect(result.current).toBe(true);

    // The owner takes contacts away; the next read (live channel, focus or interval) sees it.
    remote.permissions = [{ section: "contacts", can_view: false, can_edit: false }];
    await act(() =>
      client.invalidateQueries({ queryKey: workspaceKeys.access(WORKER, "worker-1") }),
    );
    await waitFor(() => expect(result.current).toBe(false));
  });
});
