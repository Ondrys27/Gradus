"use client";

import { useCallback } from "react";
import { useTranslations } from "next-intl";
import { useSession } from "@/features/account/queries";
import { useAssignees } from "./queries";

/**
 * The name of the person a task is given to: "Já" for the signed-in account,
 * the name the space knows them by, or a neutral word when they left it.
 */
export function useAssigneeName() {
  const t = useTranslations("crmTasks.who");
  const { user } = useSession();
  const assignees = useAssignees();
  return useCallback(
    (userId: string | null): string => {
      if (!userId) return t("nobody");
      if (userId === user.id) return t("me");
      const person = assignees.data?.find((item) => item.userId === userId);
      if (!person) return t("someone");
      return person.name || (person.isOwner ? t("owner") : t("someone"));
    },
    [assignees.data, t, user.id],
  );
}
