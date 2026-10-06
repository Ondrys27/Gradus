import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { WaitlistConfirm } from "@/features/marketing/waitlist-confirm";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("marketing.meta");
  return { title: t("waitlistTitle"), robots: { index: false } };
}

/** The link from the waitlist e-mail lands here with its token. */
export default async function WaitlistConfirmPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const { token } = await searchParams;
  return (
    <section className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center py-16">
      <WaitlistConfirm token={typeof token === "string" ? token.slice(0, 128) : ""} />
    </section>
  );
}
