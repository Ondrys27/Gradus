import { notFound } from "next/navigation";
import { CrashOnRender } from "@/features/errors/crash-on-render";
import { mayUseCrashTest } from "@/features/errors/crash-test";
import { createClient } from "@/lib/supabase/server";

/** The error page's end-to-end test crashes here; a 404 for anyone but a test account. */
export default async function CrashTestPage({
  searchParams,
}: {
  searchParams: Promise<{ later?: string | string[] }>;
}) {
  const { data } = await (await createClient()).auth.getClaims();
  if (!mayUseCrashTest(data?.claims?.email)) notFound();
  const { later } = await searchParams;
  return <CrashOnRender later={later === "1"} />;
}
