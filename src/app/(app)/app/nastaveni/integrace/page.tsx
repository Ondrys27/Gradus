import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ConnectedAppsView } from "@/features/mcp/connected-apps-view";
import { canonicalResource } from "@/features/mcp/oauth";
import { requestOrigin } from "@/features/mcp/server/consent";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("settings.groups.integrations");
  return { title: t("title") };
}

export default async function Page() {
  return <ConnectedAppsView serverUrl={canonicalResource(await requestOrigin())} />;
}
