import { notFound } from "next/navigation";
import { CrashOnRender } from "@/features/errors/crash-on-render";
import { mayUseCrashTest } from "@/features/errors/crash-test";
import { createClient } from "@/lib/supabase/server";

/** The error page's end-to-end test crashes here; a 404 for anyone but a test account. */
export default async function CrashTestPage() {
  const { data } = await (await createClient()).auth.getClaims();
  if (!mayUseCrashTest(data?.claims?.email)) notFound();
  return <CrashOnRender />;
}
