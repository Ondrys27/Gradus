import { navItemsFor, type NavKey } from "@/components/layout/nav-items";
import { can, canDo, type Workspace } from "@/features/account/workspace";
import { grantAllows } from "@/features/workers/permissions-catalog";
import { adminCan, type AdminActor } from "@/features/admin/roles";
import type { GrantSection } from "@/features/workers/permissions-catalog";
import { APP_SECTION_PLACES } from "../guide/sections";
import { isAdminGuideSection, type GuideSection, type UiElement, type UiNeed } from "./types";

/**
 * Who a guide is for (30.8) and what of the catalog they have: an account in
 * the app (the owner of the space, or a worker with the rights of 30.2 and
 * the menu they make) or an administrator with their powers. A guide never
 * points at something its person cannot open; asked about it, Grady says so.
 */
export type GuideAudience =
  | { kind: "app"; workspace: Workspace; menu: ReadonlySet<NavKey> }
  | { kind: "admin"; actor: AdminActor };

/**
 * The sections in the account's menu, as the sidebar builds it (use-nav.ts):
 * the owner has all of them, a worker what the rights open. The same in the
 * browser and on the server, so a guide and Grady's answer agree.
 */
export function guideMenuOf(workspace: Workspace): ReadonlySet<NavKey> {
  const access =
    workspace.role === "worker"
      ? {
          permissions: workspace.permissions,
          company: canDo(workspace, "company", "view"),
          scheduler: grantAllows(workspace.grants, "scheduler", "own"),
        }
      : null;
  return new Set(navItemsFor(access).map((item) => item.key));
}

/** The audience of an account in the app. */
export function appAudience(workspace: Workspace): GuideAudience {
  return { kind: "app", workspace, menu: guideMenuOf(workspace) };
}

function needMet(need: UiNeed, audience: GuideAudience): boolean {
  if ("power" in need) return audience.kind === "admin" && adminCan(audience.actor, need.power);
  if (audience.kind !== "app") return false;
  if ("owner" in need) return audience.workspace.role === "owner";
  if ("worker" in need) return audience.workspace.role === "worker";
  const [section, action] = need.right;
  return can(audience.workspace, section as GrantSection, action as never);
}

/** Whether the section is there for this person at all (in a worker's menu). */
export function sectionAllowed(section: GuideSection, audience: GuideAudience): boolean {
  if (isAdminGuideSection(section)) return audience.kind === "admin";
  if (audience.kind !== "app") return false;
  if (audience.workspace.role === "owner") return true;
  const menu = APP_SECTION_PLACES[section].menu;
  if (section === "rewards") return audience.menu.has("myRewards") || audience.menu.has("workers");
  return menu === null || audience.menu.has(menu);
}

/** Whether this person has the element: its section, then every need. */
export function elementAllowed(element: UiElement, audience: GuideAudience): boolean {
  if (!sectionAllowed(element.section, audience)) return false;
  return (element.needs ?? []).every((need) => needMet(need, audience));
}

/** Why the element is not there for them: the section, or a right (for "ask the owner"). */
export function missingReason(
  element: UiElement,
  audience: GuideAudience,
): "section" | "right" | null {
  if (!sectionAllowed(element.section, audience)) return "section";
  return (element.needs ?? []).every((need) => needMet(need, audience)) ? null : "right";
}
