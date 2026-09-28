import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import type { Database } from "@/types/database";
import { moveContact } from "./move-contact";

function clientReturning(result: { data: unknown; error: unknown }) {
  const rpc = vi.fn().mockResolvedValue(result);
  return { rpc, client: { rpc } as unknown as SupabaseClient<Database> };
}

describe("moveContact", () => {
  it("goes through the move_contact database function with the answers as given", async () => {
    const entry = { contact_id: "c1", table_id: "t2", answers: { f1: "yes" } };
    const { rpc, client } = clientReturning({ data: entry, error: null });

    const result = await moveContact(client, {
      contactId: "c1",
      tableId: "t2",
      answers: { f1: "yes", f2: true },
    });

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("move_contact", {
      _contact_id: "c1",
      _to_table_id: "t2",
      _answers: { f1: "yes", f2: true },
    });
    expect(result).toBe(entry);
  });

  it("throws the database error, so a refused move never looks done", async () => {
    const error = { code: "23514", message: "answer_required" };
    const { client } = clientReturning({ data: null, error });

    await expect(moveContact(client, { contactId: "c1", tableId: "t2", answers: {} })).rejects.toBe(
      error,
    );
  });
});
