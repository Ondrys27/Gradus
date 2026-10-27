import { notFound } from "next/navigation";
import { CrashOnRender } from "@/features/errors/crash-on-render";
import { crashTestMessage, mayUseCrashTest } from "@/features/errors/crash-test";
import { createClient } from "@/lib/supabase/server";

type Param = string | string[] | undefined;
const first = (value: Param) => (Array.isArray(value) ? value[0] : value);

/** The error page's end-to-end test crashes here; a 404 for anyone but a test account. */
export default async function CrashTestPage({
  searchParams,
}: {
  searchParams: Promise<{ later?: Param; server?: Param; tag?: Param }>;
}) {
  const { data } = await (await createClient()).auth.getClaims();
  if (!mayUseCrashTest(data?.claims?.email)) notFound();
  const params = await searchParams;
  const message = crashTestMessage(first(params.tag));
  // A server component's own error: caught by instrumentation.ts as well as the error page.
  if (first(params.server) === "1") throw new Error(message);
  return <CrashOnRender later={first(params.later) === "1"} message={message} />;
}
