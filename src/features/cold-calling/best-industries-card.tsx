"use client";

import { useEffect, useRef } from "react";
import { LockIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { useCelebration } from "@/components/celebration/celebration-provider";
import { FormAlert } from "@/components/ui/form-alert";
import { GlowCard } from "@/components/ui/glow-card";
import { ProgressBar } from "@/components/ui/progress-bar";
import { Skeleton } from "@/components/ui/skeleton";
import { useSession } from "@/features/account/queries";
import { formatNumber } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";
import { useFormatSettings } from "@/lib/use-format-settings";

type Industry = { industry: string; contacts: number; called: number; meetings: number };
type Insights = {
  meetings: number;
  needed: number;
  unlocked_at: string | null;
  seen_at: string | null;
  industries: Industry[];
};

/** Fewer calls than this in an industry are shown but not ranked as a result. */
const MIN_CALLED = 5;
const SHOWN = 8;

function useIndustryInsights() {
  const { user } = useSession();
  return useQuery({
    // Under cold-calling, so every move refreshes it.
    queryKey: ["cold-calling", user.id, "industries"],
    queryFn: async (): Promise<Insights> => {
      const { data, error } = await createClient().rpc("industry_insights");
      if (error) throw error;
      return data as unknown as Insights;
    },
  });
}

/**
 * Which industries from contact generation turn into meetings, from the user's
 * own calls. Locked until 10 booked meetings; the database grants the unlock,
 * the app celebrates it once and marks it seen.
 */
export function BestIndustriesCard() {
  const t = useTranslations("coldCalling.industries");
  const settings = useFormatSettings();
  const { celebrate } = useCelebration();
  const insights = useIndustryInsights();
  const n = (value: number) => formatNumber(value, {}, settings);
  const percent = (value: number) =>
    formatNumber(value, { style: "percent", decimals: 0 }, settings);

  const data = insights.data;
  const fresh = Boolean(data?.unlocked_at && !data.seen_at);
  const celebrated = useRef(false);
  useEffect(() => {
    if (!fresh || celebrated.current) return;
    celebrated.current = true;
    celebrate({ title: t("unlockedTitle"), subtitle: t("unlockedSubtitle") });
    void createClient()
      .from("unlocks")
      .update({ seen_at: new Date().toISOString() })
      .eq("key", "best_industries")
      .is("seen_at", null);
  }, [fresh, celebrate, t]);

  return (
    <GlowCard interactive={false} className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="micro-label">{t("title")}</h2>
        {data && !data.unlocked_at && <LockIcon aria-hidden className="size-4 text-ink-muted" />}
      </div>

      {insights.isPending ? (
        <Skeleton className="h-32 rounded-xl" />
      ) : insights.isError || !data ? (
        <FormAlert>{t("loadFailed")}</FormAlert>
      ) : !data.unlocked_at ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-ink-soft">{t("locked", { needed: n(data.needed) })}</p>
          <ProgressBar
            value={data.meetings}
            max={data.needed}
            tone="reward"
            label={t("progressLabel")}
          />
          <p className="text-xs text-ink-muted">
            {t("progress", { meetings: n(data.meetings), needed: n(data.needed) })}
          </p>
        </div>
      ) : data.industries.length === 0 ? (
        <p className="text-sm text-ink-soft">{t("noGenerated")}</p>
      ) : (
        <>
          <p className="text-xs text-ink-muted">{t("explain")}</p>
          <ul className="flex flex-col gap-3">
            {data.industries.slice(0, SHOWN).map((item) => {
              const share = item.called > 0 ? item.meetings / item.called : 0;
              const thin = item.called < MIN_CALLED;
              return (
                <li key={item.industry} className="flex flex-col gap-1.5">
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="min-w-0 truncate font-medium text-ink">{item.industry}</span>
                    <span className="shrink-0 text-ink-soft tabular-nums">
                      {thin ? t("few") : percent(share)}
                    </span>
                  </div>
                  <ProgressBar
                    value={thin ? 0 : share}
                    max={1}
                    size="sm"
                    label={t("shareLabel", { industry: item.industry })}
                  />
                  <span className="text-xs text-ink-muted">
                    {t("counts", {
                      meetings: n(item.meetings),
                      called: n(item.called),
                      contacts: n(item.contacts),
                    })}
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </GlowCard>
  );
}
