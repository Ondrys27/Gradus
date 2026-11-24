import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { AuthCard } from "@/features/auth/auth-card";
import { ConsentForm } from "@/features/mcp/consent-form";
import { levelFromScope } from "@/features/mcp/levels";
import { authorizeParams } from "@/features/mcp/oauth";
import {
  checkAuthorizeRequest,
  consentSpaces,
  needsSecondFactor,
} from "@/features/mcp/server/consent";
import { ACTIVE_SPACE_COOKIE, isSpaceId } from "@/features/account/space-cookie";
import { APP_NAME } from "@/lib/constants";
import { createClient } from "@/lib/supabase/server";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("mcp.consent");
  return { title: t("pageTitle", { appName: APP_NAME }), robots: { index: false } };
}

/**
 * /oauth/authorize (28.8): "Claude wants access to your Gradus". Signed in
 * through the app's own session (the middleware sends a visitor to the
 * sign-in and back); the level and the companies are chosen here.
 */
export default async function AuthorizePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = authorizeParams(await searchParams);
  const t = await getTranslations("mcp.consent");
  const check = await checkAuthorizeRequest(params);
  if (check.kind === "redirect") redirect(check.to);
  if (check.kind === "error") {
    return (
      <AuthCard title={t("errorTitle")} description={t(`error.${check.reason}`)}>
        <span />
      </AuthCard>
    );
  }
  const db = await createClient();
  const [spaces, secondFactor, store] = await Promise.all([
    consentSpaces(db),
    needsSecondFactor(db),
    cookies(),
  ]);
  const cookie = store.get(ACTIVE_SPACE_COOKIE)?.value;
  const active = isSpaceId(cookie) ? cookie : null;
  return (
    <AuthCard
      title={t("title", { client: check.client.client_name, appName: APP_NAME })}
      description={t("description", { appName: APP_NAME })}
    >
      <ConsentForm
        params={params}
        clientName={check.client.client_name}
        redirectHost={check.redirectHost}
        verifiedClient={check.client.kind === "cimd"}
        initialLevel={levelFromScope(check.request.scope)}
        spaces={spaces}
        activeSpaceId={active}
        secondFactor={secondFactor}
      />
    </AuthCard>
  );
}
