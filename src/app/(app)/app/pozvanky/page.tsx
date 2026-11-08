import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { InvitesView } from "@/features/account/invites-view";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("invites");
  return { title: t("title") };
}

/** Invites into other companies waiting for the account, in any space. */
export default function InvitesPage() {
  return <InvitesView />;
}
