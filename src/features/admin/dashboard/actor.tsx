"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { AdminActor } from "../roles";

/** Who is looking at the overview, for widgets that show an action only some may take. */
const ActorContext = createContext<AdminActor>({ role: "admin", level: "limited" });

export function AdminActorProvider({ actor, children }: { actor: AdminActor; children: ReactNode }) {
  return <ActorContext.Provider value={actor}>{children}</ActorContext.Provider>;
}

export function useAdminActor(): AdminActor {
  return useContext(ActorContext);
}
