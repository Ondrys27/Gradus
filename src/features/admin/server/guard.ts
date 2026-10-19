import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { notFound, redirect, RedirectType } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  ADMIN_PATH_HEADER,
  adminLoginUrl,
  claimsMayEnterAdmin,
  parseSessionStatus,
} from "../access";
import { adminCan, type AdminRole, type OwnerOnly } from "../roles";

export type AdminContext = {
  userId: string;
  /** Owner or admin: both pass the gate, a few things are the owner's (roles.ts). */
  role: AdminRole;
  /** When the 8-hour limit ends the admin session, ISO. */
  expiresAt: string;
};

/**
 * Role owner or admin, second factor (aal2) and a live admin session, checked
 * by the database from the signed token. Null for anyone else; never says why.
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
      if (
        session.status !== "ok" ||
        session.userId !== claims?.sub ||
        !session.expiresAt ||
        !session.role
      ) {
        return null;
      }
      return { userId: session.userId, role: session.role, expiresAt: session.expiresAt };
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

/**
 * A page or action only the owner may use. An admin gets the ordinary 404,
 * the same as an address that does not exist.
 */
export async function requireOwnerFor(what: OwnerOnly, activity = false): Promise<AdminContext> {
  const context = await requireAdmin(activity);
  if (!adminCan(context.role, what)) notFound();
  return context;
}

/** For server actions: the context only when the role may do `what`. */
export async function adminAccessFor(what: OwnerOnly): Promise<AdminContext | null> {
  const context = await adminAccess(true);
  return context && adminCan(context.role, what) ? context : null;
}

/** For route handlers: the same 404 as an unknown address. */
export function adminNotFound(): Response {
  return new Response("Not Found", {
    status: 404,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

/** Whether an account holds the owner or the admin role; nobody else gets past the password. */
export async function isAdminAccount(userId: string): Promise<boolean> {
  const admin = createAdminClient();
  const results = await Promise.all(
    (["owner", "admin"] as const).map((role) =>
      admin.rpc("has_role", { _user_id: userId, _role: role }),
    ),
  );
  for (const { error } of results) {
    if (error) console.error("[admin] role check failed", error.message);
  }
  return results.some(({ data }) => data === true);
}
