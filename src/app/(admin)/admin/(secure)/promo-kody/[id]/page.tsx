import type { ReactNode } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ArrowLeftIcon, DownloadIcon } from "lucide-react";
import { z } from "zod";
import { StatusPill } from "@/components/ui/status-pill";
import { ADMIN_PATH } from "@/features/admin/access";
import { ADMIN_FORMAT_SETTINGS } from "@/features/admin/format-metric";
import { adminCan, mayExport } from "@/features/admin/roles";
import { logAdminAction } from "@/features/admin/server/audit";
import { requireAdmin } from "@/features/admin/server/guard";
import { peopleNamer } from "@/features/admin/server/people";
import {
  loadPromoCode,
  loadPromoCodeUsers,
  loadPromoPayouts,
  USERS_PAGE,
  type PayoutStatus,
} from "@/features/admin/server/promo-data";
import { AdminCard } from "@/features/admin/ui/blocks";
import { AdminPageBar } from "@/features/admin/ui/page-bar";
import { PromoCodeDialog } from "@/features/admin/ui/promo-code-form";
import {
  CopyPromoLink,
  PayoutActions,
  PromoActiveToggle,
} from "@/features/admin/ui/promo-controls";
import { draftOf, moneyList, PromoStatePill } from "@/features/admin/ui/promo-view";
import { userDetailHref } from "@/features/admin/ui/user-link";
import type { Tone } from "@/components/ui/tone";
import { promoLink } from "@/features/promo/codes";
import { formatCurrency, formatDate, formatNumber } from "@/lib/format";
import { siteOrigin } from "@/lib/site-origin";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("admin.promoCodes");
  return { title: t("title") };
}

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const PAYOUT_TONE: Record<PayoutStatus, Tone> = {
  pending: "gold",
  approved: "violet",
  paid: "green",
};

/**
 * One promo code: its link, the accounts that used it (name, when, whether
 * they paid) a page at a time, and the partner's payouts, which the owner
 * approves, marks paid and exports for the accountant. An admin reads them.
 */
export default async function AdminPromoCodePage({ params, searchParams }: Props) {
  const context = await requireAdmin();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const code = await loadPromoCode(id);
  if (!code) notFound();
  await logAdminAction(context, "view", "promo_codes.detail");

  const rawPage = Number((await searchParams).page ?? 1);
  const page = Number.isInteger(rawPage) && rawPage > 1 ? rawPage - 1 : 0;
  const [{ users, total }, payouts, origin, t, tBenefit] = await Promise.all([
    loadPromoCodeUsers(id, page),
    loadPromoPayouts(id),
    siteOrigin(),
    getTranslations("admin.promoCodes"),
    getTranslations("promo.benefit"),
  ]);
  const nameOf = await peopleNamer([
    ...users.map((u) => u.userId),
    ...payouts.map((p) => p.userId),
  ]);
  const canPay = adminCan(context.role, "managePayouts");
  const canExport = mayExport(context.role, "promo_payouts");
  const date = (value: string) => formatDate(new Date(value), ADMIN_FORMAT_SETTINGS);
  const money = (value: number, currency: string) =>
    formatCurrency(value, currency, ADMIN_FORMAT_SETTINGS, 2);
  const n = (value: number) => formatNumber(value, {}, ADMIN_FORMAT_SETTINGS);
  const link = promoLink(origin, code.code);
  const base = `${ADMIN_PATH}/promo-kody/${id}`;
  const from = total === 0 ? 0 : page * USERS_PAGE + 1;
  const to = Math.min(total, (page + 1) * USERS_PAGE);

  return (
    <>
      <AdminPageBar
        title={code.code}
        description={t("detail.description", { partner: code.partnerName })}
        controls={
          <div className="flex flex-wrap items-center gap-1">
            <CopyPromoLink link={link} />
            <PromoCodeDialog
              id={code.id}
              saved={draftOf(code)}
              used={code.stats.redemptions > 0}
              trigger="icon"
            />
            <PromoActiveToggle id={code.id} active={code.active} />
          </div>
        }
      />
      <Link
        href={`${ADMIN_PATH}/promo-kody`}
        className="mb-4 inline-flex min-h-11 items-center gap-1.5 text-sm text-ink-soft hover:text-ink mouse:min-h-8"
      >
        <ArrowLeftIcon aria-hidden className="size-4" />
        {t("detail.back")}
      </Link>
      <div className="flex flex-col gap-4">
        <AdminCard title={t("detail.overview")} actions={<PromoStatePill code={code} />}>
          <dl className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <Fact label={t("detail.partner")}>
              <span className="block">{code.partnerName}</span>
              <span className="text-xs text-ink-muted">
                {[t(`kinds.${code.kind}`), code.partnerEmail].filter(Boolean).join(" · ")}
              </span>
            </Fact>
            <Fact label={t("columns.benefit")}>
              <span className="block">{tBenefit(code.benefit, { value: code.benefitValue })}</span>
              <span className="text-xs text-ink-muted">
                {t("commission", { percent: code.commissionPercent })}
              </span>
            </Fact>
            <Fact label={t("detail.figures")}>
              <span
                className="block"
                data-testid="promo-detail-registrations"
                data-count={code.stats.redemptions}
              >
                {t("detail.registrations", { count: code.stats.redemptions })}
              </span>
              <span className="text-xs text-ink-muted">
                {t("detail.paying", { count: code.stats.paying })}
              </span>
            </Fact>
            <Fact label={t("columns.due")}>
              <span className="block">{moneyList(code.stats.due)}</span>
              <span className="text-xs text-ink-muted">
                {t("detail.paidOut", { amount: moneyList(code.stats.paid) })}
              </span>
            </Fact>
          </dl>
          <p
            className="truncate font-mono text-xs text-ink-muted select-all"
            data-testid="promo-link"
          >
            {link}
          </p>
          {code.partnerNote && (
            <p className="text-sm whitespace-pre-line text-ink-soft">{code.partnerNote}</p>
          )}
        </AdminCard>

        <AdminCard title={t("users.title")} description={t("users.description")}>
          {users.length === 0 ? (
            <p className="text-sm text-ink-muted">{t("users.empty")}</p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-sm" data-testid="promo-users">
                  <thead>
                    <tr className="text-left text-xs text-ink-muted">
                      <th className="py-2 pr-4 font-medium">{t("users.name")}</th>
                      <th className="py-2 pr-4 font-medium">{t("users.date")}</th>
                      <th className="py-2 pr-4 font-medium">{t("users.source")}</th>
                      <th className="py-2 font-medium">{t("users.paid")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((user) => (
                      <tr key={user.userId} className="border-t border-line/60">
                        <td className="py-2 pr-4">
                          <Link
                            href={userDetailHref(user.userId)}
                            prefetch={false}
                            className="inline-flex min-h-11 items-center gap-2 text-ink underline-offset-4 hover:underline mouse:min-h-0"
                          >
                            {nameOf(user.userId)}
                          </Link>
                          {user.isInternal && (
                            <span className="ml-2 text-xs text-ink-muted">
                              {t("users.internal")}
                            </span>
                          )}
                        </td>
                        <td className="py-2 pr-4 text-ink-soft tabular-nums">
                          {date(user.redeemedAt)}
                        </td>
                        <td className="py-2 pr-4 text-ink-soft">{t(`sources.${user.source}`)}</td>
                        <td className="py-2" data-testid="promo-user-paid">
                          {user.firstPaidAt ? (
                            <StatusPill tone="green">
                              {t("users.paidOn", { date: date(user.firstPaidAt) })}
                            </StatusPill>
                          ) : (
                            <span className="text-ink-muted">{t("users.notPaid")}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {total > USERS_PAGE && (
                <nav
                  className="flex items-center justify-between gap-2 text-sm"
                  aria-label={t("users.pages")}
                >
                  <span className="text-ink-muted tabular-nums">
                    {t("users.range", { from: n(from), to: n(to), total: n(total) })}
                  </span>
                  <span className="flex gap-2">
                    {page > 0 && (
                      <Link
                        href={`${base}?page=${page}`}
                        className="inline-flex min-h-11 items-center px-2 text-violet mouse:min-h-8"
                      >
                        {t("users.previous")}
                      </Link>
                    )}
                    {to < total && (
                      <Link
                        href={`${base}?page=${page + 2}`}
                        className="inline-flex min-h-11 items-center px-2 text-violet mouse:min-h-8"
                      >
                        {t("users.next")}
                      </Link>
                    )}
                  </span>
                </nav>
              )}
            </>
          )}
        </AdminCard>

        <AdminCard
          title={t("payouts.title")}
          description={t("payouts.description")}
          footer={
            canExport && payouts.length > 0 ? (
              <a
                href={`${base}/export`}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-xl px-3 text-sm text-ink-soft hover:bg-surface-hover hover:text-ink mouse:min-h-8"
                data-testid="payouts-export"
              >
                <DownloadIcon aria-hidden className="size-4" />
                {t("payouts.export")}
              </a>
            ) : undefined
          }
        >
          {!canPay && <p className="text-xs text-ink-muted">{t("payouts.readOnly")}</p>}
          {payouts.length === 0 ? (
            <p className="text-sm text-ink-muted">{t("payouts.empty")}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm" data-testid="promo-payouts">
                <thead>
                  <tr className="text-left text-xs text-ink-muted">
                    <th className="py-2 pr-4 font-medium">{t("payouts.created")}</th>
                    <th className="py-2 pr-4 font-medium">{t("payouts.user")}</th>
                    <th className="py-2 pr-4 text-right font-medium">{t("payouts.base")}</th>
                    <th className="py-2 pr-4 text-right font-medium">{t("payouts.amount")}</th>
                    <th className="py-2 pr-4 font-medium">{t("payouts.status")}</th>
                    <th className="py-2 text-right font-medium">
                      <span className="sr-only">{t("columns.actions")}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {payouts.map((payout) => (
                    <tr
                      key={payout.id}
                      className="border-t border-line/60"
                      data-testid="promo-payout"
                    >
                      <td className="py-2 pr-4 text-ink-soft tabular-nums">
                        {date(payout.createdAt)}
                      </td>
                      <td className="py-2 pr-4 text-ink">
                        {payout.userId ? nameOf(payout.userId) : t("payouts.deletedUser")}
                      </td>
                      <td className="py-2 pr-4 text-right text-ink-soft tabular-nums">
                        {money(payout.baseAmount, payout.currency)}
                        <span className="block text-xs text-ink-muted">
                          {t("commission", { percent: payout.commissionPercent })}
                        </span>
                      </td>
                      <td
                        className="py-2 pr-4 text-right font-semibold text-ink tabular-nums"
                        data-testid="payout-amount"
                      >
                        {money(payout.amount, payout.currency)}
                      </td>
                      <td className="py-2 pr-4">
                        <StatusPill
                          tone={PAYOUT_TONE[payout.status]}
                          dot
                          data-testid="payout-status"
                        >
                          {t(`payouts.statuses.${payout.status}`)}
                        </StatusPill>
                      </td>
                      <td className="py-2">
                        {canPay && <PayoutActions id={payout.id} status={payout.status} />}
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

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd className="min-w-0 text-ink">{children}</dd>
    </div>
  );
}
