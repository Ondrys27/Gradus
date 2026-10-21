"use server";

import { z } from "zod";
import { isWorkspaceReadOnly } from "@/features/plan/server";
import { measure } from "@/lib/analytics/instrument";
import { createClient } from "@/lib/supabase/server";
import { INVOICE_COLUMNS, type Invoice } from "../types";
import { InvoiceError, toFailure, type ActionResult } from "./errors";

/**
 * Invoices, called from the screens. The user comes from the session and the
 * workspace from the database; a worker needs the right to edit finance.
 * Failures come back as codes, never thrown.
 */

const id = z.uuid();

async function session() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (typeof userId !== "string" || !userId) return null;
  // Invoices belong to the workspace (the owner's account); the database says whose.
  const { data: workspaceId, error } = await supabase.rpc("current_workspace_id");
  if (error || !workspaceId) return null;
  return { supabase, userId, workspaceId };
}

type Ctx = NonNullable<Awaited<ReturnType<typeof session>>>;

/** Every action is timed with its outcome (an error code, never data) for the health overview. */
function run<T>(name: string, work: (ctx: Ctx) => Promise<T>): Promise<ActionResult<T>> {
  return measure(`invoices.${name}`, () => runWork(work))();
}

async function runWork<T>(work: (ctx: Ctx) => Promise<T>): Promise<ActionResult<T>> {
  try {
    const ctx = await session();
    if (!ctx) return { ok: false, error: "unknown" };
    return { ok: true, data: await work(ctx) };
  } catch (error) {
    const failure = toFailure(error);
    if (failure.error === "unknown") console.error("invoice action failed", error);
    return failure;
  }
}

async function requireEditFinance(ctx: Ctx) {
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

const KEYS = INVOICE_COLUMNS.split(",").map((key) => key.trim()) as (keyof Invoice)[];

/** Only the columns the screens use, whatever a function returned. */
function pickInvoice(row: Record<string, unknown>): Invoice {
  return Object.fromEntries(KEYS.map((key) => [key, row[key] ?? null])) as Invoice;
}

export async function issueInvoiceAction(dealId: string): Promise<ActionResult<Invoice>> {
  const parsed = id.safeParse(dealId);
  if (!parsed.success) return { ok: false, error: "dealNotFound" };
  return run("issueInvoice", async (ctx) => {
    await requireEditFinance(ctx);
    const { data, error } = await ctx.supabase.rpc("create_invoice_from_deal", {
      _deal_id: parsed.data,
    });
    if (error) throw error;
    return pickInvoice(data);
  });
}

export async function markInvoicePaidAction(invoiceId: string): Promise<ActionResult<null>> {
  const parsed = id.safeParse(invoiceId);
  if (!parsed.success) return { ok: false, error: "invoiceNotFound" };
  return run("markInvoicePaid", async (ctx) => {
    await requireEditFinance(ctx);
    const { error } = await ctx.supabase.rpc("mark_invoice_paid", { _invoice_id: parsed.data });
    if (error) throw error;
    return null;
  });
}
