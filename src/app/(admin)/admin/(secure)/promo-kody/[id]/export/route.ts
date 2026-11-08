import type { NextRequest } from "next/server";
import { z } from "zod";
import { payoutsCsv } from "@/features/admin/promo-admin";
import { mayExport } from "@/features/admin/roles";
import { logAdminAction } from "@/features/admin/server/audit";
import { adminAccess, adminNotFound } from "@/features/admin/server/guard";
import { loadPromoCode, loadPromoPayouts } from "@/features/admin/server/promo-data";

export const dynamic = "force-dynamic";

/**
 * The payouts of one promo code as CSV for the accountant. It names the
 * partner (name, e-mail): the owner's only, an admin gets the 404. Written
 * to the audit before the file leaves; if that fails, nothing is exported.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const context = await adminAccess(true);
  if (!context || !mayExport(context.role, "promo_payouts")) return adminNotFound();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return adminNotFound();
  const code = await loadPromoCode(id);
  if (!code) return adminNotFound();
  const payouts = await loadPromoPayouts(id);
  if (!(await logAdminAction(context, "export", "promo_payouts", { code_id: id }))) {
    return new Response("Audit unavailable", { status: 503 });
  }
  const day = new Date().toISOString().slice(0, 10);
  return new Response(payoutsCsv(code, payouts), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="promo-payouts-${code.code}-${day}.csv"`,
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}
