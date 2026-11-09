import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getTranslations } from "next-intl/server";
import Stripe from "stripe";
import type { CatalogAddOn, PlanCatalog } from "@/config/pricing";
import { planText, validatePlanAddOns, validatePlanCatalog } from "@/features/plan/catalog";
import { seedAddOns } from "@/features/plan/catalog-seed";
import { APP_NAME } from "@/lib/constants";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/types/database";
import { stripeClient } from "./client";
import type { StripeMode } from "./modes";
import {
  addOnPriceSpecs,
  catalogPriceSpecs,
  parseAddOnLookupKey,
  parseLookupKey,
  type AddOnPriceSpec,
  type PriceSpec,
} from "./prices";

/**
 * The published catalog version in Stripe (step 23.1): a Product per plan
 * (and one for extra workers), a Price per plan × currency × period of the
 * version. Made when a version is published and, lazily, at the first
 * Checkout that needs it. An existing Price is never changed (Stripe's are
 * immutable); publishing archives the prices of older versions, which keep
 * billing the subscriptions that use them until those change.
 */

type Admin = SupabaseClient<Database>;

export type PublishedVersion = {
  id: string;
  /** 1 for the first published version, counted by publication; never reused. */
  number: number;
  catalog: PlanCatalog;
  /** The version's add-ons (step 24.1); a version without any stored reads as the seed's. */
  addOns: CatalogAddOn[];
};

/** The published version straight from the database (never the cached seed: money depends on it). */
export async function loadPublishedVersion(admin: Admin = createAdminClient()): Promise<PublishedVersion> {
  const { data, error } = await admin
    .from("plan_catalog_versions")
    .select("id, payload, add_ons, published_at")
    .eq("status", "published")
    .maybeSingle();
  if (error) throw new Error(`plan catalog: ${error.code ?? error.message}`);
  if (!data?.published_at) throw new Error("plan catalog: nothing published");
  const parsed = validatePlanCatalog(data.payload);
  if (!parsed.ok) throw new Error("plan catalog: the published version is invalid");
  const addOns = data.add_ons === null ? { ok: true as const, addOns: seedAddOns() } : validatePlanAddOns(data.add_ons);
  if (!addOns.ok) throw new Error("plan catalog: the published add-ons are invalid");
  const { count, error: countError } = await admin
    .from("plan_catalog_versions")
    .select("id", { count: "exact", head: true })
    .neq("status", "draft")
    .lte("published_at", data.published_at);
  if (countError) throw new Error(`plan catalog: ${countError.code ?? countError.message}`);
  return { id: data.id, number: Math.max(1, count ?? 1), catalog: parsed.catalog, addOns: addOns.addOns };
}

const isMissing = (error: unknown) =>
  error instanceof Stripe.errors.StripeInvalidRequestError && error.code === "resource_missing";

async function ensureProduct(stripe: Stripe, id: string, name: string, kind: string) {
  try {
    const product = await stripe.products.retrieve(id);
    if (!product.active) await stripe.products.update(id, { active: true });
  } catch (error) {
    if (!isMissing(error)) throw error;
    await stripe.products.create(
      { id, name, metadata: { app: "gradus", kind } },
      { idempotencyKey: `product:${id}` },
    );
  }
}

async function productName(version: PublishedVersion, spec: AnySpec): Promise<string> {
  if (spec.type === "addon") {
    const addOn = version.addOns.find((candidate) => candidate.key === spec.addOn);
    return `${APP_NAME}: ${addOn ? planText(addOn.name, "cs") : spec.addOn}`;
  }
  if (spec.kind === "worker") {
    const t = await getTranslations({ locale: "cs", namespace: "billing.stripe" });
    return t("workerProduct", { appName: APP_NAME });
  }
  const plan = version.catalog.find((candidate) => candidate.key === spec.plan);
  return `${APP_NAME} ${plan ? planText(plan.name, "cs") : spec.plan}`;
}

/** A Price of a plan, of extra workers or of an add-on. */
type AnySpec = (PriceSpec & { type: "plan" }) | (AddOnPriceSpec & { type: "addon" });

const versionSpecs = (version: PublishedVersion): AnySpec[] => [
  ...catalogPriceSpecs(version.catalog, version.number).map((spec) => ({ ...spec, type: "plan" as const })),
  ...addOnPriceSpecs(version.addOns, version.number).map((spec) => ({ ...spec, type: "addon" as const })),
];

const specMetadata = (spec: AnySpec): Record<string, string> =>
  spec.type === "addon"
    ? { kind: "addon", add_on: spec.addOn, currency: spec.currency, billing: spec.billing, version: String(spec.version) }
    : { kind: spec.kind, plan: spec.plan, currency: spec.currency, billing: spec.billing, version: String(spec.version) };

/** Stripe's lookup_keys filter takes ten at a time. */
const LOOKUP_BATCH = 10;

/**
 * Makes whatever the version still lacks in Stripe and returns the price id
 * of every lookup key of the version.
 */
export async function ensureCatalogPrices(
  stripe: Stripe,
  mode: StripeMode,
  version: PublishedVersion,
): Promise<Map<string, string>> {
  const specs = versionSpecs(version);
  const found = new Map<string, Stripe.Price>();
  for (let index = 0; index < specs.length; index += LOOKUP_BATCH) {
    const keys = specs.slice(index, index + LOOKUP_BATCH).map((spec) => spec.lookupKey);
    const page = await stripe.prices.list({ lookup_keys: keys, limit: LOOKUP_BATCH });
    for (const price of page.data) if (price.lookup_key) found.set(price.lookup_key, price);
  }
  const products = new Set<string>();
  const ids = new Map<string, string>();
  for (const spec of specs) {
    const existing = found.get(spec.lookupKey);
    if (existing) {
      if (!existing.active) await stripe.prices.update(existing.id, { active: true });
      ids.set(spec.lookupKey, existing.id);
      continue;
    }
    if (!products.has(spec.productId)) {
      await ensureProduct(
        stripe,
        spec.productId,
        await productName(version, spec),
        spec.type === "addon" ? "addon" : spec.kind,
      );
      products.add(spec.productId);
    }
    const price = await stripe.prices.create(
      {
        product: spec.productId,
        currency: spec.currency.toLowerCase(),
        unit_amount: spec.unitAmount,
        recurring: { interval: spec.billing === "monthly" ? "month" : "year" },
        lookup_key: spec.lookupKey,
        // Catalog prices are final (not a VAT payer); BILLING_VAT_MODE=stripe_tax decides later.
        tax_behavior: "unspecified",
        metadata: { ...specMetadata(spec), catalog_version: version.id },
      },
      { idempotencyKey: `price:${mode}:${spec.lookupKey}` },
    );
    ids.set(spec.lookupKey, price.id);
  }
  return ids;
}

/** Archives the active prices of Gradus's products that belong to another version. */
async function archiveOlderPrices(stripe: Stripe, version: PublishedVersion) {
  const productIds = new Set(versionSpecs(version).map((spec) => spec.productId));
  for (const product of productIds) {
    for await (const price of stripe.prices.list({ product, active: true, limit: 100 })) {
      const key = parseLookupKey(price.lookup_key) ?? parseAddOnLookupKey(price.lookup_key);
      if (key && key.version !== version.number) await stripe.prices.update(price.id, { active: false });
    }
  }
}

/**
 * After a publish (or a version brought back): the new prices in Stripe,
 * the older ones archived. Without a usable key it does nothing.
 */
export async function syncStripeCatalog(): Promise<{ synced: boolean }> {
  const client = stripeClient();
  if (!client) return { synced: false };
  const version = await loadPublishedVersion();
  await ensureCatalogPrices(client.stripe, client.mode, version);
  await archiveOlderPrices(client.stripe, version);
  return { synced: true };
}
