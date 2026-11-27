"use client";

import { useMemo } from "react";
import type { AdminActor } from "@/features/admin/roles";
import type { GuideAudience } from "../ui-map/access";
import { GuideHost } from "./guide-host";

/**
 * The guide of 30.8 in the administration: the groups' guides and Grady's
 * answers by the administrator's powers. No chat and no offers of help here.
 */
export function AdminGuide({ actor }: { actor: AdminActor }) {
  const audience = useMemo<GuideAudience>(() => ({ kind: "admin", actor }), [actor]);
  return <GuideHost audience={audience} writable hasChat={false} ownerHref={null} />;
}
