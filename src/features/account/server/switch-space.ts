import "server-only";
import { cookies } from "next/headers";
import { track } from "@/lib/analytics/track";
import { createClient } from "@/lib/supabase/server";
import { ACTIVE_SPACE_COOKIE, ACTIVE_SPACE_MAX_AGE, isSpaceId } from "../space-cookie";

export type SwitchResult = "ok" | "unauthenticated" | "notFound";

/**
 * Makes `space` the active space of this browser: checks with the user's own
 * client that the account belongs there (is_space_member: its own space or a
 * company it actively works for) and keeps the choice in the cookie the
 * Supabase clients send along. A space the account is not in is "notFound",
 * the same answer as a space that does not exist, so nothing is given away.
 * The cookie is readable by the page (the browser client names the space
 * too); the database checks it on every request anyway.
 */
export async function switchSpace(space: unknown, via: "switcher" | "link"): Promise<SwitchResult> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (typeof userId !== "string" || !userId) return "unauthenticated";
  if (!isSpaceId(space)) return "notFound";

  const [member, current, spaces] = await Promise.all([
    supabase.rpc("is_space_member", { _space: space }),
    supabase.rpc("current_workspace_id"),
    supabase.rpc("my_spaces"),
  ]);
  if (member.error) throw member.error;
  if (member.data !== true) return "notFound";

  const store = await cookies();
  store.set(ACTIVE_SPACE_COOKIE, space, {
    path: "/",
    maxAge: ACTIVE_SPACE_MAX_AGE,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    httpOnly: false,
  });

  if (current.data && current.data !== space) {
    await track(
      "space_switched",
      {
        to: space === userId ? "own" : "foreign",
        from: current.data === userId ? "own" : "foreign",
        spaces: Math.min(spaces.data?.length ?? 1, 50),
        via,
      },
      { userId },
    );
  }
  return "ok";
}
