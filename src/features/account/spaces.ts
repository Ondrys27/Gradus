import { isActivePath, navItems, workerOnlyItems } from "@/components/layout/nav-items";
import { SETTINGS_PATH } from "@/features/settings/groups";
import { APP_HOME_PATH, SPACE_LINK_PATH } from "@/lib/routes";
import { isSpaceId } from "./space-cookie";

/**
 * One account, several companies (step 22.4). A space is an owner's account:
 * every account has its own and may work in the companies of others. The
 * space the person picked travels as the cookie `active_space`; every
 * request to the database carries it as the header `x-gradus-space`, and
 * current_workspace_id() takes it only when the account belongs there
 * (otherwise its default: the first company it works for, else its own).
 * Row level security goes by membership; the active space decides what the
 * app shows and where functions act.
 */

export {
  ACTIVE_SPACE_COOKIE,
  ACTIVE_SPACE_MAX_AGE,
  SPACE_HEADER,
  isSpaceId,
  readSpaceCookie,
  spaceHeaders,
} from "./space-cookie";

/** One space of the switcher (my_spaces()). */
export type SpaceMembership = {
  spaceId: string;
  role: "owner" | "worker";
  workerId: string | null;
  companyName: string | null;
  logoUrl: string | null;
  ownerName: string | null;
};

type MySpacesRow = {
  space_id: string;
  role: string;
  worker_id: string | null;
  company_name: string | null;
  logo_url: string | null;
  owner_name: string | null;
};

export function toSpaces(rows: readonly MySpacesRow[] | null | undefined): SpaceMembership[] {
  return (rows ?? []).flatMap((row) =>
    isSpaceId(row.space_id) && (row.role === "owner" || row.role === "worker")
      ? [
          {
            spaceId: row.space_id,
            role: row.role,
            workerId: row.worker_id,
            companyName: row.company_name?.trim() || null,
            logoUrl: row.logo_url || null,
            ownerName: row.owner_name?.trim() || null,
          },
        ]
      : [],
  );
}

/**
 * Where to land after switching: the same section (its first page, without
 * ids or filters, which belonged to the other company), or the dashboard.
 * Whether the section is open in the new space the section guard decides,
 * which sends the person to the dashboard when it is not.
 */
export function pathAfterSwitch(pathname: string): string {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (isActivePath(path, SETTINGS_PATH)) return SETTINGS_PATH;
  const section = [...navItems, ...workerOnlyItems]
    .filter((item) => item.href !== APP_HOME_PATH)
    .find((item) => isActivePath(path, item.href));
  return section?.href ?? APP_HOME_PATH;
}

/** The address that opens the app in this company (404 for a company the account is not in). */
export function spaceLinkPath(space: string): string {
  return `${SPACE_LINK_PATH}/${space}`;
}

/** The name the switcher shows for a company: its name, else its owner's. */
export function spaceName(space: SpaceMembership): string | null {
  return space.companyName ?? space.ownerName;
}
