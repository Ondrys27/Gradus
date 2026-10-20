"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { z } from "zod";
import type { PlanCatalog } from "@/config/pricing";
import { validatePlanCatalog, type CatalogIssue } from "@/features/plan/catalog";
import { PLAN_CATALOG_TAG } from "@/features/plan/catalog-server";
import { LOCALIZED_PAGES, PLAN_PATH } from "@/lib/routes";
import { createClient } from "@/lib/supabase/server";
import { ADMIN_PATH } from "../access";
import { adminAccessFor } from "./guard";
import { loadCatalogImpact, type PlanImpact } from "./plans-data";
import { fingerprint, requestInfo } from "./request-info";

/**
 * The plan catalog changed from the administration. Each action checks the
 * owner's admin session (role owner, aal2) first; an admin only reads the
 * catalog. The database function then checks it once more from the signed
 * token, writes and records the step in admin_audit, all in one transaction.
 * Only publishing and bringing back a version touch what visitors see; then
 * the cached catalog and the pages built from it are revalidated.
 */

export type PlansActionError = "invalid" | "forbidden" | "stale" | "failed";
export type PlansActionResult<T = object> =
  | ({ ok: true } & T)
  | { ok: false; error: PlansActionError; issues?: CatalogIssue[] };

const PAGE = `${ADMIN_PATH}/tarify`;
const idSchema = z.uuid();

async function ipHash(): Promise<string | undefined> {
  const { ip } = await requestInfo();
  return fingerprint("ip", ip);
}

/** The database refused: the session (42501), the value (22023) or a newer version ('stale'). */
function refused(error: { code?: string; message: string }): { ok: false; error: PlansActionError } {
  if (error.code === "42501") return { ok: false, error: "forbidden" };
  if (error.code === "22023") return { ok: false, error: "invalid" };
  if (error.message.includes("stale")) return { ok: false, error: "stale" };
  console.error("[admin] plan catalog write failed", error.message);
  return { ok: false, error: "failed" };
}

function parse(input: unknown): { ok: true; catalog: PlanCatalog } | { ok: false; error: "invalid"; issues: CatalogIssue[] } {
  const parsed = validatePlanCatalog(input);
  return parsed.ok ? parsed : { ok: false, error: "invalid", issues: parsed.issues };
}

/** Everything that shows the published plans: the website in both languages and the app. */
function revalidatePublished() {
  revalidateTag(PLAN_CATALOG_TAG);
  for (const path of [
    LOCALIZED_PAGES.home.cs,
    LOCALIZED_PAGES.home.en,
    LOCALIZED_PAGES.pricing.cs,
    LOCALIZED_PAGES.pricing.en,
    PLAN_PATH,
  ]) {
    revalidatePath(path);
  }
  revalidatePath(PAGE);
}

/** Saves the draft; nothing is published. Returns the catalog as it was saved. */
export async function savePlanDraft(input: unknown): Promise<PlansActionResult<{ catalog: PlanCatalog }>> {
  const parsed = parse(input);
  if (!parsed.ok) return parsed;
  if (!(await adminAccessFor("editPlans"))) return { ok: false, error: "forbidden" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_plan_catalog_save_draft", {
    _payload: parsed.catalog,
    _ip_hash: await ipHash(),
  });
  if (error) return refused(error);
  revalidatePath(PAGE);
  return { ok: true, catalog: parsed.catalog };
}

export async function discardPlanDraft(): Promise<PlansActionResult> {
  if (!(await adminAccessFor("editPlans"))) return { ok: false, error: "forbidden" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_plan_catalog_discard_draft", {
    _ip_hash: await ipHash(),
  });
  if (error) return refused(error);
  revalidatePath(PAGE);
  return { ok: true };
}

/** For the confirmation: how many accounts each plan has and how many would be over its limits. */
export async function planCatalogImpact(input: unknown): Promise<PlansActionResult<{ impact: PlanImpact[] }>> {
  const parsed = parse(input);
  if (!parsed.ok) return parsed;
  if (!(await adminAccessFor("editPlans"))) return { ok: false, error: "forbidden" };
  try {
    return { ok: true, impact: await loadCatalogImpact(parsed.catalog) };
  } catch (error) {
    console.error("[admin] plan catalog impact failed", error);
    return { ok: false, error: "failed" };
  }
}

/**
 * Publishes the saved draft. `catalog` is what the owner confirmed and
 * `expected` the version the confirmation compared it with; when either
 * changed meanwhile the database refuses ('stale') and nothing is published.
 */
export async function publishPlanCatalog(
  input: unknown,
  expected: string,
): Promise<PlansActionResult> {
  const parsed = parse(input);
  if (!parsed.ok) return parsed;
  const expectedId = idSchema.safeParse(expected);
  if (!expectedId.success) return { ok: false, error: "invalid" };
  if (!(await adminAccessFor("editPlans"))) return { ok: false, error: "forbidden" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_plan_catalog_publish", {
    _payload: parsed.catalog,
    _expected: expectedId.data,
    _ip_hash: await ipHash(),
  });
  if (error) return refused(error);
  revalidatePublished();
  return { ok: true };
}

/** Brings back an earlier version: publishes a copy of it. */
export async function restorePlanVersion(
  version: string,
  expected: string,
): Promise<PlansActionResult> {
  const versionId = idSchema.safeParse(version);
  const expectedId = idSchema.safeParse(expected);
  if (!versionId.success || !expectedId.success) return { ok: false, error: "invalid" };
  if (!(await adminAccessFor("editPlans"))) return { ok: false, error: "forbidden" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_plan_catalog_restore", {
    _version: versionId.data,
    _expected: expectedId.data,
    _ip_hash: await ipHash(),
  });
  if (error) return refused(error);
  revalidatePublished();
  return { ok: true };
}
