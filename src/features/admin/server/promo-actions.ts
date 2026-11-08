"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import {
  promoCodeFormSchema,
  promoFormErrors,
  type PromoCodeFormInput,
  type PromoFormError,
} from "@/features/promo/codes";
import { ADMIN_PATH } from "../access";
import { ADMIN_FORMAT_SETTINGS } from "../format-metric";
import { validFromInstant, validToInstant } from "../promo-admin";
import { adminAccess, adminAccessFor } from "./guard";
import { fingerprint, requestInfo } from "./request-info";

/**
 * Settings → Promo codes. Codes are made, edited and switched off by the
 * owner or an admin (partner marketing); payouts are approved and marked
 * paid by the owner only (money). Every write goes through an admin_*
 * function with the user's own client, which checks the live admin session
 * from the signed token again and writes admin_audit in the same transaction.
 */

const PROMO_PATH = `${ADMIN_PATH}/promo-kody`;

export type PromoSaveResult =
  | { ok: true; id: string }
  | { ok: false; error: "invalid"; fields: PromoFormError[] }
  | { ok: false; error: "codeTaken" | "codeInUse" | "forbidden" | "failed" };

export async function savePromoCode(
  id: string | null,
  input: PromoCodeFormInput,
): Promise<PromoSaveResult> {
  const parsedId = id === null ? { success: true as const, data: null } : z.uuid().safeParse(id);
  const parsed = promoCodeFormSchema.safeParse(input);
  if (!parsedId.success) return { ok: false, error: "failed" };
  if (!parsed.success)
    return { ok: false, error: "invalid", fields: promoFormErrors(parsed.error) };
  if (!(await adminAccess(true))) return { ok: false, error: "forbidden" };

  const value = parsed.data;
  const tz = ADMIN_FORMAT_SETTINGS.timeZone;
  const { ip } = await requestInfo();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_promo_code_save", {
    _id: parsedId.data as string,
    _code: value.code,
    _partner_name: value.partnerName,
    _partner_email: value.partnerEmail as string,
    _partner_note: value.partnerNote as string,
    _kind: value.kind,
    _benefit: value.benefit,
    _benefit_value: value.benefitValue,
    _commission_percent: value.commissionPercent,
    // The generated types miss that these may be null (no limit).
    _max_uses: value.maxUses as number,
    _valid_from: validFromInstant(value.validFrom, tz) as string,
    _valid_to: validToInstant(value.validTo, tz) as string,
    _active: value.active,
    _ip_hash: fingerprint("ip", ip),
  });
  if (error) {
    if (error.code === "42501") return { ok: false, error: "forbidden" };
    if (error.code === "23505") return { ok: false, error: "codeTaken" };
    if (error.code === "55000") return { ok: false, error: "codeInUse" };
    if (error.code === "22023" || error.code === "23514")
      return { ok: false, error: "invalid", fields: [] };
    console.error("[admin] saving a promo code failed", error.message);
    return { ok: false, error: "failed" };
  }
  revalidatePath(PROMO_PATH);
  revalidatePath(`${PROMO_PATH}/${data}`);
  return { ok: true, id: String(data) };
}

export type PromoSimpleResult =
  { ok: true } | { ok: false; error: "forbidden" | "invalid" | "failed" };

export async function setPromoCodeActive(id: string, active: boolean): Promise<PromoSimpleResult> {
  const parsedId = z.uuid().safeParse(id);
  if (!parsedId.success || typeof active !== "boolean") return { ok: false, error: "invalid" };
  if (!(await adminAccess(true))) return { ok: false, error: "forbidden" };
  const { ip } = await requestInfo();
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_promo_code_set_active", {
    _id: parsedId.data,
    _active: active,
    _ip_hash: fingerprint("ip", ip),
  });
  if (error) {
    if (error.code === "42501") return { ok: false, error: "forbidden" };
    if (error.code === "22023") return { ok: false, error: "invalid" };
    console.error("[admin] switching a promo code failed", error.message);
    return { ok: false, error: "failed" };
  }
  revalidatePath(PROMO_PATH);
  revalidatePath(`${PROMO_PATH}/${parsedId.data}`);
  return { ok: true };
}

export type PayoutResult =
  { ok: true } | { ok: false; error: "forbidden" | "transition" | "invalid" | "failed" };

export async function setPayoutStatus(
  id: string,
  status: "pending" | "approved" | "paid",
): Promise<PayoutResult> {
  const parsedId = z.uuid().safeParse(id);
  const parsedStatus = z.enum(["pending", "approved", "paid"]).safeParse(status);
  if (!parsedId.success || !parsedStatus.success) return { ok: false, error: "invalid" };
  if (!(await adminAccessFor("managePayouts"))) return { ok: false, error: "forbidden" };
  const { ip } = await requestInfo();
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_partner_payout_set_status", {
    _id: parsedId.data,
    _status: parsedStatus.data,
    _ip_hash: fingerprint("ip", ip),
  });
  if (error) {
    if (error.code === "42501") return { ok: false, error: "forbidden" };
    if (error.code === "55000") return { ok: false, error: "transition" };
    if (error.code === "22023") return { ok: false, error: "invalid" };
    console.error("[admin] changing a payout failed", error.message);
    return { ok: false, error: "failed" };
  }
  revalidatePath(PROMO_PATH, "layout");
  return { ok: true };
}
