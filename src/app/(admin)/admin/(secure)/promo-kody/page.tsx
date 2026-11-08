import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ADMIN_PATH } from "@/features/admin/access";
import { ADMIN_FORMAT_SETTINGS } from "@/features/admin/format-metric";
import { bestCodes } from "@/features/admin/promo-admin";
import { logAdminAction } from "@/features/admin/server/audit";
import { requireAdmin } from "@/features/admin/server/guard";
import { loadPromoCodes, type PromoCodeWithStats } from "@/features/admin/server/promo-data";
import { AdminCard } from "@/features/admin/ui/blocks";
import { AdminPageBar } from "@/features/admin/ui/page-bar";
import { PromoCodeDialog } from "@/features/admin/ui/promo-code-form";
import { CopyPromoLink, PromoActiveToggle } from "@/features/admin/ui/promo-controls";
import { draftOf, moneyList, PromoStatePill } from "@/features/admin/ui/promo-view";
import { promoLink } from "@/features/promo/codes";
import { formatNumber } from "@/lib/format";
import { siteOrigin } from "@/lib/site-origin";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("admin.promoCodes");
  return { title: t("title") };
}

const n = (value: number) => formatNumber(value, {}, ADMIN_FORMAT_SETTINGS);

/**
 * Settings → Promo codes: the best codes of the last 30 days, then every
 * code with how many accounts used it, how many of them pay and the
 * commissions waiting to be paid. The owner and an admin make, edit and
 * switch off codes; the payouts of a code are on its detail.
 */
export default async function AdminPromoCodesPage() {
  const context = await requireAdmin();
  await logAdminAction(context, "view", "promo_codes");
  const [codes, origin, t, tBenefit] = await Promise.all([
    loadPromoCodes(),
    siteOrigin(),
    getTranslations("admin.promoCodes"),
    getTranslations("promo.benefit"),
  ]);
  const best = bestCodes(codes);
  const benefitOf = (code: PromoCodeWithStats) =>
    tBenefit(code.benefit, { value: code.benefitValue });
  const href = (code: PromoCodeWithStats) => `${ADMIN_PATH}/promo-kody/${code.id}`;

  return (
    <>
      <AdminPageBar
        title={t("title")}
        description={t("description")}
        controls={<PromoCodeDialog />}
      />
      <div className="flex flex-col gap-4">
        <AdminCard title={t("summary.title")} description={t("summary.description")}>
          {best.length === 0 ? (
            <p className="text-sm text-ink-muted">{t("summary.empty")}</p>
          ) : (
            <ol className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5" data-testid="promo-best">
              {best.map((code) => (
                <li
                  key={code.id}
                  className="flex flex-col gap-1 rounded-xl border border-line bg-canvas/40 p-3"
                >
                  <Link
                    href={href(code)}
                    className="font-mono text-sm font-semibold text-ink underline-offset-4 hover:underline"
                  >
                    {code.code}
                  </Link>
                  <span className="truncate text-xs text-ink-muted">{code.partnerName}</span>
                  <span className="text-xs text-ink-soft tabular-nums">
                    {t("summary.figures", {
                      registrations: code.stats.redemptionsSince,
                      paying: code.stats.payingSince,
                    })}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </AdminCard>

        <AdminCard title={t("list.title")} description={t("list.description")}>
          {codes.length === 0 ? (
            <p className="text-sm text-ink-muted">{t("list.empty")}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-sm" data-testid="promo-codes">
                <thead>
                  <tr className="text-left text-xs text-ink-muted">
                    <th className="py-2 pr-4 font-medium">{t("columns.code")}</th>
                    <th className="py-2 pr-4 font-medium">{t("columns.partner")}</th>
                    <th className="py-2 pr-4 font-medium">{t("columns.benefit")}</th>
                    <th className="py-2 pr-4 font-medium">{t("columns.state")}</th>
                    <th className="py-2 pr-4 text-right font-medium">
                      {t("columns.registrations")}
                    </th>
                    <th className="py-2 pr-4 text-right font-medium">{t("columns.paying")}</th>
                    <th className="py-2 pr-4 text-right font-medium">{t("columns.due")}</th>
                    <th className="py-2 text-right font-medium">
                      <span className="sr-only">{t("columns.actions")}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {codes.map((code) => (
                    <tr
                      key={code.id}
                      className="border-t border-line/60 align-top"
                      data-testid="promo-row"
                    >
                      <td className="py-2 pr-4">
                        <Link
                          href={href(code)}
                          className="inline-flex min-h-11 items-center font-mono font-semibold text-ink underline-offset-4 hover:underline mouse:min-h-0"
                        >
                          {code.code}
                        </Link>
                      </td>
                      <td className="py-2 pr-4">
                        <span className="block text-ink">{code.partnerName}</span>
                        <span className="text-xs text-ink-muted">{t(`kinds.${code.kind}`)}</span>
                      </td>
                      <td className="py-2 pr-4 text-ink-soft">
                        <span className="block">{benefitOf(code)}</span>
                        <span className="text-xs text-ink-muted">
                          {t("commission", { percent: code.commissionPercent })}
                        </span>
                      </td>
                      <td className="py-2 pr-4">
                        <PromoStatePill code={code} />
                      </td>
                      <td
                        className="py-2 pr-4 text-right font-semibold text-ink tabular-nums"
                        data-testid="promo-registrations"
                      >
                        {n(code.stats.redemptions)}
                      </td>
                      <td className="py-2 pr-4 text-right text-ink-soft tabular-nums">
                        {n(code.stats.paying)}
                      </td>
                      <td className="py-2 pr-4 text-right text-ink-soft tabular-nums">
                        {moneyList(code.stats.due)}
                      </td>
                      <td className="py-2">
                        <div className="flex flex-wrap justify-end gap-1">
                          <CopyPromoLink link={promoLink(origin, code.code)} />
                          <PromoCodeDialog
                            id={code.id}
                            saved={draftOf(code)}
                            used={code.stats.redemptions > 0}
                            trigger="icon"
                          />
                          <PromoActiveToggle id={code.id} active={code.active} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </AdminCard>
      </div>
    </>
  );
}
