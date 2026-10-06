import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { isResetPasswordPath, loginPath, safeNextPath } from "@/lib/auth/routes";
import { legacyRedirectTarget, localizedPath, pageForPath } from "@/lib/routes";
import { createClient } from "@/lib/supabase/server";

/**
 * Landing point for links in Supabase e-mails (password recovery for now).
 * Handles both the token-hash link, which works in any browser, and the PKCE
 * code, which only works in the browser that asked for the e-mail.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const code = searchParams.get("code");
  // Links sent before the move still say /reset-password.
  const rawNext = searchParams.get("next");
  const nextParam = (rawNext && legacyRedirectTarget(rawNext)) ?? rawNext;
  const resetTarget = isResetPasswordPath(nextParam);
  const next = resetTarget ? nextParam! : safeNextPath(nextParam);
  const recovery = type === "recovery" || resetTarget;
  const locale = pageForPath(next)?.locale;

  const supabase = await createClient();
  let ok = false;
  if (tokenHash && type) {
    ok = !(await supabase.auth.verifyOtp({ type, token_hash: tokenHash })).error;
  } else if (code) {
    ok = !(await supabase.auth.exchangeCodeForSession(code)).error;
  }

  const target = ok
    ? next
    : recovery
      ? `${localizedPath("forgotPassword", locale)}?expired=1`
      : loginPath(locale);
  return NextResponse.redirect(new URL(target, request.url));
}
