import { getTranslations } from "next-intl/server";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Stagger, StaggerItem } from "@/components/ui/stagger";
import { navItems, type NavKey } from "./nav-items";

/** Heading and empty state for a section that is not built yet. */
export async function SectionPlaceholder({ section }: { section: NavKey }) {
  const t = await getTranslations("sections");
  const tNav = await getTranslations("nav");
  const Icon = navItems.find((item) => item.key === section)!.icon;

  return (
    <Stagger className="flex flex-col gap-8">
      <StaggerItem>
        <PageHeader title={tNav(section)} description={t(`${section}.description`)} />
      </StaggerItem>
      <StaggerItem>
        <EmptyState
          icon={<Icon />}
          title={t(`${section}.emptyTitle`)}
          description={t(`${section}.emptyDescription`)}
        />
      </StaggerItem>
    </Stagger>
  );
}
