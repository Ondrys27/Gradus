import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { redirect, RedirectType } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  ADMIN_PATH_HEADER,
  adminLoginUrl,
  claimsMayEnterAdmin,
  parseSessionStatus,
} from "../access";

export type AdminContext = {
  userId: string;
  /** When the 8-hour limit ends the admin session, ISO. */
  expiresAt: string;
};

/**
 * Role owner, second factor (aal2) and a live admin session, checked by the
 * database from the signed token. Null for anyone else; never says why.
 */
export const adminAccess = cache(
  async (activity: boolean = false): Promise<AdminContext | null> => {
    try {
      const supabase = await createClient();
      const { data } = await supabase.auth.getClaims();
      const claims = data?.claims;
      if (!claimsMayEnterAdmin(claims)) return null;
      const { data: touched, error } = await supabase.rpc("admin_session_touch", {
        _activity: activity,
      });
      if (error) {
        console.error("[admin] session check failed", error.message);
        return null;
      }
      const session = parseSessionStatus(touched);
      if (session.status !== "ok" || session.userId !== claims?.sub || !session.expiresAt) {
        return null;
      }
      return { userId: session.userId, expiresAt: session.expiresAt };
    } catch (error) {
      console.error("[admin] session check threw", error);
      return null;
    }
  },
);

/**
 * The first line of every page and layout of the administration. Anyone else
 * (or a session that ended since the middleware let the request in) goes to
 * the sign-in, which continues to this page afterwards.
 */
export async function requireAdmin(activity = false): Promise<AdminContext> {
  const context = await adminAccess(activity);
  if (!context) {
    const path = (await headers()).get(ADMIN_PATH_HEADER);
    redirect(adminLoginUrl(path), RedirectType.replace);
  }
  return context;
}

/** For route handlers: the same 404 as an unknown address. */
export function adminNotFound(): Response {
  return new Response("Not Found", {
    status: 404,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

/** Whether an account holds the owner role; nobody else gets past the password. */
export async function isOwnerAccount(userId: string): Promise<boolean> {
  const { data, error } = await createAdminClient().rpc("has_role", {
    _user_id: userId,
    _role: "owner",
  });
  if (error) console.error("[admin] role check failed", error.message);
  return data === true;
}
