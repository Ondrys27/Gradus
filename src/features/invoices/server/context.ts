import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isWorkspaceReadOnly } from "@/features/plan/server";
import { createClient } from "@/lib/supabase/server";
import { toFormatSettings, USER_SETTINGS_COLUMNS } from "@/lib/user-settings";
import type { Database } from "@/types/database";
import { InvoiceError } from "../errors";

export type InvoiceContext = {
  supabase: SupabaseClient<Database>;
  userId: string;
  workspaceId: string;
  email: string | null;
};

/**
 * The signed-in user, from the session, and their workspace, from the
 * database. Invoices belong to the workspace (the owner's account).
 */
export async function invoiceContext(): Promise<InvoiceContext | null> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (typeof userId !== "string" || !userId) return null;
  const { data: workspaceId, error } = await supabase.rpc("current_workspace_id");
  if (error || !workspaceId) return null;
  const email = typeof data?.claims?.email === "string" ? data.claims.email : null;
  return { supabase, userId, workspaceId, email };
}

/** The owner always; a worker with the right to edit finance. Never in a read-only workspace. */
export async function requireEditFinance(ctx: InvoiceContext) {
  if (ctx.workspaceId !== ctx.userId) {
    const { data, error } = await ctx.supabase.rpc("has_section_access", {
      _owner: ctx.workspaceId,
      _section: "finance",
      _level: "edit",
    });
    if (error || !data) throw new InvoiceError("forbidden");
  }
  if (await isWorkspaceReadOnly(ctx.supabase, ctx.workspaceId)) {
    throw new InvoiceError("readOnly");
  }
}

/** The supplier's details are the owner's alone. */
export function requireOwner(ctx: InvoiceContext) {
  if (ctx.workspaceId !== ctx.userId) throw new InvoiceError("ownerOnly");
}

/** The caller's own formats (numbers, dates) and the owner's country. */
export async function loadFormats(ctx: InvoiceContext) {
  const { data, error } = await ctx.supabase
    .from("user_settings")
    .select(USER_SETTINGS_COLUMNS)
    .eq("user_id", ctx.userId)
    .maybeSingle();
  if (error) throw error;
  return { settings: toFormatSettings(data), locale: data?.locale ?? "cs" };
}
