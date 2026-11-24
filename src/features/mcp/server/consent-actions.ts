"use server";

import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { isMcpLevel } from "../levels";
import { redirectWith } from "../oauth";
import { checkAuthorizeRequest, consentSpaces, deniedRedirect, needsSecondFactor } from "./consent";
import { createGrantWithCode } from "./store";

export type ConsentResult = { ok: false; error: "invalid" | "spaces" | "secondFactor" | "failed" };

const PARAM_KEYS = [
  "response_type",
  "client_id",
  "redirect_uri",
  "code_challenge",
  "code_challenge_method",
  "state",
  "scope",
  "resource",
] as const;

/**
 * Allow or Deny on the consent screen. Everything is checked again here:
 * the request, the session (and its second factor), the companies (the
 * account belongs there and connected apps are allowed) and the level.
 */
export async function decideConsent(input: {
  params: Record<string, string>;
  allow: boolean;
  level: string;
  spaceIds: string[];
  activeSpaceId: string;
}): Promise<ConsentResult> {
  const params: Record<string, string> = {};
  for (const key of PARAM_KEYS) {
    const value = input.params[key];
    if (typeof value === "string") params[key] = value;
  }
  const check = await checkAuthorizeRequest(params);
  if (check.kind === "error") return { ok: false, error: "invalid" };
  if (check.kind === "redirect") redirect(check.to);
  if (!input.allow) redirect(deniedRedirect(check));

  const db = await createClient();
  const { data } = await db.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) return { ok: false, error: "invalid" };
  if (await needsSecondFactor(db)) return { ok: false, error: "secondFactor" };
  if (!isMcpLevel(input.level)) return { ok: false, error: "invalid" };

  const allowed = new Set((await consentSpaces(db)).filter((s) => s.open).map((s) => s.spaceId));
  const spaceIds = [...new Set(input.spaceIds)].filter((id) => allowed.has(id));
  if (!spaceIds.length || spaceIds.length !== new Set(input.spaceIds).size) {
    return { ok: false, error: "spaces" };
  }
  const activeSpaceId = spaceIds.includes(input.activeSpaceId) ? input.activeSpaceId : spaceIds[0];

  let code: string;
  try {
    code = await createGrantWithCode(createAdminClient(), {
      userId,
      client: check.client,
      level: input.level,
      spaceIds,
      spaceId: activeSpaceId,
      redirectUri: check.request.redirect_uri,
      codeChallenge: check.request.code_challenge,
      resource: check.resource,
    });
  } catch (error) {
    console.error("mcp: consent failed", error);
    return { ok: false, error: "failed" };
  }
  redirect(
    redirectWith(check.request.redirect_uri, {
      code,
      state: check.request.state,
      iss: check.origin,
    }),
  );
}

/** The second factor on the consent screen (an account that has one signs this session up to aal2). */
export async function verifyConsentSecondFactor(code: string): Promise<{ ok: boolean }> {
  if (!/^\d{6}$/.test(code)) return { ok: false };
  const db = await createClient();
  const { data, error } = await db.auth.mfa.listFactors();
  if (error) return { ok: false };
  for (const factor of data.totp.filter((item) => item.status === "verified")) {
    const verified = await db.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
    if (!verified.error) return { ok: true };
  }
  return { ok: false };
}
