import { isE2eTestAccount } from "@/features/auth/e2e-account";
import { e2eOutboxAllowed, readE2eMail } from "@/lib/email/e2e-outbox";

export const dynamic = "force-dynamic";

/**
 * The mail the mock Resend kept for one test account (e2e-…@gradus.local),
 * for the end-to-end tests only: outside production and with the key derived
 * from the secret key. Anyone else gets the ordinary 404.
 */
export async function GET(request: Request) {
  const secret = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  const to = new URL(request.url).searchParams.get("to") ?? "";
  if (!e2eOutboxAllowed(request.headers.get("x-gradus-e2e-key"), secret) || !isE2eTestAccount(to)) {
    return new Response("Not Found", { status: 404 });
  }
  return Response.json(
    { mail: readE2eMail(to) },
    { headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" } },
  );
}
