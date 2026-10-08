import "server-only";
import { cache } from "react";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { claimsMayEnterAdmin, parseSessionStatus } from "../access";

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
 * The first line of every page, layout and server action of the
 * administration. Anyone else gets the ordinary 404: the administration does
 * not exist for them.
 */
export async function requireAdmin(activity = false): Promise<AdminContext> {
  const context = await adminAccess(activity);
  if (!context) notFound();
  return context;
}

/** For route handlers: the same 404 as an unknown address. */
export function adminNotFound(): Response {
  return new Response("Not Found", {
    status: 404,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

/** Whether an account holds the owner role; the sign-in page shows itself to no one else. */
export async function isOwnerAccount(userId: string): Promise<boolean> {
  const { data, error } = await createAdminClient().rpc("has_role", {
    _user_id: userId,
    _role: "owner",
  });
  if (error) console.error("[admin] role check failed", error.message);
  return data === true;
}
