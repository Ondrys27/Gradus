import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { CalendarSettingsView } from "@/features/scheduler/ui/calendar-settings-view";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("settings.groups.calendar");
  return { title: t("title") };
}

export default function Page() {
  return <CalendarSettingsView />;
}
