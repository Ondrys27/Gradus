import "server-only";
import type { AccountSnapshot } from "@/features/account/types";
import { createClient } from "@/lib/supabase/server";
import { DEFAULT_THEME } from "@/lib/themes";
import { builtinView, customView, parseCustomThemeTokens, type AppearanceView } from "../custom-tokens";
import { resolveRef } from "../schedule";
import { parseThemeRef } from "../theme-ref";

/**
 * The theme of the first paint of the app (30.6), from the account as it is
 * now: the block of the schedule in the user's zone, a manual pick that
 * still holds, a custom theme's colours. So a block that began while the app
 * was closed is already there, without a flash of the old one. A theme that
 * game mode locks (a pick from tool mode) falls back to the default, as in
 * the browser; anything that fails reading falls back too, never an error.
 */
export async function initialAppearance(account: AccountSnapshot): Promise<AppearanceView> {
  const resolved = resolveRef(account.settings, Date.now());
  const parsed = parseThemeRef(resolved.ref);
  try {
    const supabase = await createClient();
    if (parsed?.kind === "custom") {
      const { data } = await supabase
        .from("custom_themes")
        .select("tokens")
        .eq("id", parsed.id)
        .eq("user_id", account.user.id)
        .maybeSingle();
      const tokens = parseCustomThemeTokens(data?.tokens);
      return tokens ? customView(tokens) : builtinView(DEFAULT_THEME);
    }
    const key = parsed?.kind === "builtin" ? parsed.key : DEFAULT_THEME;
    // Only game mode in the own space locks anything (theme_available, as the guard).
    if (key === DEFAULT_THEME || account.profile.mode === "tool" || account.worker) return builtinView(key);
    const { data } = await supabase.rpc("theme_available", { _theme: key });
    return builtinView(data === true ? key : DEFAULT_THEME);
  } catch {
    return builtinView(DEFAULT_THEME);
  }
}
