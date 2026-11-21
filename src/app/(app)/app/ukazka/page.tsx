import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { parseShowcaseParams } from "@/features/tutorial/showcase/params";
import { loadShowcaseAccess } from "@/features/tutorial/showcase/server/settings";
import { ShowcaseStart } from "@/features/tutorial/showcase/showcase-start";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("showcase");
  return { title: t("title") };
}

type Param = string | string[] | undefined;
const first = (value: Param) => (Array.isArray(value) ? value[0] : value) ?? null;

/**
 * The showcase (step 27.4): /app/ukazka?scenar=a&jazyk=en&velikost=1920x1080.
 * The app's owner or an administrator (with the mode on in the
 * administration) gets the start screen; the stage account it creates
 * starts playing. Anybody else gets the 404 of an address that does not exist.
 */
export default async function ShowcasePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, Param>>;
}) {
  const access = await loadShowcaseAccess();
  if (!access) notFound();
  const search = await searchParams;
  const params = parseShowcaseParams({ get: (name) => first(search[name]) });
  return <ShowcaseStart role={access.role} params={params} />;
}
