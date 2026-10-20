import "server-only";
import type { PaidPlanKey, PlanCatalog } from "@/config/pricing";
import { validatePlanCatalog } from "@/features/plan/catalog";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The plan catalog for the administration: the published version, the
 * draft and the history. Read with the admin client after the page's guard
 * (the table is closed to every client).
 */

export type CatalogVersionStatus = "draft" | "published" | "archived";

export type CatalogVersion = {
  id: string;
  status: CatalogVersionStatus;
  createdAt: string;
  createdBy: string | null;
  publishedAt: string | null;
  publishedBy: string | null;
  catalog: PlanCatalog;
};

export type CatalogVersions = {
  published: CatalogVersion;
  draft: CatalogVersion | null;
  /** Earlier versions, newest first. */
  history: CatalogVersion[];
};

/** Enough history to bring back anything recent; older versions stay in the database. */
const HISTORY_LIMIT = 30;

const STATUSES: readonly CatalogVersionStatus[] = ["draft", "published", "archived"];

type VersionRow = {
  id: string;
  status: string;
  created_at: string;
  created_by: string | null;
  published_at: string | null;
  published_by: string | null;
  payload: unknown;
};

function toVersion(row: VersionRow): CatalogVersion | null {
  const parsed = validatePlanCatalog(row.payload);
  if (!parsed.ok || !STATUSES.includes(row.status as CatalogVersionStatus)) {
    console.error("[admin] plan catalog version unreadable", row.id);
    return null;
  }
  return {
    id: row.id,
    status: row.status as CatalogVersionStatus,
    createdAt: row.created_at,
    createdBy: row.created_by,
    publishedAt: row.published_at,
    publishedBy: row.published_by,
    catalog: parsed.catalog,
  };
}

const COLUMNS = "id, status, created_at, created_by, published_at, published_by, payload";

export async function loadCatalogVersions(): Promise<CatalogVersions> {
  const admin = createAdminClient();
  const [current, history] = await Promise.all([
    admin.from("plan_catalog_versions").select(COLUMNS).in("status", ["published", "draft"]),
    admin
      .from("plan_catalog_versions")
      .select(COLUMNS)
      .eq("status", "archived")
      .order("published_at", { ascending: false })
      .limit(HISTORY_LIMIT),
  ]);
  if (current.error) throw new Error(`plan catalog: ${current.error.message}`);
  if (history.error) throw new Error(`plan catalog history: ${history.error.message}`);
  const versions = current.data.map(toVersion);
  const published = versions.find((version) => version?.status === "published");
  if (!published) throw new Error("plan catalog: nothing published");
  return {
    published,
    draft: versions.find((version) => version?.status === "draft") ?? null,
    history: history.data.map(toVersion).filter((version): version is CatalogVersion => !!version),
  };
}

/** Per plan: accounts on it now, and how many of them hold more than its workers or storage limit. */
export type PlanImpact = { plan: PaidPlanKey; users: number; overLimit: number };

export async function loadCatalogImpact(catalog: PlanCatalog): Promise<PlanImpact[]> {
  const { data, error } = await createAdminClient().rpc("plan_catalog_impact", {
    _payload: catalog,
  });
  if (error) throw new Error(`plan_catalog_impact: ${error.message}`);
  return (data ?? []).map((row) => ({
    plan: row.plan_key as PaidPlanKey,
    users: row.users,
    overLimit: row.over_limit,
  }));
}
