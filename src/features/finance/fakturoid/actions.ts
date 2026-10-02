"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import type { Invoice } from "../types";
import { InvoiceError, toFailure, type ActionResult } from "./errors";
import type { FakturoidConnectInput, FakturoidStatus } from "./schema";
import {
  connectFakturoid,
  disconnectFakturoid,
  getFakturoidStatus,
  issueInvoice,
  markInvoicePaid,
  setMoveDealOnPaid,
  syncUser,
} from "./service";
import type { SyncOutcome } from "./workflow";

/**
 * Invoices and the Fakturoid connection, called from the screens. The user id
 * always comes from the session and the workspace from the database; a worker
 * needs the finance right, and the connection itself stays the owner's.
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

async function run<T>(work: (ctx: Ctx) => Promise<T>): Promise<ActionResult<T>> {
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

/** The Fakturoid connection is the owner's setting; a worker never touches it. */
function ownerOnly(ctx: Ctx) {
  if (ctx.workspaceId !== ctx.userId) throw new InvoiceError("forbidden");
}

/** A worker issues and settles invoices only with the right to edit finance. */
async function requireFinance(ctx: Ctx, level: "view" | "edit") {
  if (ctx.workspaceId === ctx.userId) return;
  const { data, error } = await ctx.supabase.rpc("has_section_access", {
    _owner: ctx.workspaceId,
    _section: "finance",
    _level: level,
  });
  if (error || !data) throw new InvoiceError("forbidden");
}

export async function fakturoidStatusAction(): Promise<ActionResult<FakturoidStatus>> {
  return run(async (ctx) => {
    await requireFinance(ctx, "view");
    return getFakturoidStatus(ctx.workspaceId);
  });
}

export async function connectFakturoidAction(
  input: FakturoidConnectInput,
): Promise<ActionResult<FakturoidStatus>> {
  return run((ctx) => {
    ownerOnly(ctx);
    return connectFakturoid(ctx.userId, input);
  });
}

export async function disconnectFakturoidAction(): Promise<ActionResult<null>> {
  return run(async (ctx) => {
    ownerOnly(ctx);
    await disconnectFakturoid(ctx.userId);
    return null;
  });
}

export async function setMoveDealOnPaidAction(value: boolean): Promise<ActionResult<null>> {
  return run(async (ctx) => {
    ownerOnly(ctx);
    await setMoveDealOnPaid(ctx.userId, z.boolean().parse(value));
    return null;
  });
}

export async function issueInvoiceAction(
  dealId: string,
): Promise<ActionResult<{ invoice: Invoice; external: boolean }>> {
  const parsed = id.safeParse(dealId);
  if (!parsed.success) return { ok: false, error: "dealNotFound" };
  return run(async (ctx) => {
    await requireFinance(ctx, "edit");
    return issueInvoice(ctx.supabase, ctx.workspaceId, parsed.data);
  });
}

export async function markInvoicePaidAction(
  invoiceId: string,
): Promise<ActionResult<{ dealMoved: boolean }>> {
  const parsed = id.safeParse(invoiceId);
  if (!parsed.success) return { ok: false, error: "invoiceNotFound" };
  return run(async (ctx) => {
    await requireFinance(ctx, "edit");
    return markInvoicePaid(ctx.supabase, ctx.workspaceId, parsed.data);
  });
}

export async function syncFakturoidAction(): Promise<ActionResult<SyncOutcome>> {
  return run(async (ctx) => {
    await requireFinance(ctx, "edit");
    return syncUser(ctx.workspaceId);
  });
}
