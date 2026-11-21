/**
 * Who may play the showcase (step 27.4).
 *
 * - The presenter: the owner or an administrator of the app (user_roles),
 *   while Administration → Settings → Showcase mode is on. Outside
 *   production the end-to-end tests' own accounts (e2e-…@gradus.local) with
 *   such a role pass without the switch, so a test never turns on a setting
 *   the production app shares.
 * - The stage: a throw-away internal account the server made for one
 *   showcase (`app_metadata.showcase_stage`, which only the secret key can
 *   set). The showcase always plays there, so nothing of the presenter's own
 *   account is ever on the canvas; it is deleted when the showcase ends.
 *
 * Everybody else does not see the mode at all (404, no tutorial card).
 */

export type ShowcaseRole = "presenter" | "stage";

/** The address of a stage account: internal, so it is out of every metric. */
export const STAGE_EMAIL = /^showcase-[a-z0-9-]+@gradus\.local$/i;
const E2E_EMAIL = /^e2e-[a-z0-9-]+@gradus\.local$/i;

export type ShowcaseAccessInput = {
  roles: readonly string[];
  email: string | null;
  /** The signed token's app_metadata (server-set only). */
  appMetadata: unknown;
  /** The administration's switch (app_settings.showcase_mode). */
  switchOn: boolean;
  /** VERCEL_ENV === "production". */
  production: boolean;
};

export function isStageMetadata(appMetadata: unknown): boolean {
  return (
    !!appMetadata &&
    typeof appMetadata === "object" &&
    (appMetadata as Record<string, unknown>).showcase_stage === true
  );
}

/** Who made a stage (the presenter), from its app_metadata; null when it is no stage. */
export function stagePresenter(appMetadata: unknown): string | null {
  if (!isStageMetadata(appMetadata)) return null;
  const by = (appMetadata as Record<string, unknown>).showcase_by;
  return typeof by === "string" && by ? by : null;
}

export function showcaseRole(input: ShowcaseAccessInput): ShowcaseRole | null {
  const testAccount = !input.production && !!input.email && E2E_EMAIL.test(input.email);
  if (isStageMetadata(input.appMetadata) && input.email && STAGE_EMAIL.test(input.email)) {
    return input.switchOn || !input.production ? "stage" : null;
  }
  const appAdmin = input.roles.includes("owner") || input.roles.includes("admin");
  if (!appAdmin) return null;
  return input.switchOn || testAccount ? "presenter" : null;
}

/** Whether an account's roles could ever make it a presenter (the switch is read only for those). */
export function mayPresent(roles: readonly string[]): boolean {
  return roles.includes("owner") || roles.includes("admin");
}
