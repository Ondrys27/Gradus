import "server-only";
import { unstable_cache } from "next/cache";
import type { PlanCatalog } from "@/config/pricing";
import { createAdminClient } from "@/lib/supabase/admin";
import { validatePlanCatalog } from "./catalog";
import { seedPlanCatalog } from "./catalog-seed";

/** Publishing or bringing back a version revalidates everything cached under this tag. */
export const PLAN_CATALOG_TAG = "plan-catalog";
/** Safety net for a publish made elsewhere (another deployment, the e2e run): minutes, not hours. */
const REVALIDATE_SECONDS = 300;

/**
 * Only the published row, never a draft: the cache and everything rendered
 * from it (the website, its SEO offers, the app) can hold nothing unpublished.
 * Throws when the row cannot be read or is invalid, so a failure is never cached.
 */
const loadPublished = unstable_cache(
  async (): Promise<PlanCatalog> => {
    const { data, error } = await createAdminClient()
      .from("plan_catalog_versions")
      .select("payload")
      .eq("status", "published")
      .maybeSingle();
    if (error) throw new Error(`plan catalog: ${error.message}`);
    if (!data) throw new Error("plan catalog: nothing published");
    const parsed = validatePlanCatalog(data.payload);
    if (!parsed.ok) throw new Error("plan catalog: the published version is invalid");
    return parsed.catalog;
  },
  ["plan-catalog-published"],
  { tags: [PLAN_CATALOG_TAG], revalidate: REVALIDATE_SECONDS },
);

/**
 * The plans in force, by order: prices, limits and card texts of the
 * published catalog version. Cached until the next publish. When the
 * database cannot be read the seed from src/config/pricing.ts stands in
 * (the version the first migration published), so a page never fails on it.
 */
export async function getPublishedPlans(): Promise<PlanCatalog> {
  try {
    return await loadPublished();
  } catch (error) {
    console.error("[plans] published catalog unavailable, showing the seed", error);
    return seedPlanCatalog();
  }
}
