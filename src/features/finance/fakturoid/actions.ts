"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import type { Invoice } from "../types";
import { toFailure, type ActionResult } from "./errors";
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
 * always comes from the session; failures come back as codes, never thrown.
 */

const id = z.uuid();

async function session() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  return typeof userId === "string" && userId ? { supabase, userId } : null;
}

async function run<T>(
  work: (ctx: NonNullable<Awaited<ReturnType<typeof session>>>) => Promise<T>,
): Promise<ActionResult<T>> {
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

export async function fakturoidStatusAction(): Promise<ActionResult<FakturoidStatus>> {
  return run(({ userId }) => getFakturoidStatus(userId));
}

export async function connectFakturoidAction(
  input: FakturoidConnectInput,
): Promise<ActionResult<FakturoidStatus>> {
  return run(({ userId }) => connectFakturoid(userId, input));
}

export async function disconnectFakturoidAction(): Promise<ActionResult<null>> {
  return run(async ({ userId }) => {
    await disconnectFakturoid(userId);
    return null;
  });
}

export async function setMoveDealOnPaidAction(value: boolean): Promise<ActionResult<null>> {
  return run(async ({ userId }) => {
    await setMoveDealOnPaid(userId, z.boolean().parse(value));
    return null;
  });
}

export async function issueInvoiceAction(
  dealId: string,
): Promise<ActionResult<{ invoice: Invoice; external: boolean }>> {
  const parsed = id.safeParse(dealId);
  if (!parsed.success) return { ok: false, error: "dealNotFound" };
  return run(({ supabase, userId }) => issueInvoice(supabase, userId, parsed.data));
}

export async function markInvoicePaidAction(
  invoiceId: string,
): Promise<ActionResult<{ dealMoved: boolean }>> {
  const parsed = id.safeParse(invoiceId);
  if (!parsed.success) return { ok: false, error: "invoiceNotFound" };
  return run(({ supabase, userId }) => markInvoicePaid(supabase, userId, parsed.data));
}

export async function syncFakturoidAction(): Promise<ActionResult<SyncOutcome>> {
  return run(({ userId }) => syncUser(userId));
}
