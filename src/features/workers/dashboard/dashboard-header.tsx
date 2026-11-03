"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { FormAlert } from "@/components/ui/form-alert";
import { useWorkspace } from "@/features/account/workspace-queries";
import { formatDate } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { PersonStatus } from "../company/person-bits";
import { JOB_TITLE_MAX } from "../logic";
import { EditableText } from "./editable-field";
import { PhotoEditor } from "./photo-editor";
import { dashboardErrorOf, useUpdateCompanyWorker } from "./queries";
import type { DashboardViewer, DashboardWorker } from "./types";

export const FIRST_NAME_MAX = 40;
export const LAST_NAME_MAX = 39;

/**
 * Photo, name and position of the person, edited in place by whoever may
 * change them; the person themself changes only their photo here.
 */
export function DashboardHeader({
  worker,
  viewer,
  actions,
}: {
  worker: DashboardWorker;
  viewer: DashboardViewer;
  actions?: ReactNode;
}) {
  const t = useTranslations("workers.dashboard");
  const tCard = useTranslations("workers.card");
  const settings = useFormatSettings();
  const workspace = useWorkspace();
  const update = useUpdateCompanyWorker(worker);
  const editable = worker.canEdit && !workspace.readOnly;
  const photo = (worker.canEdit || worker.isSelf) && !workspace.readOnly;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <PhotoEditor worker={worker} canChange={photo} />
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          {editable ? (
            <div className="grid grid-cols-1 gap-x-3 sm:grid-cols-2">
              <EditableText
                id="worker-first-name"
                value={worker.firstName}
                label={t("fields.firstName")}
                placeholder={t("fields.firstName")}
                maxLength={FIRST_NAME_MAX}
                required={!worker.lastName}
                className="text-xl font-semibold sm:text-2xl"
                onSave={(value) => update.mutate({ first_name: value })}
              />
              <EditableText
                id="worker-last-name"
                value={worker.lastName}
                label={t("fields.lastName")}
                placeholder={t("fields.lastName")}
                maxLength={LAST_NAME_MAX}
                required={!worker.firstName}
                className="text-xl font-semibold sm:text-2xl"
                onSave={(value) => update.mutate({ last_name: value })}
              />
            </div>
          ) : (
            <h2 className="text-xl font-semibold break-words text-ink sm:text-2xl">
              {worker.name}
            </h2>
          )}
          {editable ? (
            <EditableText
              id="worker-job-title"
              testId="worker-job-title"
              value={worker.jobTitle}
              label={t("fields.jobTitle")}
              placeholder={t("fields.jobTitlePlaceholder")}
              maxLength={JOB_TITLE_MAX}
              className="text-sm text-ink-soft"
              onSave={(value) => update.mutate({ job_title: value })}
            />
          ) : (
            <p className="text-sm text-ink-soft">{worker.jobTitle ?? tCard("noJobTitle")}</p>
          )}
          <div className="flex flex-wrap items-center gap-2 text-xs text-ink-muted">
            <PersonStatus status={worker.status} />
            {viewer !== "owner" && worker.isSelf && (
              <span className="rounded-full bg-violet/20 px-1.5 font-semibold text-violet">
                {t("you")}
              </span>
            )}
            <span>{t("since", { date: formatDate(new Date(worker.createdAt), settings) })}</span>
          </div>
        </div>
        {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
      </div>
      {update.isError && <FormAlert>{t(`errors.${dashboardErrorOf(update.error)}`)}</FormAlert>}
    </div>
  );
}
