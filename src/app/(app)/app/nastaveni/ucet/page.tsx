import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AccountView } from "@/features/settings/account-view";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("settings.groups.account");
  return { title: t("title") };
}

export default function Page() {
  return <AccountView />;
}
