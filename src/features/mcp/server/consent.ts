import "server-only";
import { headers } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import { toSpaces, type SpaceMembership } from "@/features/account/spaces";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/types/database";
import {
  authorizeSchema,
  canonicalResource,
  redirectAllowed,
  redirectHost,
  redirectWith,
  resourceMatches,
  type AuthorizeRequest,
} from "../oauth";
import { findClient, type ClientRow } from "./store";

type Db = SupabaseClient<Database>;

/**
 * The consent screen's checks (28.8), shared by the page and its action so
 * the action trusts nothing the page showed: the client is known and the
 * redirect is one it registered (else an error page, never a redirect to an
 * unchecked address); everything else wrong goes back to the client as an
 * OAuth error with the state and the issuer.
 */

export type ConsentSpace = SpaceMembership & { open: boolean };

export type ConsentCheck =
  | { kind: "error"; reason: "client" | "redirect" }
  | { kind: "redirect"; to: string }
  | {
      kind: "ok";
      request: AuthorizeRequest;
      client: ClientRow;
      origin: string;
      resource: string;
      redirectHost: string | null;
    };

export async function requestOrigin(): Promise<string> {
  const h = await headers();
  const host =
    h.get("x-forwarded-host")?.split(",")[0]?.trim() || h.get("host") || "localhost:3000";
  const proto =
    h.get("x-forwarded-proto")?.split(",")[0]?.trim() ||
    (host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");
  return `${proto}://${host}`;
}

export async function checkAuthorizeRequest(params: Record<string, string>): Promise<ConsentCheck> {
  const clientId = params.client_id;
  const redirectUri = params.redirect_uri;
  if (!clientId || !redirectUri) return { kind: "error", reason: "client" };
  const client = await findClient(createAdminClient(), clientId).catch(() => null);
  if (!client) return { kind: "error", reason: "client" };
  if (!redirectAllowed(client.redirect_uris, redirectUri))
    return { kind: "error", reason: "redirect" };

  const origin = await requestOrigin();
  const back = (error: string, description?: string) => ({
    kind: "redirect" as const,
    to: redirectWith(redirectUri, {
      error,
      error_description: description,
      state: params.state,
      iss: origin,
    }),
  });
  const parsed = authorizeSchema.safeParse(params);
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    return field === "response_type"
      ? back("unsupported_response_type")
      : back(
          "invalid_request",
          `${String(field ?? "request")} is missing or invalid (PKCE S256 is required).`,
        );
  }
  if (!resourceMatches(parsed.data.resource, origin)) return back("invalid_target");
  return {
    kind: "ok",
    request: parsed.data,
    client,
    origin,
    resource: canonicalResource(origin),
    redirectHost: redirectHost(redirectUri),
  };
}

/** The companies of the account and whether connected apps are allowed in each. */
export async function consentSpaces(db: Db): Promise<ConsentSpace[]> {
  const { data, error } = await db.rpc("my_spaces");
  if (error) throw error;
  const spaces = toSpaces(data);
  return Promise.all(
    spaces.map(async (space) => {
      const { data: open } = await db.rpc("mcp_space_open", { _space: space.spaceId });
      return { ...space, open: open === true };
    }),
  );
}

/** Whether the session must still prove its second factor (the account has one, the session not). */
export async function needsSecondFactor(db: Db): Promise<boolean> {
  const { data, error } = await db.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error || !data) return false;
  return data.nextLevel === "aal2" && data.currentLevel !== "aal2";
}

export function deniedRedirect(check: Extract<ConsentCheck, { kind: "ok" }>): string {
  return redirectWith(check.request.redirect_uri, {
    error: "access_denied",
    state: check.request.state,
    iss: check.origin,
  });
}
