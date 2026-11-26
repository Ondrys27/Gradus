"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeftIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { useWorkspace } from "@/features/account/workspace-queries";
import { createClient } from "@/lib/supabase/client";
import { ensureSchedulerSetup } from "../actions";
import { clientInsert } from "../client-insert";
import { DEFAULT_HOURS, DEFAULT_WEEKDAYS } from "../presets";
import { schedulerKeys } from "../queries";
import { emptyWeek, weekIssues, weekToRules, type Week } from "../weekly-hours";
import { WeeklyHoursEditor } from "./weekly-hours-editor";

function defaultWeek(): Week {
  const week = emptyWeek();
  for (const day of DEFAULT_WEEKDAYS)
    week[day] = [{ start: DEFAULT_HOURS.start, end: DEFAULT_HOURS.end }];
  return week;
}

/**
 * The one step for a caller without a scheduler (30.4): their working hours.
 * It makes the profile with the usual three meeting types (as the scheduler
 * does on its first open) and saves these hours as the profile's; the
 * booking page's handle and the rest wait in the Scheduler.
 */
export function QuickHoursSetup({
  onBack,
  onCancel,
  onDone,
}: {
  onBack?: () => void;
  onCancel: () => void;
  onDone: () => void;
}) {
  const t = useTranslations("scheduler");
  const workspace = useWorkspace();
  const queryClient = useQueryClient();
  const [week, setWeek] = useState<Week>(defaultWeek);
  const invalid = weekIssues(week).length > 0 || weekToRules(week).length === 0;
  const save = useMutation({
    mutationFn: async () => {
      const result = await ensureSchedulerSetup({
        names: {
          intro: t("presets.intro"),
          consultation: t("presets.consultation"),
          meeting: t("presets.meeting"),
        },
      });
      if (!result.ok) throw new Error(result.error);
      const profileId = result.data.profileId;
      const supabase = createClient();
      const { data: previous, error } = await supabase
        .from("availability_rules")
        .select("id")
        .eq("profile_id", profileId)
        .is("event_type_id", null)
        .limit(200);
      if (error) throw error;
      const { error: insertError } = await supabase
        .from("availability_rules")
        .insert(
          weekToRules(week).map((rule) =>
            clientInsert("availability_rules", {
              ...rule,
              profile_id: profileId,
              event_type_id: null,
            }),
          ),
        );
      if (insertError) throw insertError;
      if (previous?.length) {
        const { error: deleteError } = await supabase
          .from("availability_rules")
          .delete()
          .in(
            "id",
            previous.map((row) => row.id),
          );
        if (deleteError) throw deleteError;
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: schedulerKeys.all(workspace.userId) });
      onDone();
    },
  });

  return (
    <div className="flex flex-col gap-4" data-testid="meeting-quick-setup">
      {onBack && (
        <Button type="button" variant="ghost" size="sm" className="self-start" onClick={onBack}>
          <ArrowLeftIcon aria-hidden data-icon="inline-start" />
          {t("meeting.back")}
        </Button>
      )}
      <div className="flex flex-col gap-1">
        <h3 className="text-base font-semibold text-ink">{t("meeting.setupTitle")}</h3>
        <p className="text-sm text-ink-soft text-pretty">{t("meeting.setupText")}</p>
      </div>
      <WeeklyHoursEditor
        idPrefix="quick-hours"
        week={week}
        onChange={setWeek}
        disabled={save.isPending}
      />
      {save.isError && <FormAlert>{t("meeting.setupSaveFailed")}</FormAlert>}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="ghost" onClick={onCancel}>
          {t("meeting.cancel")}
        </Button>
        <Button
          type="button"
          disabled={invalid || save.isPending}
          data-testid="meeting-setup-save"
          onClick={() => save.mutate()}
        >
          {save.isPending ? t("meeting.setupSaving") : t("meeting.setupSave")}
        </Button>
      </div>
    </div>
  );
}
