import { getTranslations } from "next-intl/server";
import { StatusPill } from "@/components/ui/status-pill";
import type { Tone } from "@/components/ui/tone";
import { promoCodeState, type PromoCodeState } from "@/features/promo/codes";
import { formatCurrency } from "@/lib/format";
import { ADMIN_FORMAT_SETTINGS } from "../format-metric";
import { validFromDay, validToDay } from "../promo-admin";
import type { PromoCodeRow, PromoCodeWithStats } from "../server/promo-data";
import type { PromoCodeDraft } from "./promo-code-form";

/** Shared pieces of the promo code pages (server only). */

const STATE_TONE: Record<PromoCodeState, Tone> = {
  active: "green",
  inactive: "neutral",
  scheduled: "violet",
  expired: "gold",
  exhausted: "pink",
};

export async function PromoStatePill({ code }: { code: PromoCodeWithStats }) {
  const t = await getTranslations("admin.promoCodes.states");
  const state = promoCodeState(code, code.stats.redemptions);
  return (
    <StatusPill tone={STATE_TONE[state]} dot data-testid="promo-state">
      {t(state)}
    </StatusPill>
  );
}

/** Commissions per currency, never added up across currencies; a dash without any. */
export function moneyList(map: Record<string, number>): string {
  const entries = Object.entries(map).sort(([a], [b]) => a.localeCompare(b));
  if (!entries.length) return "–";
  return entries
    .map(([currency, value]) => formatCurrency(value, currency, ADMIN_FORMAT_SETTINGS, 2))
    .join(" · ");
}

/** The edit form's values of a saved code. */
export function draftOf(code: PromoCodeRow): PromoCodeDraft {
  const tz = ADMIN_FORMAT_SETTINGS.timeZone;
  return {
    code: code.code,
    partnerName: code.partnerName,
    partnerEmail: code.partnerEmail ?? "",
    partnerNote: code.partnerNote ?? "",
    kind: code.kind,
    benefit: code.benefit,
    benefitValue: String(code.benefitValue),
    commissionPercent: String(code.commissionPercent),
    maxUses: code.maxUses === null ? "" : String(code.maxUses),
    validFrom: validFromDay(code.validFrom, tz),
    validTo: validToDay(code.validTo, tz),
    active: code.active,
  };
}
