"use client";

import { useCallback, useMemo } from "react";
import { useWorkspace } from "@/features/account/workspace-queries";
import { MESSAGES_PATH } from "@/features/chat/types";
import { appAudience } from "../ui-map/access";
import { useSaveGuidePrefs } from "./guide-prefs";
import { GuideHost } from "./guide-host";
import { GuideWatch } from "./guide-watch";

/**
 * The guide of 30.8 in the app: the account's audience from the space it
 * works in (the owner, or a worker with the rights of 30.2, live), Grady's
 * chat to hand questions over and, for a worker, the owner to ask for a
 * right. The watch offers help when someone seems lost.
 */
export function AppGuide() {
  const workspace = useWorkspace();
  const audience = useMemo(() => appAudience(workspace), [workspace]);
  const savePrefs = useSaveGuidePrefs();
  const offersOff = useCallback(() => savePrefs.mutate({ offers: false }), [savePrefs]);
  const ownerHref = workspace.role === "worker" ? `${MESSAGES_PATH}?to=${workspace.id}` : null;
  return (
    <>
      <GuideHost
        audience={audience}
        writable={!workspace.readOnly}
        hasChat
        ownerHref={ownerHref}
        onOffersOff={offersOff}
      />
      <GuideWatch />
    </>
  );
}
