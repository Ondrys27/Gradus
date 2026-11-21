import Link from "next/link";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { adminCan } from "@/features/admin/roles";
import { logAdminAction } from "@/features/admin/server/audit";
import { requireAdmin } from "@/features/admin/server/guard";
import { AdminCard } from "@/features/admin/ui/blocks";
import { AdminPageBar } from "@/features/admin/ui/page-bar";
import { ShowcaseSwitch } from "@/features/admin/ui/showcase-switch";
import { SCENARIO_IDS, showcaseHref } from "@/features/tutorial/showcase/params";
import { loadShowcaseEnabled } from "@/features/tutorial/showcase/server/settings";
import { APP_NAME } from "@/lib/constants";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("admin.showcase");
  return { title: t("title") };
}

/**
 * Administration → Settings → Showcase (step 27.4): the switch, off by
 * default, and with it on the scenarios to start in the app. Only the app's
 * owner and administrators ever see the mode; switched off, it is gone from
 * the app and the tutorial too.
 */
export default async function AdminShowcasePage() {
  const context = await requireAdmin();
  await logAdminAction(context, "view", "showcase");
  const [t, tScenarios, enabled] = await Promise.all([
    getTranslations("admin.showcase"),
    getTranslations("showcase.scenarios"),
    loadShowcaseEnabled(),
  ]);
  const link =
    "inline-flex min-h-11 items-center text-sm text-violet underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-violet/40 mouse:min-h-8";

  return (
    <>
      <AdminPageBar title={t("title")} description={t("description", { appName: APP_NAME })} />
      <div className="flex flex-col gap-4">
        <AdminCard title={t("switchTitle")} description={t("switchDescription")}>
          <ShowcaseSwitch enabled={enabled} readOnly={!adminCan(context, "editShowcase")} />
        </AdminCard>
        {enabled && (
          <AdminCard title={t("scenariosTitle")} description={t("scenariosDescription")}>
            <ul className="flex flex-col">
              {[...SCENARIO_IDS, "all" as const].map((scenario) => (
                <li key={scenario}>
                  <Link
                    href={showcaseHref({ scenario, locale: "cs", size: "1920x1080" })}
                    prefetch={false}
                    className={link}
                  >
                    {tScenarios(`${scenario}.title`)}
                  </Link>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-ink-muted">{t("recordHint")}</p>
          </AdminCard>
        )}
      </div>
    </>
  );
}
