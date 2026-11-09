import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import { BILLING_PROFILE_COLUMNS, type BillingProfile } from "@/features/subscription/schemas";
import type { Database } from "@/types/database";
import { customerFields, type CustomerFields } from "./customer-fields";
import type { StripeMode } from "./modes";

/**
 * The workspace's Stripe customer (billing_customers, one per mode). It is
 * made at the first Checkout from the billing details and kept in step with
 * them afterwards: a change in Settings → Subscription goes to Stripe too.
 */

type Admin = SupabaseClient<Database>;

export async function storedCustomer(admin: Admin, workspace: string, mode: StripeMode): Promise<string | null> {
  const { data, error } = await admin
    .from("billing_customers")
    .select("stripe_customer_id")
    .eq("user_id", workspace)
    .eq("stripe_mode", mode)
    .maybeSingle();
  if (error) throw new Error(`billing_customers: ${error.code ?? error.message}`);
  return data?.stripe_customer_id ?? null;
}

async function billingProfile(admin: Admin, workspace: string): Promise<BillingProfile | null> {
  const { data, error } = await admin
    .from("billing_profiles")
    .select(BILLING_PROFILE_COLUMNS)
    .eq("user_id", workspace)
    .maybeSingle();
  if (error) throw new Error(`billing_profiles: ${error.code ?? error.message}`);
  return data ?? null;
}

function baseParams(fields: CustomerFields) {
  return {
    ...(fields.name ? { name: fields.name } : {}),
    ...(fields.email ? { email: fields.email } : {}),
    ...(fields.address ? { address: fields.address } : {}),
    metadata: fields.metadata,
    invoice_settings: { custom_fields: fields.invoiceCustomFields.length ? fields.invoiceCustomFields : ("" as const) },
    preferred_locales: fields.preferredLocales,
  };
}

const isTaxIdError = (error: unknown) =>
  error instanceof Stripe.errors.StripeInvalidRequestError &&
  (error.param?.startsWith("tax_id_data") || error.code === "tax_id_invalid");

/** The workspace's customer in this mode, made now when it has none. */
export async function ensureCustomer(
  stripe: Stripe,
  admin: Admin,
  input: { workspace: string; mode: StripeMode; email: string | null; locale: "cs" | "en" },
): Promise<string> {
  const existing = await storedCustomer(admin, input.workspace, input.mode);
  if (existing) return existing;
  const fields = customerFields({
    workspace: input.workspace,
    profile: await billingProfile(admin, input.workspace),
    email: input.email,
    locale: input.locale,
  });
  const params: Stripe.CustomerCreateParams = {
    ...baseParams(fields),
    invoice_settings: fields.invoiceCustomFields.length ? { custom_fields: fields.invoiceCustomFields } : undefined,
    ...(fields.euVat ? { tax_id_data: [{ type: "eu_vat", value: fields.euVat }] } : {}),
  };
  const idempotencyKey = `customer:${input.mode}:${input.workspace}`;
  let customer: Stripe.Customer;
  try {
    customer = await stripe.customers.create(params, { idempotencyKey });
  } catch (error) {
    // A VAT number Stripe does not take never stops a payment: the customer goes without it.
    if (!fields.euVat || !isTaxIdError(error)) throw error;
    customer = await stripe.customers.create(
      { ...params, tax_id_data: undefined },
      { idempotencyKey: `${idempotencyKey}:no-tax-id` },
    );
  }
  const { data, error } = await admin.rpc("billing_customer_save", {
    _user_id: input.workspace,
    _mode: input.mode,
    _customer_id: customer.id,
  });
  if (error) throw new Error(`billing_customer_save: ${error.code ?? error.message}`);
  return (data as string | null) ?? customer.id;
}

/**
 * The billing details changed in Gradus: the same on the Stripe customer,
 * the VAT number included. Nothing to do before the first Checkout.
 */
export async function syncCustomer(
  stripe: Stripe,
  admin: Admin,
  input: { workspace: string; mode: StripeMode; profile: BillingProfile; email: string | null; locale: "cs" | "en" },
): Promise<boolean> {
  const customerId = await storedCustomer(admin, input.workspace, input.mode);
  if (!customerId) return false;
  const fields = customerFields({
    workspace: input.workspace,
    profile: input.profile,
    email: input.email,
    locale: input.locale,
  });
  await stripe.customers.update(customerId, baseParams(fields));

  const taxIds = await stripe.customers.listTaxIds(customerId, { limit: 20 });
  const euVat = taxIds.data.filter((taxId) => taxId.type === "eu_vat");
  for (const taxId of euVat) {
    if (taxId.value !== fields.euVat) await stripe.customers.deleteTaxId(customerId, taxId.id);
  }
  if (fields.euVat && !euVat.some((taxId) => taxId.value === fields.euVat)) {
    try {
      await stripe.customers.createTaxId(customerId, { type: "eu_vat", value: fields.euVat });
    } catch (error) {
      if (!isTaxIdError(error)) throw error;
    }
  }
  return true;
}
