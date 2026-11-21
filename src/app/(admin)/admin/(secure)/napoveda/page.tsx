import Link from "next/link";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { helpFor, helpItemHref } from "@/features/admin/help-index";
import { logAdminAction } from "@/features/admin/server/audit";
import { requireAdmin } from "@/features/admin/server/guard";
import { AdminCard, BlockGrid } from "@/features/admin/ui/blocks";
import { AdminPageBar } from "@/features/admin/ui/page-bar";
import { parseAdminView, viewQuery } from "@/features/admin/view-state";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("admin.help");
  return { title: t("title") };
}

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * Help (step 27.2): what each section holds and what is set there, with a
 * link straight to the place. Written from help-index.ts, the same index
 * ⌘K searches; each person sees only the sections and actions they have.
 */
export default async function AdminHelpPage({ searchParams }: Props) {
  const context = await requireAdmin();
  await logAdminAction(context, "view", "help");
  const [params, t, tShell] = await Promise.all([
    searchParams,
    getTranslations("admin.help"),
    getTranslations("admin.shell"),
  ]);
  const kept = viewQuery(parseAdminView(params));
  const sections = helpFor(context);
  const link =
    "inline-flex min-h-11 items-center text-sm text-ink-soft underline-offset-4 outline-none hover:text-ink hover:underline focus-visible:ring-3 focus-visible:ring-violet/40 mouse:min-h-8";

  return (
    <>
      <AdminPageBar title={t("title")} description={t("description")} />
      <div className="flex flex-col gap-4">
        <p className="rounded-xl border border-line bg-surface px-4 py-3 text-sm text-pretty text-ink-soft">
          {t("searchHint")}
        </p>
        <BlockGrid>
          {sections.map((section) => (
            <AdminCard
              key={section.key}
              title={tShell(`nav.${section.key}`)}
              description={t(`sections.${section.key}`)}
              actions={
                <Link href={`${section.href}${kept}`} prefetch={false} className={link}>
                  {t("open")}
                </Link>
              }
            >
              <ul className="flex flex-col" data-testid={`help-${section.key}`}>
                {section.items.map((item) => (
                  <li key={item.key}>
                    <Link href={helpItemHref(item, kept)} prefetch={false} className={link}>
                      {t(`items.${item.key}.title`)}
                    </Link>
                  </li>
                ))}
              </ul>
            </AdminCard>
          ))}
        </BlockGrid>
      </div>
    </>
  );
}
