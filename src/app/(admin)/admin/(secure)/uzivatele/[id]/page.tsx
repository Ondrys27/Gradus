import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { formatCalendarDate, formatDateTime, formatNumber } from "@/lib/format";
import { ADMIN_FORMAT_SETTINGS, formatMetricValue } from "@/features/admin/format-metric";
import { logAdminAction } from "@/features/admin/server/audit";
import { requireAdmin } from "@/features/admin/server/guard";
import { accountSupportBlock, adminCan, type AdminRole } from "@/features/admin/roles";
import { ADMIN_PATH } from "@/features/admin/access";
import { availableSupportActions, trialState } from "@/features/admin/account-support";
import { loadUserAccount, loadUserReports, type UserAccount, type UserReport } from "@/features/admin/server/account-data";
import { safe } from "@/features/admin/server/metrics-data";
import { AccountSupportActions, CopyEmail } from "@/features/admin/ui/account-support";
import { StatusPill } from "@/components/ui/status-pill";
import { loadUserDetail } from "@/features/admin/server/users-data";
import { loadUserAiCap } from "@/features/admin/server/ai-caps-data";
import { loadUserStripe, loadUserSubscription } from "@/features/admin/server/subscription-data";
import { UserStripePanel } from "@/features/admin/ui/user-stripe-panel";
import { periodEndDate } from "@/features/admin/subscription-form";
import { UserSubscriptionForm } from "@/features/admin/ui/user-subscription-form";
import { peopleNamer } from "@/features/admin/server/people";
import { CopyId } from "@/features/admin/ui/copy-id";
import { remainingUsd, userCapModeOf } from "@/features/jarvis/caps";
import { AdminCard, AdminEmpty, BlockGrid, PageSection } from "@/features/admin/ui/blocks";
import { AdminPageBar } from "@/features/admin/ui/page-bar";
import { InternalToggle } from "@/features/admin/ui/internal-toggle";
import { UserAiCapForm } from "@/features/admin/ui/user-ai-cap-form";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata(): Promise<Metadata> {
  // No name here: metadata is rendered apart from the page's admin guard.
  const t = await getTranslations("admin.users");
  return { title: t("detailMetaTitle") };
}

const SETTINGS = ADMIN_FORMAT_SETTINGS;
const count = (value: number) => formatNumber(value, {}, SETTINGS);

/**
 * One account. The facts first (as the key figures of a metrics page would
 * be), then AI use, then what happened; what changes the account (internal,
 * the AI cap) is at the end, with confirmation.
 */
export default async function AdminUserDetailPage({ params }: Props) {
  const context = await requireAdmin();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  await logAdminAction(context, "view", "users.detail");

  const [detail, account, reports, nameOf, aiCap, subscription, stripe, t, tControls, tItems, tIndustry, tUnits, tBilling] = await Promise.all([
    loadUserDetail(id),
    safe("user account", () => loadUserAccount(id)),
    safe("user reports", () => loadUserReports(id)),
    peopleNamer([id]),
    loadUserAiCap(id),
    loadUserSubscription(id),
    safe("user stripe", () => loadUserStripe(id)),
    getTranslations("admin.users"),
    getTranslations("admin.controls"),
    getTranslations("metrics.items"),
    getTranslations("onboarding.industry.industries"),
    getTranslations("admin.units"),
    getTranslations("plans.billing"),
  ]);
  if (!detail) notFound();
  const [tAdmin, tFeedback] = await Promise.all([
    getTranslations("admin"),
    getTranslations("admin.feedback"),
  ]);

  const label = (namespace: typeof tControls, key: string, value: string | null) =>
    value && namespace.has(`segmentValues.${key}.${value}`)
      ? namespace(`segmentValues.${key}.${value}`)
      : (value ?? "–");
  const industryLabel = (value: string | null) =>
    value && tIndustry.has(`${value}.label`) ? tIndustry(`${value}.label`) : (value ?? "–");

  return (
    <>
      <AdminPageBar title={nameOf(id)} description={t("detailDescription")} controls={<CopyId id={id} />} />
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-4">
          <dl className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
            <Fact label={t("columns.plan")} value={label(tControls, "plan", detail.plan)} />
            <Fact
              label={t("columns.status")}
              value={t.has(`status.${detail.status}`) ? t(`status.${detail.status}`) : detail.status}
            />
            <Fact label={t("columns.signedUp")} value={formatCalendarDate(detail.signedUpAt.slice(0, 10), SETTINGS)} />
            <Fact
              label={t("columns.lastActive")}
              value={detail.lastActiveAt ? formatDateTime(new Date(detail.lastActiveAt), SETTINGS) : "–"}
            />
            <Fact label={t("industry")} value={industryLabel(detail.industry)} />
            <Fact label={t("mode")} value={label(tControls, "mode", detail.mode)} />
            <Fact label={t("level")} value={detail.seenLevel ? count(detail.seenLevel) : "–"} />
            <Fact label={t("activeDays30")} value={count(detail.activeDays30)} />
            <Fact label={t("workers")} value={count(detail.workers)} />
            <Fact label={t("featureRequests")} value={count(detail.featureRequests)} />
            <Fact
              label={t("satisfaction")}
              value={
                detail.satisfaction === null
                  ? "–"
                  : t("satisfactionValue", { score: count(detail.satisfaction) })
              }
            />
            <Fact label={t("columns.internal")} value={detail.isInternal ? t("yes") : t("no")} />
          </dl>

          <BlockGrid>
            <AdminCard title={t("account.title")} description={t("account.description")} wide>
              {account.ok && account.data ? (
                <AccountFacts
                  userId={id}
                  account={account.data}
                  plan={label(tControls, "plan", detail.plan)}
                  trial={trialState(subscription)}
                  block={accountSupportBlock(context, { id, roles: account.data.roles })}
                  role={context.role}
                  t={t}
                  tAdmin={tAdmin}
                />
              ) : (
                <AdminEmpty hint={t("account.unavailable")} />
              )}
            </AdminCard>

            <AdminCard title={t("reports.title")} description={t("reports.description")} wide>
              {reports.ok ? (
                <UserReports reports={reports.data} t={t} tFeedback={tFeedback} />
              ) : (
                <AdminEmpty hint={t("reports.unavailable")} />
              )}
            </AdminCard>

            <AdminCard title={t("aiTitle")}>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
                <Field label={t("aiCalls")} value={count(detail.ai.calls)} />
                <Field label={tItems("ai_cost.name")} value={formatMetricValue(detail.ai.costUsd, "usd", tUnits)} />
                <Field label={t("inputTokens")} value={formatMetricValue(detail.ai.inputTokens, "tokens", tUnits)} />
                <Field label={t("outputTokens")} value={formatMetricValue(detail.ai.outputTokens, "tokens", tUnits)} />
              </dl>
            </AdminCard>

            <AdminCard title={t("sectionsTitle")} description={t("sectionsDescription")}>
              {detail.sections.length === 0 ? (
                <AdminEmpty hint={t("noActivity")} />
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {detail.sections
                    .sort((a, b) => b.actions - a.actions)
                    .map((row) => (
                      <li key={row.section} className="flex items-center justify-between text-sm">
                        <span className="text-ink-soft">
                          {t.has(`sections.${row.section}`) ? t(`sections.${row.section}`) : row.section}
                        </span>
                        <span className="font-semibold text-ink tabular-nums">{count(row.actions)}</span>
                      </li>
                    ))}
                </ul>
              )}
            </AdminCard>

            <AdminCard title={t("timelineTitle")} description={t("timelineDescription")} wide>
              {detail.timeline.length === 0 ? (
                <AdminEmpty hint={t("noActivity")} />
              ) : (
                <ol className="flex max-h-96 flex-col overflow-y-auto text-sm">
                  {detail.timeline.map((row, index) => (
                    <li
                      key={index}
                      className="flex items-center justify-between gap-3 border-b border-line/60 py-1.5 last:border-0"
                    >
                      <span className="font-mono text-xs text-ink-soft">{row.event}</span>
                      <span className="shrink-0 text-xs text-ink-muted tabular-nums">
                        {formatDateTime(new Date(row.at), SETTINGS)}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </AdminCard>
          </BlockGrid>
        </div>

        {/* What changes the account, at the end of the page. */}
        <PageSection title={t("changesTitle")} description={t("changesDescription")}>
          <BlockGrid>
            <AdminCard title={t("internalTitle")} description={t("internalDescription")}>
              <InternalToggle userId={id} value={detail.isInternal} />
            </AdminCard>

            <AdminCard title={t("subscription.title")} description={t("subscription.description")} wide>
              <SubscriptionFacts
                subscription={subscription}
                planLabel={(key) => label(tControls, "plan", key)}
                billingLabel={(key) => tBilling(key)}
                t={t}
              />
              {stripe.ok && (
                <UserStripePanel
                  userId={id}
                  link={stripe.data}
                  canSync={adminCan(context.role, "editSubscriptions")}
                  planLabel={Object.fromEntries(
                    ["beta", "solo", "pro", "team"].map((key) => [key, label(tControls, "plan", key)]),
                  )}
                />
              )}
              {adminCan(context.role, "editSubscriptions") && (
                <UserSubscriptionForm
                  userId={id}
                  stripe={subscription?.gateway === "stripe"}
                  planLabels={Object.fromEntries(
                    ["beta", "solo", "pro", "team"].map((key) => [key, label(tControls, "plan", key)]),
                  )}
                  saved={{
                    planKey: (["beta", "solo", "pro", "team"] as const).find(
                      (key) => key === subscription?.planKey,
                    ) ?? "beta",
                    billing: subscription?.billing ?? "monthly",
                    status: subscription?.status ?? "active",
                    periodEnd: periodEndDate(
                      subscription
                        ? subscription.status === "trialing"
                          ? subscription.trialEndsAt
                          : subscription.periodEnd
                        : null,
                      SETTINGS.timeZone,
                    ),
                    cancelAtPeriodEnd: subscription?.cancelAtPeriodEnd ?? false,
                  }}
                />
              )}
            </AdminCard>

            <AdminCard title={t("aiCap.title")} description={t("aiCap.description")}>
              <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Field label={t("aiCap.spent")} value={formatMetricValue(aiCap.spentUsd, "usd", tUnits)} />
                <Field
                  label={t("aiCap.limit")}
                  value={
                    aiCap.limit.kind === "blocked"
                      ? t("aiCap.blocked")
                      : aiCap.limit.kind === "cap"
                        ? `${formatMetricValue(aiCap.limit.usd, "usd", tUnits)} · ${t(
                            aiCap.limit.source === "override" ? "aiCap.sourceOverride" : "aiCap.sourceGlobal",
                          )}`
                        : t("aiCap.noLimit")
                  }
                />
                <Field
                  label={t("aiCap.left")}
                  value={
                    aiCap.limit.kind === "cap"
                      ? formatMetricValue(remainingUsd(aiCap.limit.usd, aiCap.spentUsd), "usd", tUnits)
                      : aiCap.limit.kind === "blocked"
                        ? formatMetricValue(0, "usd", tUnits)
                        : t("aiCap.noLimit")
                  }
                />
              </dl>
              {/* An admin reads the exception above; changing it is the owner's. */}
              {adminCan(context.role, "editAiCaps") && (
                <UserAiCapForm
                  userId={id}
                  mode={userCapModeOf(aiCap.override)}
                  capUsd={aiCap.override?.capUsd ?? null}
                />
              )}
            </AdminCard>
          </BlockGrid>
        </PageSection>
      </div>
    </>
  );
}

function SubscriptionFacts({
  subscription,
  planLabel,
  billingLabel,
  t,
}: {
  subscription: Awaited<ReturnType<typeof loadUserSubscription>>;
  planLabel: (key: string) => string;
  billingLabel: (key: "monthly" | "yearly") => string;
  t: Awaited<ReturnType<typeof getTranslations<"admin.users">>>;
}) {
  if (!subscription) return <AdminEmpty hint={t("subscription.noSubscription")} />;
  const date = (at: string | null) => (at ? formatDateTime(new Date(at), SETTINGS) : t("subscription.none"));
  const status = subscription.expired ? "expired" : subscription.status;
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-3 md:grid-cols-4" data-testid="admin-subscription">
      <Field label={t("subscription.plan")} value={planLabel(subscription.planKey)} />
      <Field label={t("subscription.billing")} value={billingLabel(subscription.billing)} />
      <Field label={t("subscription.status")} value={t(`subscription.statuses.${status}`)} />
      <Field label={t("subscription.periodEnd")} value={date(subscription.periodEnd)} />
      {subscription.trialEndsAt && (
        <Field label={t("subscription.trialEnds")} value={date(subscription.trialEndsAt)} />
      )}
      <Field
        label={t("subscription.cancel")}
        value={subscription.cancelAtPeriodEnd ? t("yes") : t("no")}
      />
      {subscription.cancelReason && (
        <Field
          label={t("subscription.cancelReason")}
          value={t(`subscription.reasons.${subscription.cancelReason}`)}
        />
      )}
      {subscription.scheduled && (
        <Field
          label={t("subscription.scheduled")}
          value={t("subscription.scheduledValue", {
            plan: planLabel(subscription.scheduled.planKey),
            billing: billingLabel(subscription.scheduled.billing),
            date: date(subscription.scheduled.at),
          })}
        />
      )}
      {subscription.cancelNote && (
        <div className="col-span-2 flex min-w-0 flex-col gap-0.5 md:col-span-4">
          <dt className="text-xs text-ink-muted">{t("subscription.cancelNote")}</dt>
          <dd className="text-sm whitespace-pre-line text-ink-soft">{subscription.cancelNote}</dd>
        </div>
      )}
    </dl>
  );
}

type UsersT = Awaited<ReturnType<typeof getTranslations<"admin.users">>>;

/** The Account card: who the account is for support, and what can be done for it. */
function AccountFacts({
  userId,
  account,
  plan,
  trial,
  block,
  role,
  t,
  tAdmin,
}: {
  userId: string;
  account: UserAccount;
  plan: string;
  trial: ReturnType<typeof trialState>;
  block: ReturnType<typeof accountSupportBlock>;
  role: AdminRole;
  t: UsersT;
  tAdmin: Awaited<ReturnType<typeof getTranslations<"admin">>>;
}) {
  const date = (at: string | null) => (at ? formatDateTime(new Date(at), SETTINGS) : "–");
  const device = account.lastDevice
    ? [
        tAdmin.has(`device.${account.lastDevice.device}`)
          ? tAdmin(`device.${account.lastDevice.device}`)
          : account.lastDevice.device,
        tAdmin.has(`browser.${account.lastDevice.browser}`)
          ? tAdmin(`browser.${account.lastDevice.browser}`)
          : account.lastDevice.browser,
        date(account.lastDevice.at),
      ].join(" · ")
    : "–";
  const trialText =
    trial.kind === "running"
      ? t("account.trialRunning", { date: date(trial.endsAt), days: trial.daysLeft })
      : trial.kind === "ended"
        ? t("account.trialEnded", { date: date(trial.endsAt) })
        : t("account.trialNone");
  return (
    <div className="flex flex-col gap-4" data-testid="account-card">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-xs text-ink-muted">{t("account.email")}</span>
        {account.email ? (
          <div className="flex flex-wrap items-center gap-2">
            <CopyEmail email={account.email} />
            {!account.emailConfirmed && (
              <StatusPill tone="gold" className="h-5 px-2 text-xs">
                {t("account.unconfirmed")}
              </StatusPill>
            )}
          </div>
        ) : (
          <span className="text-base font-semibold text-ink">–</span>
        )}
      </div>
      <dl className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2 xl:grid-cols-3">
        <Info label={t("account.signedUp")} value={date(account.createdAt)} />
        <Info label={t("account.lastSignIn")} value={date(account.lastSignInAt)} />
        <Info label={t("account.device")} value={device} />
        <Info label={t("account.plan")} value={plan} />
        <Info label={t("account.trial")} value={trialText} />
      </dl>
      {block ? (
        <p className="text-sm text-ink-muted">{t(`account.blocked.${block}`)}</p>
      ) : (
        <AccountSupportActions
          userId={userId}
          email={account.email}
          actions={availableSupportActions(account, role)}
        />
      )}
    </div>
  );
}

/** The account's reports, each a link to its detail in Feedback → Reports. */
function UserReports({
  reports,
  t,
  tFeedback,
}: {
  reports: UserReport[];
  t: UsersT;
  tFeedback: Awaited<ReturnType<typeof getTranslations<"admin.feedback">>>;
}) {
  if (reports.length === 0) return <AdminEmpty hint={t("reports.empty")} />;
  const label = (key: string) => (tFeedback.has(key) ? tFeedback(key) : null);
  return (
    <ul className="flex flex-col gap-1.5" data-testid="user-reports">
      {reports.map((report) => (
        <li key={report.id}>
          <Link
            href={`${ADMIN_PATH}/zpetna-vazba?tab=reports&report=${report.id}`}
            prefetch={false}
            className="flex min-h-11 items-center justify-between gap-3 rounded-xl border border-line px-3 py-2 text-sm outline-none hover:border-violet/50 focus-visible:ring-3 focus-visible:ring-violet/40"
          >
            <span className="flex min-w-0 items-center gap-2">
              <span className="shrink-0 text-xs text-ink-muted">
                {label(`reportKind.${report.kind}`) ?? report.kind}
              </span>
              {report.code && <code className="shrink-0 font-mono text-xs text-ink">{report.code}</code>}
              <span className="min-w-0 truncate text-ink-soft">
                {report.description ?? tFeedback("noDescription")}
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-2 text-xs text-ink-muted tabular-nums">
              {label(`reportStatus.${report.status}`) ?? report.status}
              <span>{formatCalendarDate(report.createdAt.slice(0, 10), SETTINGS)}</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="truncate text-xs text-ink-muted">{label}</dt>
      <dd className="text-sm font-medium text-ink">{value}</dd>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-2xl border border-line bg-surface px-4 py-3">
      <dt className="truncate text-xs text-ink-muted">{label}</dt>
      <dd className="truncate text-base font-semibold text-ink tabular-nums">{value}</dd>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="truncate text-xs text-ink-muted">{label}</dt>
      <dd className="text-lg font-semibold text-ink tabular-nums">{value}</dd>
    </div>
  );
}
