"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { ResponsiveDialog } from "@/components/ui/responsive-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useFreshOnOpen } from "@/features/milestones/use-fresh-on-open";
import type { ShareLevel } from "../levels";
import { useRespondShareRequest, useShareRequests, type ShareRequest } from "../queries";
import { LevelChoice } from "./level-choice";

/**
 * A request waiting for the account: Allow, Change the level and allow, or
 * Decline. Opened from the bell, the dashboard, Grady (?shareRequest=<id>
 * in the calendar) and Settings → Calendar → Sharing.
 */
export function AnswerRequestDialog({
  requestId,
  onClose,
}: {
  requestId: string | null;
  onClose: () => void;
}) {
  const t = useTranslations("calendar.sharing.answer");
  const generation = useFreshOnOpen(requestId !== null);
  return (
    <ResponsiveDialog
      open={requestId !== null}
      onOpenChange={(open) => !open && onClose()}
      title={t("title")}
      closeLabel={t("close")}
    >
      {requestId && (
        <AnswerBody key={`${generation}:${requestId}`} requestId={requestId} onDone={onClose} />
      )}
    </ResponsiveDialog>
  );
}

function AnswerBody({ requestId, onDone }: { requestId: string; onDone: () => void }) {
  const t = useTranslations("calendar.sharing");
  const requests = useShareRequests();
  const request = requests.data?.find((entry) => entry.id === requestId && entry.incoming);
  if (requests.isPending) return <Skeleton className="h-32 rounded-2xl" />;
  if (!request || request.status !== "pending") {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-sm text-ink-soft">{t("answer.gone")}</p>
        <Button type="button" className="self-end" onClick={onDone}>
          {t("answer.close")}
        </Button>
      </div>
    );
  }
  return <AnswerForm request={request} onDone={onDone} />;
}

export function AnswerForm({ request, onDone }: { request: ShareRequest; onDone?: () => void }) {
  const t = useTranslations("calendar.sharing");
  const respond = useRespondShareRequest();
  const [changing, setChanging] = useState(false);
  const [level, setLevel] = useState<ShareLevel>(request.level);

  function answer(approve: boolean, chosen: ShareLevel | null) {
    respond.mutate(
      { id: request.id, approve, level: chosen, asked: request.level },
      { onSuccess: () => onDone?.() },
    );
  }

  return (
    <div className="flex flex-col gap-4" data-testid="calendar-answer">
      <div className="flex items-start gap-3">
        <Avatar src={request.avatarUrl} name={request.name} className="size-10" />
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-sm text-ink">
            {t("answer.asks", { name: request.name, level: t(`levels.${request.level}`) })}
          </p>
          <p className="text-xs text-ink-muted">{t(`levels.${request.level}Hint`)}</p>
          {request.message && (
            <blockquote className="mt-1 rounded-xl border border-line bg-surface-hover/50 px-3 py-2 text-sm break-words whitespace-pre-line text-ink-soft">
              {request.message}
            </blockquote>
          )}
        </div>
      </div>
      {changing && (
        <LevelChoice
          name={`calendar-answer-level-${request.id}`}
          value={level}
          onChange={setLevel}
        />
      )}
      {respond.isError && <FormAlert>{t("errors.unknown")}</FormAlert>}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
        <Button
          type="button"
          variant="ghost"
          disabled={respond.isPending}
          onClick={() => answer(false, null)}
          data-testid="calendar-answer-decline"
        >
          {t("answer.decline")}
        </Button>
        {changing ? (
          <Button
            type="button"
            disabled={respond.isPending}
            onClick={() => answer(true, level)}
            data-testid="calendar-answer-allow-level"
          >
            {t("answer.allowLevel", { level: t(`levels.${level}`) })}
          </Button>
        ) : (
          <>
            <Button
              type="button"
              variant="outline"
              onClick={() => setChanging(true)}
              data-testid="calendar-answer-change"
            >
              {t("answer.change")}
            </Button>
            <Button
              type="button"
              disabled={respond.isPending}
              onClick={() => answer(true, null)}
              data-testid="calendar-answer-allow"
            >
              {t("answer.allow")}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
