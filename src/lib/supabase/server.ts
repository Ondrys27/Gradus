import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { ACTIVE_SPACE_COOKIE, spaceHeaders } from "@/features/account/space-cookie";
import type { Database } from "@/types/database";
import { supabasePublicKey, supabaseUrl } from "./env";

/** How a write was made, for the company's activity (28.7): Grady's tools or an MCP client. */
export type WriteVia = "grady" | "mcp";
export const VIA_HEADER = "x-gradus-via";

/**
 * Per-request client acting as the signed-in user. RLS applies. It names the
 * space the person picked (cookie active_space) to the database, which takes
 * it only when the account belongs there (current_workspace_id()).
 *
 * `via` labels the writes of this client in the activity log ("through
 * Grady", "through Claude"); the label only describes the user's own step,
 * it grants nothing.
 */
export async function createClient(options: { via?: WriteVia } = {}) {
  const cookieStore = await cookies();
  return createServerClient<Database>(supabaseUrl(), supabasePublicKey(), {
    global: {
      headers: {
        ...spaceHeaders(cookieStore.get(ACTIVE_SPACE_COOKIE)?.value),
        ...(options.via ? { [VIA_HEADER]: options.via } : {}),
      },
    },
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Called from a Server Component: cookies are read-only there.
          // The middleware refreshes the session instead.
        }
      },
    },
  });
}
