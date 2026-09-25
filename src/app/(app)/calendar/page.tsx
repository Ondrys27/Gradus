import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { CalendarView } from "@/features/calendar/calendar-view";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav");
  return { title: t("calendar") };
}

export default function CalendarPage() {
  return <CalendarView />;
}
