"use client";

import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { useCelebration } from "@/components/celebration/celebration-provider";
import { useSession } from "@/features/account/queries";
import { useAwardXp, useSectionUnlocks } from "./queries";
import { SECTION_UNLOCK_KEYS, type LockableSection } from "./types";

/**
 * Mounted once for the whole app. The database grants a section the moment
 * its real counts cross the threshold; this only notices the transition and
 * plays the celebration once. award_xp() is idempotent per section, so a
 * remount or a second tab never celebrates the same unlock twice.
 */
export function SectionUnlockWatcher() {
  const { worker } = useSession();
  const tNav = useTranslations("nav");
  const t = useTranslations("gamification.celebration.sectionUnlocked");
  const { celebrate } = useCelebration();
  const unlocks = useSectionUnlocks();
  const awardXp = useAwardXp();
  const attempted = useRef<Set<LockableSection>>(new Set());

  const data = unlocks.data;
  useEffect(() => {
    if (worker || !data) return;
    for (const section of Object.keys(SECTION_UNLOCK_KEYS) as LockableSection[]) {
      const row = data[section];
      if (!row.unlocked || row.seen_at || attempted.current.has(section)) continue;
      attempted.current.add(section);
      awardXp.mutate(
        { kind: "section_unlocked", idempotencyKey: row.key },
        {
          onSuccess: ({ awarded, xp }) => {
            if (!awarded) return;
            celebrate({
              title: t("title"),
              subtitle: t("subtitle", { section: tNav(section) }),
              xp,
            });
          },
        },
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only the unlock data should retrigger this
  }, [worker, data]);

  return null;
}
