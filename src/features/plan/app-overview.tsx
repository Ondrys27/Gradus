"use client";

import { useQuery } from "@tanstack/react-query";
import { HourglassIcon, LockIcon, MailIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { StatTile } from "@/components/ui/stat-tile";
import { useSession } from "@/features/account/queries";
import { formatNumber } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";
import { useFormatSettings } from "@/lib/use-format-settings";

/**
 * Counts for the app owner: accounts on a trial, after it, and the waitlist.
 * app_overview() refuses everyone but the owner role.
 */
export function AppOverview() {
  const t = useTranslations("profile.overview");
  const { user } = useSession();
  const formatSettings = useFormatSettings();
  const { data } = useQuery({
    queryKey: ["account", user.id, "app-overview"],
    queryFn: async () => {
      const { data, error } = await createClient().rpc("app_overview");
      if (error) throw error;
      return data[0] ?? null;
    },
  });

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">{t("title")}</h2>
      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile
          label={t("trialing")}
          value={data?.trialing ?? 0}
          tone="teal"
          icon={<HourglassIcon aria-hidden />}
        />
        <StatTile
          label={t("expired")}
          value={data?.expired ?? 0}
          tone="gold"
          icon={<LockIcon aria-hidden />}
        />
        <StatTile
          label={t("waitlist")}
          value={data?.waitlist ?? 0}
          icon={<MailIcon aria-hidden />}
          hint={t("waitlistConfirmed", {
            count: formatNumber(data?.waitlist_confirmed ?? 0, {}, formatSettings),
          })}
        />
      </div>
    </div>
  );
}
