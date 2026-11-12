import type { OpsEnv } from "@/lib/ops";
import type { GameMode } from "./types";

/**
 * Game or tool, shared by Settings and Grady's tools. Switching to game keeps
 * open every section the account already uses (the database does it).
 */
export async function setGameMode(
  env: OpsEnv,
  args: { userId: string; mode: GameMode; where: "onboarding" | "settings" },
): Promise<void> {
  const { error } = await env.db.from("profiles").update({ mode: args.mode }).eq("id", args.userId);
  if (error) throw error;
  env.track("game_mode_changed", { to: args.mode, where: args.where });
}
